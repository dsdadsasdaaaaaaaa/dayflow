import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  onTdUpdate,
  tdAuthState,
  tdAvailable,
  tdDestroy,
  tdHistory,
  tdLoadChats,
  tdLogout,
  tdMarkRead,
  tdSendPhoto,
  tdSendText,
  tdStart,
  tdWipeDatabase,
  type TdAuthState,
  type TgMessage,
} from '../lib/tdlib';
import { clearTelegramCredentials } from '../lib/telegramCredentials';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

/**
 * Personal-account Telegram store. PRIVACY: only chats the user explicitly
 * imports are cached, synced, or shown — everything else in their account
 * stays out of the app entirely. Messages are pruned to the most recent 200
 * per imported chat. All native access goes through src/lib/tdlib.ts, which
 * degrades safely on web and on binaries without the module.
 */

export interface TelegramThread {
  counterparty: string; // 'tgc:<chatId>'
  lastMessage: TgMessage;
  unread: number;
}

const MAX_MESSAGES_PER_CHAT = 200;

/** 'tgc:<chatId>' → '<chatId>' (accepts bare chat ids too). */
export function telegramChatId(counterparty: string): string {
  return counterparty.startsWith('tgc:') ? counterparty.slice(4) : counterparty;
}

interface TelegramState {
  /** Chat ids the user explicitly imported (the only ones we touch). */
  importedChatIds: string[];
  /** Titles for imported chats, keyed by chat id. */
  chats: Record<string, { title: string }>;
  /** Cached messages by TgMessage.id, imported chats only. */
  messages: Record<string, TgMessage>;
  /** Last time a thread was opened, per counterparty (unread counts). */
  lastReadAt: Record<string, number>;

  // Runtime (never persisted)
  authState: TdAuthState;
  syncing: boolean;
  sendingTo: string | null;
  photoSending: boolean;
  lastError: string | null;
  connected: boolean;
  /** chatId → epoch ms until which the counterpart shows as typing. */
  typingUntil: Record<string, number>;

  refreshAuth: () => Promise<TdAuthState>;
  /** Start TDLib and, once authorized, sync imported chats + live updates. */
  connectAndSync: () => Promise<void>;
  importChat: (chatId: string) => Promise<void>;
  removeChat: (chatId: string) => void;
  send: (counterparty: string, text: string) => Promise<boolean>;
  sendPhoto: (counterparty: string, localUri: string) => Promise<boolean>;
  markRead: (counterparty: string) => void;
  /**
   * Log out of Telegram (falling back to a local destroy when the network
   * round-trip fails), wipe TDLib's on-disk database, and clear every cached
   * chat/message. Returns false — with lastError set and the cache kept — when
   * nothing could be deleted; callers must NOT report success then.
   */
  disconnect: () => Promise<boolean>;
  clearAll: () => void;
}

/**
 * Remove the synthetic optimistic entry ('<chatId>:local-…') superseded by a
 * confirmed outbound message in the same chat: same body (photos are both
 * empty), created within the last 2 minutes. Deletes AT MOST ONE echo — the
 * oldest match — so one confirmation never sweeps away another in-flight
 * send's echo (two queued photos share the empty body; deleting both would
 * vanish the second photo until, or unless, its own update arrives).
 */
function dropLocalEchoes(messages: Record<string, TgMessage>, confirmed: TgMessage): void {
  if (confirmed.direction !== 'out') return;
  let oldest: TgMessage | null = null;
  for (const [id, m] of Object.entries(messages)) {
    if (
      id.includes(':local-') &&
      m.counterparty === confirmed.counterparty &&
      m.direction === 'out' &&
      m.body === confirmed.body &&
      Math.abs(confirmed.sentAt - m.sentAt) < 120_000 &&
      (oldest == null || m.sentAt < oldest.sentAt)
    ) {
      oldest = m;
    }
  }
  if (oldest) delete messages[oldest.id];
}

/** Cap ONE chat's cached messages at the newest 200 (mutates in place). */
function pruneChatInPlace(messages: Record<string, TgMessage>, counterparty: string): void {
  const list: TgMessage[] = [];
  for (const m of Object.values(messages)) {
    if (m.counterparty === counterparty) list.push(m);
  }
  if (list.length <= MAX_MESSAGES_PER_CHAT) return;
  list.sort((a, b) => b.sentAt - a.sentAt);
  for (const m of list.slice(MAX_MESSAGES_PER_CHAT)) delete messages[m.id];
}

