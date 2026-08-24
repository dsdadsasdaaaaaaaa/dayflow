import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { uid } from '../lib/id';
import {
  cancelScheduledSms,
  explainSmsFailure,
  fetchMediaUrls,
  fetchSmsStatus,
  listOlderSms,
  listRecentSms,
  listThreadToday,
  SmsSendError,
  scheduleSms,
  sendSms,
  type SmsMessage,
} from '../lib/smsApi';
import { primeMediaCache } from '../lib/mediaCache';
import { loadSmsCredentials, normalizePhone } from '../lib/smsCredentials';
import { uploadPhotoAsset } from '../lib/twilioAssets';
import { PERSIST_VERSION, migrateStore } from './persistVersion';
import { useSettings } from './settings';

/**
 * Local message cache + sync for the in-app messenger. The provider account
 * (user-owned) is the source of truth; this store merges fetched traffic and
 * tracks read state locally. Send is optimistic-free: we post, then merge the
 * confirmed record. Failed sends land in a persisted outbox for tap-to-retry.
 */

export interface Thread {
  counterparty: string; // E.164
  lastMessage: SmsMessage;
  unread: number;
}

/** A failed send waiting for retry (persisted until retried or discarded). */
export interface OutboxEntry {
  localId: string;
  /** Destination (E.164). */
  to: string;
  body: string;
  mediaUrls?: string[];
  failedAt: number;
  /** WHY it failed, human-readable (carrier filtering, STOP list…). */
  reason?: string;
}

/** Sync window slack: re-fetch this far below the high-water mark. */
const CLOCK_SKEW_MS = 10 * 60_000;

/** Per-direction page cap for incremental sync: 5 × 2 directions = 10 pages/sync. */
const SYNC_PAGES_PER_DIRECTION = 5;

/** Page size used everywhere; loadOlder's "no more history" check keys off it. */
const PAGE_SIZE = 100;

/** Terminal outbound statuses that mean the carrier rejected the message. */
const FAILED_SEND = new Set(['failed', 'undelivered']);

/**
 * Grace past sendAt before an absent scheduled entry is dropped — covers the
 * moment where Twilio is mid-send and the record isn't listable yet.
 */
const SCHEDULE_SETTLE_SLACK_MS = 60_000;

/** A message Twilio is holding for future delivery (status "scheduled"). */
export interface ScheduledSend {
  /** Destination (E.164). */
  to: string;
  body: string;
  /** When Twilio will deliver it (epoch ms). */
  sendAtMs: number;
}

interface MessagesState {
  /** All known messages by SID. */
  messages: Record<string, SmsMessage>;
  /** Last time a thread was opened, per counterparty (for unread counts). */
  lastReadAt: Record<string, number>;
  /**
   * Newest sentAt ever synced (epoch ms). Normal syncs only fetch traffic
   * with DateSent >= mark − CLOCK_SKEW_MS instead of re-downloading the
   * whole newest-100 window on every poll.
   */
  highWaterMark: number | null;
  /**
   * Whether older history may exist beyond the oldest cached message, per
   * counterparty. Missing = unknown (assume yes); false once a loadOlder
   * fetch returns fewer than PAGE_SIZE new messages.
   */
  hasMoreOlder: Record<string, boolean>;
  /** Failed sends awaiting retry, by localId. */
  outbox: Record<string, OutboxEntry>;
  /**
   * Twilio-held scheduled sends by message SID. Kept OUT of `messages` until
   * they actually send — sync() reconciles: still-"scheduled" records stay
   * here; sent/canceled ones (or entries missing past their send time) are
   * dropped and the real message arrives via the normal merge.
   */
  scheduled: Record<string, ScheduledSend>;
  /**
   * SIDs of provider records for sends that were moved into the outbox.
   * They stay in Twilio's history forever, so without this set every sync
   * (or messageAlerts merge) would resurrect them as ghost bubbles.
   */
  hiddenSids: Record<string, true>;
  syncing: boolean;
  sendingTo: string | null;
  /** Counterparty currently loading older history (spinner on the pill). */
  loadingOlder: string | null;
  /** Photo send progress (uploading = hosting the photo, ~30-60s). */
  photoSending: 'uploading' | 'sending' | null;
  lastSyncAt: number | null;
  lastError: string | null;
  /** True once credentials were confirmed present (UI gate). */
  configured: boolean;
  /**
   * The work number currently sending (mirrored from the keychain so screens
   * can compare it against a message's ownNumber without an async read).
   */
  currentNumber: string | null;
  /** Unsent composer drafts per thread (SMS E.164 or 'tgc:…' keys). */
  threadDrafts: Record<string, string>;
  /**
   * Work numbers retired by "Change number", newest first. Their history
   * stays in the same threads and clients who still have an old number keep
   * reaching us — every fetch covers them alongside the current number.
   */
  previousNumbers: string[];
  /**
   * Bumped by clearAll. In-flight syncs capture it before fetching and drop
   * their merge when it changed — an erase must never be repopulated by a
   * network call that raced it.
   */
  generation: number;

