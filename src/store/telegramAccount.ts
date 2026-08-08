import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  onTdUpdate,
  tdAuthState,
  tdHistory,
  tdLoadChats,
  tdLogout,
  tdMarkRead,
  tdSendPhoto,
  tdSendText,
  tdStart,
  type TdAuthState,
  type TgMessage,
} from '../lib/tdlib';

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

  refreshAuth: () => Promise<TdAuthState>;
  /** Start TDLib and, once authorized, sync imported chats + live updates. */
  connectAndSync: () => Promise<void>;
  importChat: (chatId: string) => Promise<void>;
  removeChat: (chatId: string) => void;
  send: (counterparty: string, text: string) => Promise<boolean>;
  sendPhoto: (counterparty: string, localUri: string) => Promise<boolean>;
  markRead: (counterparty: string) => void;
  /** Log out of Telegram and wipe every cached chat/message. */
  disconnect: () => Promise<void>;
  clearAll: () => void;
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

let updatesWired = false;

export const useTelegram = create<TelegramState>()(
  persist(
    (set, get) => {
      const mergeMessages = (incoming: TgMessage[]) => {
        if (incoming.length === 0) return;
        set((s) => {
          const imported = new Set(s.importedChatIds);
          const messages = { ...s.messages };
          let changed = false;
          for (const m of incoming) {
            if (!imported.has(telegramChatId(m.counterparty))) continue;
            messages[m.id] = m;
            changed = true;
          }
          if (!changed) return s;
          return { messages: pruneMessages(messages, s.importedChatIds) };
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
            case 'chatLastMessage':
              if (u.message) mergeMessages([u.message]);
              return;
            case 'authState':
              set({ authState: u.state, connected: u.state === 'ready' });
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

        refreshAuth: async () => {
          const state = await tdAuthState();
          set({ authState: state, connected: state === 'ready' });
          return state;
        },

        connectAndSync: async () => {
          if (get().syncing) return;
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
            mergeMessages([result.value]);
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
            mergeMessages([result.value]);
            return true;
          } finally {
            set({ photoSending: false });
          }
        },

        markRead: (counterparty) => {
          const key = `tgc:${telegramChatId(counterparty)}`;
          set((s) => ({ lastReadAt: { ...s.lastReadAt, [key]: Date.now() } }));
          // Best-effort server-side read receipts for the cached inbound ids.
          const chatId = telegramChatId(counterparty);
          const ids = Object.values(get().messages)
            .filter((m) => m.counterparty === key && m.direction === 'in')
            .map((m) => Number(m.id.split(':')[1]))
            .filter((id) => Number.isFinite(id));
          if (ids.length > 0) void tdMarkRead(chatId, ids);
        },

        disconnect: async () => {
          set({ syncing: false, sendingTo: null, photoSending: false, lastError: null });
          await tdLogout();
          set({
            importedChatIds: [],
            chats: {},
            messages: {},
            lastReadAt: {},
            authState: 'unconfigured',
            connected: false,
          });
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
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags or auth state.
      partialize: (s) =>
        ({
          importedChatIds: s.importedChatIds,
          chats: s.chats,
          messages: s.messages,
          lastReadAt: s.lastReadAt,
        }) as Partial<TelegramState>,
    }
  )
);

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