/** Keep only imported chats, capped at the newest 200 messages per chat. */
function pruneMessages(
  messages: Record<string, TgMessage>,
  importedChatIds: string[]
): Record<string, TgMessage> {
  const imported = new Set(importedChatIds.map((id) => `tgc:${id}`));
  const byChat = new Map<string, TgMessage[]>();
  for (const m of Object.values(messages)) {
    if (!imported.has(m.counterparty)) continue;
    const list = byChat.get(m.counterparty);
    if (list) list.push(m);
    else byChat.set(m.counterparty, [m]);
  }
  const pruned: Record<string, TgMessage> = {};
  for (const list of byChat.values()) {
    list.sort((a, b) => b.sentAt - a.sentAt);
    for (const m of list.slice(0, MAX_MESSAGES_PER_CHAT)) pruned[m.id] = m;
  }
  return pruned;
}

/** Two cached copies of the same message id with identical content? */
function sameMessage(a: TgMessage, b: TgMessage): boolean {
  return (
    a.body === b.body &&
    a.sentAt === b.sentAt &&
    a.direction === b.direction &&
    a.photoFileId === b.photoFileId &&
    a.senderName === b.senderName &&
    a.failed === b.failed
  );
}

let updatesWired = false;
/** The in-flight connectAndSync run — shared so awaiting it always settles. */
let syncPromise: Promise<void> | null = null;