  refreshConfigured: () => Promise<void>;
  sync: () => Promise<void>;
  send: (to: string, body: string, mediaUrls?: string[]) => Promise<boolean>;
  /** Host a local photo on the user's Twilio account, then MMS it. */
  sendPhoto: (to: string, localUri: string) => Promise<boolean>;
  /** Fetch the next page of history older than the oldest cached message. */
  loadOlder: (counterparty: string) => Promise<void>;
  /** Hand the message to Twilio for future delivery (works phone-off). */
  scheduleSend: (to: string, body: string, sendAtMs: number) => Promise<boolean>;
  /** Cancel a scheduled send before it delivers. */
  cancelScheduled: (sid: string) => Promise<boolean>;
  /** Re-attempt a failed send; removes the outbox entry on success. */
  retryOutbox: (localId: string) => Promise<boolean>;
  /** Drop a failed send without retrying. */
  discardOutbox: (localId: string) => void;
  markRead: (counterparty: string) => void;
  /**
   * Live-thread poll: one cheap query for this counterparty's inbound today.
   * Runs every few seconds while their conversation is open on screen.
   */
  pollThread: (counterparty: string) => Promise<void>;
  /** Bounded retry of unresolved photo attachments for one open thread. */
  backfillThreadMedia: (counterparty: string) => Promise<void>;
  /** Persist an unsent composer draft per thread ('' clears). Works for
   * Telegram counterparties ('tgc:…') too — one map for both channels. */
  setThreadDraft: (counterparty: string, text: string) => void;
  /** Record a retired work number so its traffic keeps syncing. */
  addPreviousNumber: (number: string) => void;
  clearAll: () => void;
}

/**
 * Merge one fetched message into the map, preserving mediaUrls we already
 * resolved (syncs skip re-fetching known media, so fresh records may lack it).
 * Exported for messageAlerts, which merges fetched windows the same way.
 * Skips hidden SIDs (failed sends living in the retry outbox) so no merge
 * path — sync, loadOlder, or the background alerts task — resurrects them.
 */
export function mergeMessage(messages: Record<string, SmsMessage>, m: SmsMessage): void {
  if (useMessages.getState().hiddenSids[m.sid]) return;
  // Scheduled sends live in the `scheduled` map until they deliver; canceled
  // ones never sent at all. Neither belongs in the visible message flow.
  if (m.status === 'scheduled' || m.status === 'canceled') return;
  const prev = messages[m.sid];
  if (!m.mediaUrls?.length && prev?.mediaUrls?.length) {
    messages[m.sid] = { ...m, mediaUrls: prev.mediaUrls };
  } else {
    messages[m.sid] = m;
  }
}

