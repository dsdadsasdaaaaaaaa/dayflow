import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { loadSmsCredentials, normalizePhone } from '../lib/smsCredentials';
import {
  fetchCallFrom,
  listCallHistory,
  listTranscriptions,
  listVoicemails,
  type CallEntry,
  type TranscriptionEntry,
  type VoicemailEntry,
} from '../lib/voiceApi';
import { isPhoneBlocked, type ClientMeta } from './clientMeta';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

/**
 * Local call-log + voicemail cache. The provider account (user-owned) is the
 * source of truth; this store merges fetched history and tracks which
 * voicemails were listened to locally. Sync = poll on demand/foreground,
 * like src/store/messages.ts.
 */

/** A voicemail plus the cached caller number (joined via the parent call). */
export type StoredVoicemail = VoicemailEntry & {
  counterparty?: string;
  /** Transcribed text (present once transcriptStatus is 'done'). */
  transcript?: string;
  /**
   * 'pending' = Twilio is still transcribing · 'done' = transcript is set ·
   * 'none' = no transcript is coming (failed, or recorded pre-feature).
   * Absent on voicemails synced before this field existed — treat as 'none'.
   */
  transcriptStatus?: 'pending' | 'done' | 'none';
};

/** Max parent-call lookups per sync when labeling voicemails (bounded join). */
const MAX_CALLER_JOINS = 25;

/** A recording with no transcription after this long is never getting one. */
const TRANSCRIPT_WAIT_MS = 10 * 60 * 1000;

interface CallsState {
  /** All known calls by SID (internal forward legs already filtered out). */
  calls: Record<string, CallEntry>;
  /** All known voicemails by recording SID. */
  voicemails: Record<string, StoredVoicemail>;
  /** When each voicemail was first listened to, by recording SID. */
  heardAt: Record<string, number>;
  /**
   * Private note per call, keyed by call SID. Local-only context (who it was,
   * what was agreed) — never sent anywhere, like client notes.
   */
  callNotes: Record<string, string>;
  syncing: boolean;
  lastError: string | null;
  /** Bumped by clearAll — in-flight syncs drop their merge when it changed. */
  generation: number;

  sync: (forwardTo: string) => Promise<void>;
  markHeard: (sid: string) => void;
  /** Save (or clear, with empty text) the private note on one call. */
  setCallNote: (sid: string, text: string) => void;
  clearAll: () => void;
}