export const useTelegram = create<TelegramState>()(
  persist(
    (set, get) => {
      const mergeMessages = (incoming: TgMessage[]) => {
        if (incoming.length === 0) return;
        set((s) => {
          const imported = new Set(s.importedChatIds);
          const messages = { ...s.messages };
          const touched = new Set<string>();
          let changed = false;
          for (const m of incoming) {
            if (!imported.has(telegramChatId(m.counterparty))) continue;
            const prev = messages[m.id];
            // Identical copy (chatLastMessage echoing newMessage, re-synced
            // history…) — skip so we don't rewrite + re-persist the store.
            if (prev && sameMessage(prev, m)) continue;
            if (!m.id.includes(':local-')) dropLocalEchoes(messages, m);
            messages[m.id] = m;
            touched.add(m.counterparty);
            changed = true;
          }
          if (!changed) return s;
          // Prune only the chats this merge touched, and only past the cap —
          // never a full all-chat rebuild per incoming update.
          for (const counterparty of touched) pruneChatInPlace(messages, counterparty);
          return { messages };
        });
      };

      const wireUpdates = () => {
        if (updatesWired) return;
        updatesWired = true;
        onTdUpdate((u) => {
          switch (u.kind) {
            case 'newMessage':
              mergeMessages([u.message]);
              return;
            case 'sendSucceeded':
            case 'sendFailed':
              // The pending copy (temporary id) becomes the settled one —
              // drop the old entry or the message renders twice. A failed
              // send keeps its bubble, flagged failed, so the thread shows
              // "Not delivered" instead of a delivered-looking message.
              set((s) => {
                const messages = { ...s.messages };
                delete messages[`${u.chatId}:${u.oldMessageId}`];
                dropLocalEchoes(messages, u.message);
                if (new Set(s.importedChatIds).has(u.chatId)) {
                  messages[u.message.id] = u.message;
                  pruneChatInPlace(messages, u.message.counterparty);
                }
                return { messages };
              });
              return;
            case 'chatLastMessage':
              if (u.message) mergeMessages([u.message]);
              return;
            case 'authState':
              set({ authState: u.state, connected: u.state === 'ready' });
              return;
            case 'typing':
              // Typing shows for 6s unless renewed or explicitly cancelled.
              set((s) => ({
                typingUntil: {
                  ...s.typingUntil,
                  [u.chatId]: u.typing ? Date.now() + 6000 : 0,
                },
              }));
              return;
            default:
              return;
          }
        });
      };

      return {
        importedChatIds: [],
        chats: {},
        messages: {},
        lastReadAt: {},

        authState: 'unconfigured',
        syncing: false,
        sendingTo: null,
        photoSending: false,
        lastError: null,
        connected: false,
        typingUntil: {},

        refreshAuth: async () => {
          const state = await tdAuthState();
          set({ authState: state, connected: state === 'ready' });
          return state;
        },

        connectAndSync: () => {
          // Share the in-flight run: `await connectAndSync()` must mean
          // "start + auth refresh settled" even when another caller (settings
          // mount, tab focus) kicked the sync off first — an early-return
          // here left the chat picker concluding "not signed in" mid-flight.
          if (syncPromise) return syncPromise;
          const run = (async () => {
            set({ syncing: true, lastError: null });
            try {
              const startResult = await tdStart();
              const state = await get().refreshAuth();
              if (!startResult.ok && state !== 'ready') {
                set({ lastError: startResult.error });
                return;
              }
              if (state !== 'ready') return; // UI drives the login flow
              wireUpdates();

              const chatsResult = await tdLoadChats();
              if (chatsResult.ok) {
                set((s) => {
                  const imported = new Set(s.importedChatIds);
                  const chats = { ...s.chats };
                  for (const chat of chatsResult.value) {
                    if (imported.has(chat.chatId)) chats[chat.chatId] = { title: chat.title };
                  }
                  return { chats };
                });
                mergeMessages(
                  chatsResult.value
                    .filter((c) => c.lastMessage)
                    .map((c) => c.lastMessage as TgMessage)
                );
              }
              for (const chatId of get().importedChatIds) {
                const history = await tdHistory(chatId, 40);
                if (history.ok) mergeMessages(history.value);
              }
            } catch (e) {
              set({ lastError: e instanceof Error ? e.message : 'Telegram sync failed' });
            } finally {
              set({ syncing: false });
            }
          })();
          syncPromise = run.finally(() => {
            syncPromise = null;
          });
          return syncPromise;
        },

        importChat: async (chatId) => {
          set((s) =>
            s.importedChatIds.includes(chatId)
              ? s
              : { importedChatIds: [...s.importedChatIds, chatId] }
          );
          // Best-effort title + first page of history right away.
          const chatsResult = await tdLoadChats();
          if (chatsResult.ok) {
            const chat = chatsResult.value.find((c) => c.chatId === chatId);
            if (chat) {
              set((s) => ({ chats: { ...s.chats, [chatId]: { title: chat.title } } }));
            }
          }
          const history = await tdHistory(chatId, 40);
          if (history.ok) mergeMessages(history.value);
        },

        removeChat: (chatId) =>
          set((s) => {
            const importedChatIds = s.importedChatIds.filter((id) => id !== chatId);
            const chats = { ...s.chats };
            delete chats[chatId];
            const lastReadAt = { ...s.lastReadAt };
            delete lastReadAt[`tgc:${chatId}`];
            return {
              importedChatIds,
              chats,
              lastReadAt,
              messages: pruneMessages(s.messages, importedChatIds),
            };
          }),

        send: async (counterparty, text) => {
          const chatId = telegramChatId(counterparty);
          set({ sendingTo: `tgc:${chatId}`, lastError: null });
          try {
            const result = await tdSendText(chatId, text);
            if (!result.ok) {
              set({ lastError: result.error });
              return false;
            }
            mergeMessages([{ ...result.value, pending: true }]);
            return true;
          } finally {
            set({ sendingTo: null });
          }
        },

        sendPhoto: async (counterparty, localUri) => {
          const chatId = telegramChatId(counterparty);
          set({ photoSending: true, lastError: null });
          try {
            const result = await tdSendPhoto(chatId, localUri);
            if (!result.ok) {
              set({ lastError: result.error });
              return false;
            }
            mergeMessages([{ ...result.value, pending: true }]);
            return true;
          } finally {
            set({ photoSending: false });
          }
        },

        markRead: (counterparty) => {
          const key = `tgc:${telegramChatId(counterparty)}`;
          const prevReadAt = get().lastReadAt[key] ?? 0;
          // Receipts only for messages that arrived since the last mark —
          // re-marking an open thread must not re-send hundreds of ids or
          // rewrite the persisted map for nothing.
          const chatId = telegramChatId(counterparty);
          const ids = Object.values(get().messages)
            .filter(
              (m) =>
                m.counterparty === key && m.direction === 'in' && m.sentAt > prevReadAt
            )
            .map((m) => Number(m.id.split(':')[1]))
            .filter((id) => Number.isFinite(id));
          if (ids.length === 0) return;
          set((s) => ({ lastReadAt: { ...s.lastReadAt, [key]: Date.now() } }));
          void tdMarkRead(chatId, ids);
        },

        disconnect: async () => {
          set({ sendingTo: null, photoSending: false, lastError: null });

          // 1) Proper logout (server round-trip; TDLib wipes its own DB).
          //    On failure — offline, client never started — fall back to
          //    destroy(), which kills the client and its data locally.
          let sessionEnded = !tdAvailable(); // no native module → no session
          let sessionError: string | null = null;
          if (!sessionEnded) {
            const logout = await tdLogout();
            if (logout.ok) {
              sessionEnded = true;
            } else {
              const destroyed = await tdDestroy();
              if (destroyed.ok) sessionEnded = true;
              else sessionError = logout.error;
            }
          }

          // 2) ALWAYS delete Documents/tdlib afterwards — belt and suspenders
          //    (TDLib is done with the directory at this point), and the only
          //    remaining cleanup when both logout and destroy failed.
          const wiped = await tdWipeDatabase();

          if (!sessionEnded && !wiped.ok) {
            // Nothing was deleted — do NOT pretend success.
            set({
              syncing: false,
              lastError: sessionError ?? wiped.error,
            });
            return false;
          }

          set({
            importedChatIds: [],
            chats: {},
            messages: {},
            lastReadAt: {},
            authState: 'unconfigured',
            connected: false,
            syncing: false,
            lastError: null,
          });
          return true;
        },

        clearAll: () =>
          set({
            importedChatIds: [],
            chats: {},
            messages: {},
            lastReadAt: {},
            lastError: null,
          }),
      };
    },
    {
      name: 'dayflow-telegram',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags or auth state. Pending (in-flight)
      // messages stay out too: after an app kill their settled copies arrive
      // via history/updates under permanent ids — the persisted temp copy
      // would live on as a duplicate bubble forever.
      partialize: (s) =>
        ({
          importedChatIds: s.importedChatIds,
          chats: s.chats,
          messages: Object.fromEntries(
            Object.entries(s.messages).filter(([, m]) => !m.pending)
          ),
          lastReadAt: s.lastReadAt,
        }) as Partial<TelegramState>,
    }
  )
);

