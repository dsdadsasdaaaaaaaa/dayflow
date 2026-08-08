import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { fetchSmsStatus, listRecentSms, sendSms, type SmsMessage } from '../lib/smsApi';
import { loadSmsCredentials, normalizePhone } from '../lib/smsCredentials';
import { uploadPhotoAsset } from '../lib/twilioAssets';

/**
 * Local message cache + sync for the in-app messenger. The provider account
 * (user-owned) is the source of truth; this store merges fetched traffic and
 * tracks read state locally. Send is optimistic-free: we post, then merge the
 * confirmed record.
 */

export interface Thread {
  counterparty: string; // E.164
  lastMessage: SmsMessage;
  unread: number;
}

interface MessagesState {
  /** All known messages by SID. */
  messages: Record<string, SmsMessage>;
  /** Last time a thread was opened, per counterparty (for unread counts). */
  lastReadAt: Record<string, number>;
  syncing: boolean;
  sendingTo: string | null;
  /** Photo send progress (uploading = hosting the photo, ~30-60s). */
  photoSending: 'uploading' | 'sending' | null;
  lastSyncAt: number | null;
  lastError: string | null;
  /** True once credentials were confirmed present (UI gate). */
  configured: boolean;

  refreshConfigured: () => Promise<void>;
  sync: () => Promise<void>;
  send: (to: string, body: string, mediaUrls?: string[]) => Promise<boolean>;
  /** Host a local photo on the user's Twilio account, then MMS it. */
  sendPhoto: (to: string, localUri: string) => Promise<boolean>;
  markRead: (counterparty: string) => void;
  clearAll: () => void;
}

/**
 * Merge one fetched message into the map, preserving mediaUrls we already
 * resolved (syncs skip re-fetching known media, so fresh records may lack it).
 * Exported for messageAlerts, which merges fetched windows the same way.
 */
export function mergeMessage(messages: Record<string, SmsMessage>, m: SmsMessage): void {
  const prev = messages[m.sid];
  if (!m.mediaUrls?.length && prev?.mediaUrls?.length) {
    messages[m.sid] = { ...m, mediaUrls: prev.mediaUrls };
  } else {
    messages[m.sid] = m;
  }
}

export const useMessages = create<MessagesState>()(
  persist(
    (set, get) => ({
      messages: {},
      lastReadAt: {},
      syncing: false,
      sendingTo: null,
      photoSending: null,
      lastSyncAt: null,
      lastError: null,
      configured: false,

      refreshConfigured: async () => {
        const creds = await loadSmsCredentials();
        set({ configured: creds != null });
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
          // Don't re-fetch media lists for messages whose media we already have.
          const knownMediaSids = new Set(
            Object.values(get().messages)
              .filter((m) => m.mediaUrls && m.mediaUrls.length > 0)
              .map((m) => m.sid)
          );
          const fetched = await listRecentSms(creds, 100, knownMediaSids);
          set((s) => {
            const messages = { ...s.messages };
            for (const m of fetched) mergeMessage(messages, m);
            return { messages, lastSyncAt: Date.now() };
          });
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Sync failed' });
        } finally {
          set({ syncing: false });
        }
      },

      send: async (to, body, mediaUrls) => {
        const creds = await loadSmsCredentials();
        if (!creds) {
          set({ configured: false, lastError: 'Messaging is not set up yet.' });
          return false;
        }
        const target = normalizePhone(to);
        set({ sendingTo: target, lastError: null });
        try {
          const sent = await sendSms(creds, target, body, mediaUrls);
          set((s) => {
            const messages = { ...s.messages };
            mergeMessage(messages, sent);
            return { messages };
          });
          // Twilio answers "queued" immediately; settle the real status with
          // two cheap single-message checks instead of a full history sync.
          for (const delay of [4000, 15000]) {
            setTimeout(async () => {
              const updated = await fetchSmsStatus(creds, sent.sid);
              if (updated) {
                set((s) => {
                  const messages = { ...s.messages };
                  mergeMessage(messages, updated);
                  return { messages };
                });
              }
            }, delay);
          }
          return true;
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Send failed' });
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
          const hosted = await uploadPhotoAsset(creds, localUri, filename);
          if (!hosted.ok) {
            set({ lastError: hosted.error });
            return false;
          }
          set({ photoSending: 'sending' });
          return await get().send(to, '', [hosted.url]);
        } catch (e) {
          set({ lastError: e instanceof Error ? e.message : 'Photo send failed' });
          return false;
        } finally {
          set({ photoSending: null });
        }
      },

      markRead: (counterparty) =>
        set((s) => ({
          lastReadAt: { ...s.lastReadAt, [normalizePhone(counterparty)]: Date.now() },
        })),

      clearAll: () => set({ messages: {}, lastReadAt: {}, lastSyncAt: null, lastError: null }),
    }),
    {
      name: 'dayflow-messages',
      storage: createJSONStorage(() => AsyncStorage),
      // Never persist transient flags.
      partialize: (s) => ({
        messages: s.messages,
        lastReadAt: s.lastReadAt,
        lastSyncAt: s.lastSyncAt,
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

/** One thread's messages, oldest first. */
export function threadMessages(
  messages: Record<string, SmsMessage>,
  counterparty: string
): SmsMessage[] {
  const key = normalizePhone(counterparty);
  return Object.values(messages)
    .filter((m) => m.counterparty === key)
    .sort((a, b) => a.sentAt - b.sentAt);
}

/** Total unread across threads (tab badge). */
export function totalUnread(
  messages: Record<string, SmsMessage>,
  lastReadAt: Record<string, number>
): number {
  return buildThreads(messages, lastReadAt).reduce((sum, t) => sum + t.unread, 0);
}