/** New outbox map with one fresh entry appended. */
function withOutboxEntry(
  outbox: Record<string, OutboxEntry>,
  to: string,
  body: string,
  mediaUrls?: string[],
  reason?: string
): Record<string, OutboxEntry> {
  const entry: OutboxEntry = { localId: uid(), to: normalizePhone(to), body, failedAt: Date.now() };
  if (mediaUrls && mediaUrls.length > 0) entry.mediaUrls = [...mediaUrls];
  if (reason) entry.reason = reason;
  return { ...outbox, [entry.localId]: entry };
}

export const useMessages = create<MessagesState>()(
  persist(
    (set, get) => ({
      messages: {},
      lastReadAt: {},
      highWaterMark: null,
      hasMoreOlder: {},
      outbox: {},
      scheduled: {},
      hiddenSids: {},
      syncing: false,
      sendingTo: null,
      loadingOlder: null,
      photoSending: null,
      lastSyncAt: null,
      lastError: null,
      configured: false,
      currentNumber: null,
      threadDrafts: {},
      previousNumbers: [],
      generation: 0,

      refreshConfigured: async () => {
        const creds = await loadSmsCredentials();
        set({
          configured: creds != null,
          currentNumber: creds ? normalizePhone(creds.fromNumber) : null,
        });
      },

      sync: async () => {
        if (get().syncing) return;
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false });
          return;
        }
        set({ syncing: true, lastError: null, configured: true });
        try {
          // Erase/disconnect fence: if the store is cleared while this sync's
          // network call is in flight, the late merge must be dropped —
          // otherwise "erased" client messages repopulate AsyncStorage.
          const gen = get().generation;
          // Don't re-fetch media lists for messages whose media we already have.
          const knownMediaSids = new Set(
            Object.values(get().messages)
              .filter((m) => m.mediaUrls && m.mediaUrls.length > 0)
              .map((m) => m.sid)
          );
          const mark = get().highWaterMark;
          // Incremental after the first sync: only fetch traffic since the
          // high-water mark (minus a clock-skew margin), paging through
          // next_page_uri so a busy stretch never silently loses messages.
          // First-ever sync keeps the classic newest-window behavior and
          // just plants the mark.
          const previousNumbers = get().previousNumbers;
          const fetched =
            mark == null
              ? await listRecentSms(creds, PAGE_SIZE, knownMediaSids, { previousNumbers })
              : await listRecentSms(creds, PAGE_SIZE, knownMediaSids, {
                  sentAfterMs: mark - CLOCK_SKEW_MS,
                  maxPagesPerDirection: SYNC_PAGES_PER_DIRECTION,
                  previousNumbers,
                });
          // Advance the mark from message timestamps (Twilio's clock), never
          // the device clock — skew-proof by construction.
          // Ignore future-dated scheduled records when advancing the mark.
          const newestFetched = fetched.reduce(
            (max, m) => (m.status === 'scheduled' ? max : Math.max(max, m.sentAt)),
            0
          );
          // A saturated page cap means the window may hold MORE unfetched
          // traffic — advancing the mark past it would leave a permanent gap.
          const capped =
            mark != null && fetched.length >= PAGE_SIZE * SYNC_PAGES_PER_DIRECTION;
          set((s) => {
            if (s.generation !== gen) return s; // cleared mid-flight
            // Idle syncs that fetched nothing new must be free: rebuilding
            // (and re-persisting) the whole unbounded map every 15s costs
            // real scroll jank for zero information.
            const idle =
              fetched.every((m) => {
                const prev = s.messages[m.sid];
                return (
                  prev != null &&
                  prev.status === m.status &&
                  (prev.mediaUrls?.length ?? 0) >= (m.mediaUrls?.length ?? 0)
                );
              }) && Object.keys(s.scheduled).length === 0;
            if (idle) return s;
            const messages = { ...s.messages };
            for (const m of fetched) mergeMessage(messages, m);
            // Reconcile scheduled sends: a fetched record still "scheduled"
            // stays in the map; any other status (sent/delivered/canceled) —
            // or absence once its send time has passed — drops the entry and
            // lets the normal merge carry the real message.
            const fetchedBySid = new Map(fetched.map((m) => [m.sid, m] as const));
            let scheduled = s.scheduled;
            for (const [sid, entry] of Object.entries(s.scheduled)) {
              const rec = fetchedBySid.get(sid);
              const stillScheduled = rec
                ? rec.status === 'scheduled'
                : Date.now() < entry.sendAtMs + SCHEDULE_SETTLE_SLACK_MS;
              if (stillScheduled) continue;
              if (scheduled === s.scheduled) scheduled = { ...scheduled };
              delete scheduled[sid];
            }
            return {
              messages,
              scheduled,
              lastSyncAt: Date.now(),
              highWaterMark: capped
                ? s.highWaterMark ?? Date.now()
                : Math.max(s.highWaterMark ?? 0, newestFetched) || Date.now(),
            };
          });
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Sync failed' });
        } finally {
          set({ syncing: false });
        }
      },

      send: async (to, body, mediaUrls) => {
        const creds = await loadSmsCredentials();
        const target = normalizePhone(to);
        if (!creds) {
          // Still file it in the outbox — the text isn't lost, and retry
          // works as soon as messaging is configured.
          set((s) => ({
            configured: false,
            lastError: 'Messaging is not set up yet.',
            outbox: withOutboxEntry(s.outbox, target, body, mediaUrls),
          }));
          return false;
        }
        set({ sendingTo: target, lastError: null });
        const gen = get().generation;
        try {
          const sent = await sendSms(creds, target, body, mediaUrls);
          set((s) => {
            if (s.generation !== gen) return s;
            const messages = { ...s.messages };
            mergeMessage(messages, sent);
            return { messages };
          });
          // Twilio answers "queued" immediately; settle the real status with
          // two cheap single-message checks instead of a full history sync.
          // Both timers honor the erase fence — a wiped store stays wiped.
          for (const delay of [4000, 15000]) {
            setTimeout(async () => {
              if (get().generation !== gen) return;
              const updated = await fetchSmsStatus(creds, sent.sid);
              if (!updated) return;
              if (FAILED_SEND.has(updated.status)) {
                // The carrier rejected it after the fact — move the message
                // into the retry outbox WITH the real reason. Both timers can
                // land here, so hiddenSids doubles as the "already moved"
                // guard.
                set((s) => {
                  if (s.generation !== gen || s.hiddenSids[updated.sid]) return {};
                  const messages = { ...s.messages };
                  const prev = messages[updated.sid];
                  delete messages[updated.sid];
                  return {
                    messages,
                    hiddenSids: { ...s.hiddenSids, [updated.sid]: true as const },
                    outbox: withOutboxEntry(
                      s.outbox,
                      updated.counterparty,
                      updated.body,
                      prev?.mediaUrls ?? updated.mediaUrls,
                      explainSmsFailure(updated.errorCode)
                    ),
                  };
                });
              } else {
                set((s) => {
                  if (s.generation !== gen) return s;
                  const messages = { ...s.messages };
                  mergeMessage(messages, updated);
                  return { messages };
                });
              }
            }, delay);
          }
          return true;
        } catch (e) {
          const reason = explainSmsFailure(
            e instanceof SmsSendError ? e.code : undefined,
            e instanceof Error ? e.message : 'Send failed'
          );
          set((s) => ({
            lastError: reason,
            // Keep the failed message retryable instead of just erroring.
            outbox: withOutboxEntry(s.outbox, target, body, mediaUrls, reason),
          }));
          return false;
        } finally {
          set({ sendingTo: null });
        }
      },

      sendPhoto: async (to, localUri) => {
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false, lastError: 'Messaging is not set up yet.' });
          return false;
        }
        set({ photoSending: 'uploading', lastError: null });
        try {
          const ext = /\.(png|gif|webp|heic|heif|jpe?g)$/i.exec(localUri)?.[1]?.toLowerCase();
          const filename = `photo-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext ?? 'jpg'}`;
          // Photo quick replies are hosted assets too — exempt them from the
          // retention prune, however old they are.
          const keepPaths = new Set(
            useSettings
              .getState()
              .settings.photoQuickReplies.map((p) => {
                try {
                  return new URL(p.url).pathname;
                } catch {
                  return '';
                }
              })
              .filter(Boolean)
          );
          const hosted = await uploadPhotoAsset(creds, localUri, filename, keepPaths);
          if (!hosted.ok) {
            set({ lastError: hosted.error });
            return false;
          }
          // The photo already exists locally — render the bubble from the
          // local file instead of re-downloading what we just uploaded.
          primeMediaCache(hosted.url, localUri);
          set({ photoSending: 'sending' });
          return await get().send(to, '', [hosted.url]);
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Photo send failed' });
          return false;
        } finally {
          set({ photoSending: null });
        }
      },

      loadOlder: async (counterparty) => {
        const key = normalizePhone(counterparty);
        if (get().loadingOlder != null) return;
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false });
          return;
        }
        const cached = threadMessages(get().messages, key);
        if (cached.length === 0) return;
        const oldest = cached[0]; // threadMessages sorts oldest first
        set({ loadingOlder: key, lastError: null });
        try {
          const knownMediaSids = new Set(
            Object.values(get().messages)
              .filter((m) => m.mediaUrls && m.mediaUrls.length > 0)
              .map((m) => m.sid)
          );
          const fetched = await listOlderSms(
            creds,
            key,
            oldest.sentAt,
            PAGE_SIZE,
            knownMediaSids,
            get().previousNumbers
          );
          // "More history?" keys on RAW returned volume, not new-SID count —
          // the day-granular overlap means most records re-fetch the cached
          // day, and counting only fresh sids latched this false while whole
          // months of older history still existed.
          const hasMore = fetched.length >= PAGE_SIZE;
          set((s) => {
            const messages = { ...s.messages };
            for (const m of fetched) mergeMessage(messages, m);
            return {
              messages,
              hasMoreOlder: { ...s.hasMoreOlder, [key]: hasMore },
            };
          });
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Could not load earlier messages' });
        } finally {
          set({ loadingOlder: null });
        }
      },

      scheduleSend: async (to, body, sendAtMs) => {
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false, lastError: 'Messaging is not set up yet.' });
          return false;
        }
        const target = normalizePhone(to);
        set({ lastError: null });
        try {
          const msg = await scheduleSms(creds, target, body, sendAtMs);
          set((s) => ({
            scheduled: { ...s.scheduled, [msg.sid]: { to: target, body, sendAtMs } },
          }));
          return true;
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Could not schedule the message' });
          return false;
        }
      },

      cancelScheduled: async (sid) => {
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false, lastError: 'Messaging is not set up yet.' });
          return false;
        }
        set({ lastError: null });
        try {
          await cancelScheduledSms(creds, sid);
          set((s) => {
            const scheduled = { ...s.scheduled };
            delete scheduled[sid];
            return { scheduled };
          });
          return true;
        } catch (e) {
          // Too late to cancel (it already sent) or a network failure — the
          // entry stays and the next sync() reconciles it either way.
          set({
            lastError: e instanceof Error ? e.message : 'Could not cancel the scheduled message',
          });
          return false;
        }
      },

      retryOutbox: async (localId) => {
        const entry = get().outbox[localId];
        if (!entry) return false;
        // Remove first — a failed re-send files a fresh entry via send()'s
        // failure path, so the message can never be lost, only re-queued.
        set((s) => {
          const outbox = { ...s.outbox };
          delete outbox[localId];
          return { outbox };
        });
        return get().send(entry.to, entry.body, entry.mediaUrls);
      },

      discardOutbox: (localId) =>
        set((s) => {
          const outbox = { ...s.outbox };
          delete outbox[localId];
          return { outbox };
        }),

      markRead: (counterparty) =>
        set((s) => ({
          lastReadAt: { ...s.lastReadAt, [normalizePhone(counterparty)]: Date.now() },
        })),

      pollThread: async (counterparty) => {
        const creds = await loadSmsCredentials();
        if (!creds) return;
        const gen = get().generation;
        try {
          const knownMediaSids = new Set(
            Object.values(get().messages)
              .filter((m) => m.mediaUrls && m.mediaUrls.length > 0)
              .map((m) => m.sid)
          );
          const fetched = await listThreadToday(
            creds,
            counterparty,
            20,
            knownMediaSids,
            get().previousNumbers
          );
          // "Changed" must count RESOLVED MEDIA and settled statuses, not
          // just unseen SIDs — an MMS often lists before its media exists,
          // and the first version of this gate threw the photo away on every
          // later tick (the "photos never appear in the open thread" bug).
          const cur = get().messages;
          const changed = fetched.some((m) => {
            const prev = cur[m.sid];
            if (!prev) return true;
            if (m.mediaUrls?.length && !prev.mediaUrls?.length) return true;
            return m.status !== prev.status;
          });
          if (!changed) return;
          set((s) => {
            if (s.generation !== gen) return s;
            const messages = { ...s.messages };
            for (const m of fetched) mergeMessage(messages, m);
            // Outbound records also reconcile scheduled sends live — a
            // delivered scheduled message leaves the banner immediately.
            let scheduled = s.scheduled;
            for (const m of fetched) {
              if (s.scheduled[m.sid] && m.status !== 'scheduled') {
                if (scheduled === s.scheduled) scheduled = { ...scheduled };
                delete scheduled[m.sid];
              }
            }
            // lastSyncAt drives the thread screen's mark-read effect, so the
            // just-arrived message doesn't linger as "unread" while visible.
            return { messages, scheduled, lastSyncAt: Date.now() };
          });
        } catch {
          // Poll misses are fine — the next tick (or full sync) catches up.
        }
      },

      backfillThreadMedia: async (counterparty) => {
        // Photos whose Media.json was never resolved (over the per-sync cap,
        // or a transient failure) get one bounded retry when their thread is
        // actually being looked at — newest first.
        const creds = await loadSmsCredentials();
        if (!creds) return;
        const gen = get().generation;
        const key = normalizePhone(counterparty);
        const missing = Object.values(get().messages)
          .filter(
            (m) =>
              m.counterparty === key &&
              (m.numMedia ?? 0) > 0 &&
              (!m.mediaUrls || m.mediaUrls.length === 0)
          )
          .sort((a, b) => b.sentAt - a.sentAt)
          .slice(0, 10);
        if (missing.length === 0) return;
        const resolved = await Promise.all(
          missing.map(async (m) => ({ sid: m.sid, urls: await fetchMediaUrls(creds, m.sid) }))
        );
        set((s) => {
          if (s.generation !== gen) return s;
          const messages = { ...s.messages };
          let changed = false;
          for (const { sid, urls } of resolved) {
            const prev = messages[sid];
            if (prev && urls && urls.length > 0) {
              messages[sid] = { ...prev, mediaUrls: urls };
              changed = true;
            }
          }
          return changed ? { messages } : s;
        });
      },

      setThreadDraft: (counterparty, text) =>
        set((s) => {
          const key = counterparty.startsWith('tgc:')
            ? counterparty
            : normalizePhone(counterparty);
          if (!key) return s;
          const trimmedEmpty = text.trim().length === 0;
          if (trimmedEmpty && !(key in s.threadDrafts)) return s;
          const threadDrafts = { ...s.threadDrafts };
          if (trimmedEmpty) delete threadDrafts[key];
          else threadDrafts[key] = text;
          return { threadDrafts };
        }),

      addPreviousNumber: (number) =>
        set((s) => {
          const n = normalizePhone(number);
          if (!n || s.previousNumbers.includes(n)) return s;
          // Newest first, capped — old numbers stop receiving eventually and
          // each one costs two queries per sync.
          return { previousNumbers: [n, ...s.previousNumbers].slice(0, 3) };
        }),

      clearAll: () =>
        set((s) => ({
          messages: {},
          lastReadAt: {},
          highWaterMark: null,
          hasMoreOlder: {},
          outbox: {},
          scheduled: {},
          hiddenSids: {},
          lastSyncAt: null,
          lastError: null,
          threadDrafts: {},
          previousNumbers: [],
          currentNumber: null,
          generation: s.generation + 1,
        })),
    }),
    {
      name: 'dayflow-messages',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags.
      partialize: (s) => ({
        messages: s.messages,
        lastReadAt: s.lastReadAt,
        lastSyncAt: s.lastSyncAt,
        highWaterMark: s.highWaterMark,
        hasMoreOlder: s.hasMoreOlder,
        outbox: s.outbox,
        scheduled: s.scheduled,
        hiddenSids: s.hiddenSids,
        threadDrafts: s.threadDrafts,
        previousNumbers: s.previousNumbers,
      }) as Partial<MessagesState>,
    }
  )
);