/**
 * Complete Telegram teardown for "erase all data" flows: sign out (or destroy)
 * the TDLib session, wipe its on-disk database, clear the cached chats, and
 * remove the stored api credentials. Credentials are only cleared AFTER the
 * session teardown succeeds — clearing them first would strand an authorized
 * TDLib database on disk with no way to ever remove it. Returns ok:false with
 * the reason when nothing could be deleted; callers must surface that instead
 * of reporting success.
 */
export async function teardownTelegram(): Promise<{ ok: boolean; error: string | null }> {
  const ok = await useTelegram.getState().disconnect();
  if (!ok) {
    return {
      ok: false,
      error: useTelegram.getState().lastError ?? 'Could not disconnect Telegram.',
    };
  }
  await clearTelegramCredentials();
  return { ok: true, error: null };
}

/**
 * Conversation list for imported Telegram chats — same shape as
 * buildThreads in src/store/messages.ts (newest-first, unread from lastReadAt).
 */
export function buildTelegramThreads(
  state: Pick<TelegramState, 'messages' | 'lastReadAt' | 'importedChatIds'>
): TelegramThread[] {
  const imported = new Set(state.importedChatIds.map((id) => `tgc:${id}`));
  const byParty = new Map<string, { last: TgMessage; unread: number }>();
  for (const m of Object.values(state.messages)) {
    if (!imported.has(m.counterparty)) continue;
    const readAt = state.lastReadAt[m.counterparty] ?? 0;
    const isUnread = m.direction === 'in' && m.sentAt > readAt;
    const entry = byParty.get(m.counterparty);
    if (!entry) {
      byParty.set(m.counterparty, { last: m, unread: isUnread ? 1 : 0 });
    } else {
      if (m.sentAt > entry.last.sentAt) entry.last = m;
      if (isUnread) entry.unread += 1;
    }
  }
  return [...byParty.entries()]
    .map(([counterparty, v]) => ({ counterparty, lastMessage: v.last, unread: v.unread }))
    .sort((a, b) => b.lastMessage.sentAt - a.lastMessage.sentAt);
}

/** Display title for a Telegram thread ('tgc:<chatId>' or bare id). */
export function telegramChatTitle(
  state: Pick<TelegramState, 'chats'>,
  counterparty: string
): string {
  return state.chats[telegramChatId(counterparty)]?.title ?? 'Telegram chat';
}

/** Total unread across imported Telegram threads (tab badge). */
export function totalTelegramUnread(
  state: Pick<TelegramState, 'messages' | 'lastReadAt' | 'importedChatIds'>
): number {
  return buildTelegramThreads(state).reduce((sum, t) => sum + t.unread, 0);
}