export const useCalls = create<CallsState>()(
  persist(
    (set, get) => ({
      calls: {},
      voicemails: {},
      heardAt: {},
      callNotes: {},
      syncing: false,
      lastError: null,
      generation: 0,

      sync: async (forwardTo) => {
        if (get().syncing) return;
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ lastError: 'Calling is not set up yet.' });
          return;
        }
        set({ syncing: true, lastError: null });
        try {
          const gen = get().generation;
          const fwd = normalizePhone(forwardTo);
          const [callsResult, vmResult, trResult] = await Promise.all([
            listCallHistory(creds, fwd),
            listVoicemails(creds),
            listTranscriptions(creds),
          ]);
          let error: string | null = null;

          const calls = { ...get().calls };
          if (callsResult.ok) {
            for (const c of callsResult.calls) calls[c.sid] = c;
          } else {
            error = callsResult.error;
          }

          const voicemails = { ...get().voicemails };
          if (vmResult.ok) {
            for (const vm of vmResult.voicemails) {
              // Keep the locally-joined fields (caller number, transcript)
              // we already resolved on earlier syncs.
              const prev = voicemails[vm.sid];
              voicemails[vm.sid] = prev ? { ...prev, ...vm } : vm;
            }
          } else {
            error = error ?? vmResult.error;
          }

          // Label voicemails with who called: the parent call is usually in
          // the merged log already; otherwise do a bounded per-call join.
          const unresolved: StoredVoicemail[] = [];
          for (const vm of Object.values(voicemails)) {
            if (vm.counterparty) continue;
            const parent = calls[vm.callSid];
            if (parent) {
              voicemails[vm.sid] = { ...vm, counterparty: parent.counterparty };
            } else {
              unresolved.push(vm);
            }
          }
          await Promise.all(
            unresolved.slice(0, MAX_CALLER_JOINS).map(async (vm) => {
              const from = await fetchCallFrom(creds, vm.callSid);
              if (from) voicemails[vm.sid] = { ...vm, counterparty: from };
            })
          );

          // Join transcripts by recording SID. A voicemail with no
          // transcription that is old enough is never getting one ('none' —
          // e.g. recorded before transcription was enabled); a fresh one is
          // still being transcribed ('pending').
          if (trResult.ok) {
            const byRecording = new Map<string, TranscriptionEntry>();
            for (const t of trResult.transcriptions) byRecording.set(t.recordingSid, t);
            for (const vm of Object.values(voicemails)) {
              const t = byRecording.get(vm.sid);
              if (t?.status === 'completed') {
                voicemails[vm.sid] = { ...vm, transcript: t.text, transcriptStatus: 'done' };
              } else if (t?.status === 'failed') {
                voicemails[vm.sid] = { ...vm, transcriptStatus: 'none' };
              } else if (vm.transcriptStatus !== 'done') {
                const waiting = t != null || Date.now() - vm.recordedAt <= TRANSCRIPT_WAIT_MS;
                voicemails[vm.sid] = { ...vm, transcriptStatus: waiting ? 'pending' : 'none' };
              }
            }
          } else {
            error = error ?? trResult.error;
          }

          // Erase/disconnect fence — a cleared store must stay cleared.
          if (get().generation !== gen) return;
          set({ calls, voicemails, lastError: error });
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Call sync failed' });
        } finally {
          set({ syncing: false });
        }
      },

      markHeard: (sid) =>
        set((s) => (s.heardAt[sid] ? s : { heardAt: { ...s.heardAt, [sid]: Date.now() } })),

      setCallNote: (sid, text) =>
        set((s) => {
          const trimmed = text.trim();
          if (!trimmed) {
            if (!(sid in s.callNotes)) return s;
            const { [sid]: _removed, ...rest } = s.callNotes;
            return { callNotes: rest };
          }
          if (s.callNotes[sid] === trimmed) return s;
          return { callNotes: { ...s.callNotes, [sid]: trimmed } };
        }),

      clearAll: () =>
        set((s) => ({
          calls: {},
          voicemails: {},
          heardAt: {},
          callNotes: {},
          lastError: null,
          generation: s.generation + 1,
        })),
    }),
    {
      name: 'dayflow-calls',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags.
      partialize: (s) => ({
        calls: s.calls,
        voicemails: s.voicemails,
        heardAt: s.heardAt,
        callNotes: s.callNotes,
      }) as Partial<CallsState>,
    }
  )
);

/** One call-log row: the call plus its voicemail, when one was left. */
export interface CallRow extends CallEntry {
  voicemail?: StoredVoicemail;
}

/** Call log rows, newest first. */
export function buildCallRows(state: Pick<CallsState, 'calls' | 'voicemails'>): CallRow[] {
  const byCallSid = new Map<string, StoredVoicemail>();
  for (const vm of Object.values(state.voicemails)) byCallSid.set(vm.callSid, vm);
  return Object.values(state.calls)
    .map((c): CallRow => {
      const voicemail = byCallSid.get(c.sid);
      if (!voicemail) return { ...c };
      // A voicemail is proof the user never picked up — the parent call
      // itself always ends 'completed' with nonzero duration, so the
      // status/duration heuristic alone can't catch rang-out calls.
      return { ...c, voicemail, missed: c.missed || c.direction === 'in' };
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Unheard voicemails (tab badge). Blocked contacts' voicemails don't count. */
export function unheardCount(
  state: Pick<CallsState, 'voicemails' | 'heardAt'>,
  meta: Record<string, ClientMeta>
): number {
  let count = 0;
  for (const vm of Object.values(state.voicemails)) {
    if (state.heardAt[vm.sid]) continue;
    if (vm.counterparty && isPhoneBlocked(meta, vm.counterparty)) continue;
    count += 1;
  }
  return count;
}