/** Conversation list: newest-first threads with unread counts. */
export function buildThreads(
  messages: Record<string, SmsMessage>,
  lastReadAt: Record<string, number>
): Thread[] {
  const byParty = new Map<string, { last: SmsMessage; unread: number }>();
  for (const m of Object.values(messages)) {
    const key = m.counterparty;
    const entry = byParty.get(key);
    const readAt = lastReadAt[key] ?? 0;
    const isUnread = m.direction === 'in' && m.sentAt > readAt;
    if (!entry) {
      byParty.set(key, { last: m, unread: isUnread ? 1 : 0 });
    } else {
      if (m.sentAt > entry.last.sentAt) entry.last = m;
      if (isUnread) entry.unread += 1;
    }
  }
  return [...byParty.entries()]
    .map(([counterparty, v]) => ({ counterparty, lastMessage: v.last, unread: v.unread }))
    .sort((a, b) => b.lastMessage.sentAt - a.lastMessage.sentAt);
}

/**
 * One thread's messages, oldest first. Pass `hiddenSids` to exclude failed
 * sends that live in the retry outbox (they render as outbox bubbles instead).
 */
export function threadMessages(
  messages: Record<string, SmsMessage>,
  counterparty: string,
  hiddenSids?: Record<string, true>
): SmsMessage[] {
  const key = normalizePhone(counterparty);
  return Object.values(messages)
    .filter((m) => m.counterparty === key && !hiddenSids?.[m.sid])
    .sort((a, b) => a.sentAt - b.sentAt);
}

/** Pending scheduled sends for one thread, soonest first. */
export function threadScheduled(
  scheduled: Record<string, ScheduledSend>,
  counterparty: string
): ({ sid: string } & ScheduledSend)[] {
  const key = normalizePhone(counterparty);
  return Object.entries(scheduled)
    .filter(([, e]) => normalizePhone(e.to) === key)
    .map(([sid, e]) => ({ sid, ...e }))
    .sort((a, b) => a.sendAtMs - b.sendAtMs);
}

/** Failed sends waiting for retry in one thread, oldest first. */
export function threadOutbox(
  outbox: Record<string, OutboxEntry>,
  counterparty: string
): OutboxEntry[] {
  const key = normalizePhone(counterparty);
  return Object.values(outbox)
    .filter((e) => normalizePhone(e.to) === key)
    .sort((a, b) => a.failedAt - b.failedAt);
}

/** Total unread across threads (tab badge). */
export function totalUnread(
  messages: Record<string, SmsMessage>,
  lastReadAt: Record<string, number>
): number {
  return buildThreads(messages, lastReadAt).reduce((sum, t) => sum + t.unread, 0);
}
