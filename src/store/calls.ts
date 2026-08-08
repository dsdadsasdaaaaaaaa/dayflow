import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { loadSmsCredentials, normalizePhone } from '../lib/smsCredentials';
import {
  fetchCallFrom,
  listCallHistory,
  listVoicemails,
  type CallEntry,
  type VoicemailEntry,
} from '../lib/voiceApi';
import { isPhoneBlocked, type ClientMeta } from './clientMeta';

/**
 * Local call-log + voicemail cache. The provider account (user-owned) is the
 * source of truth; this store merges fetched history and tracks which
 * voicemails were listened to locally. Sync = poll on demand/foreground,
 * like src/store/messages.ts.
 */

/** A voicemail plus the cached caller number (joined via the parent call). */
export type StoredVoicemail = VoicemailEntry & { counterparty?: string };

/** Max parent-call lookups per sync when labeling voicemails (bounded join). */
const MAX_CALLER_JOINS = 25;

interface CallsState {
  /** All known calls by SID (internal forward legs already filtered out). */
  calls: Record<string, CallEntry>;
  /** All known voicemails by recording SID. */
  voicemails: Record<string, StoredVoicemail>;
  /** When each voicemail was first listened to, by recording SID. */
  heardAt: Record<string, number>;
  syncing: boolean;
  lastError: string | null;

  sync: (forwardTo: string) => Promise<void>;
  markHeard: (sid: string) => void;
  clearAll: () => void;
}

export const useCalls = create<CallsState>()(
  persist(
    (set, get) => ({
      calls: {},
      voicemails: {},
      heardAt: {},
      syncing: false,
      lastError: null,

      sync: async (forwardTo) => {
        if (get().syncing) return;
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ lastError: 'Calling is not set up yet.' });
          return;
        }
        set({ syncing: true, lastError: null });
        try {
          const fwd = normalizePhone(forwardTo);
          const [callsResult, vmResult] = await Promise.all([
            listCallHistory(creds, fwd),
            listVoicemails(creds),
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
              // Keep the caller number we already resolved on earlier syncs.
              const prev = voicemails[vm.sid];
              voicemails[vm.sid] = prev?.counterparty
                ? { ...vm, counterparty: prev.counterparty }
                : vm;
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

          set({ calls, voicemails, lastError: error });
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Call sync failed' });
        } finally {
          set({ syncing: false });
        }
      },

      markHeard: (sid) =>
        set((s) => (s.heardAt[sid] ? s : { heardAt: { ...s.heardAt, [sid]: Date.now() } })),

      clearAll: () => set({ calls: {}, voicemails: {}, heardAt: {}, lastError: null }),
    }),
    {
      name: 'dayflow-calls',
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags.
      partialize: (s) => ({
        calls: s.calls,
        voicemails: s.voicemails,
        heardAt: s.heardAt,
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
