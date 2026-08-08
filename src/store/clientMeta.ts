import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { normalizePhone } from '../lib/smsCredentials';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

/**
 * Relationship stage for the lead pipeline:
 * - 'lead'    — potential customer, still screening ("not sure yet")
 * - 'client'  — established customer
 * - 'blocked' — do not book; their messages stop notifying
 * Undefined = no explicit stage (treated as 'client' once meetings exist).
 */
export type ClientStatus = 'lead' | 'client' | 'blocked';

/** Extra per-client info the user keeps outside of any single task. */
export interface ClientMeta {
  notes: string;
  /** Client's phone number (E.164) — links messenger threads to profiles. */
  phone?: string;
  /** Client's Telegram chat id (bare id, no 'tgc:' prefix) — links Telegram threads. */
  telegram?: string;
  status?: ClientStatus;
  /** Name as the user typed it (map keys are lowercased). */
  displayName?: string;
}

interface ClientMetaState {
  /** Keyed by trimmed, lowercased client name. */
  meta: Record<string, ClientMeta>;
  setNotes: (client: string, notes: string) => void;
  setPhone: (client: string, phone: string) => void;
  /** Link (or unlink with null) a Telegram chat id to a client. */
  setTelegram: (client: string, chatId: string | null) => void;
  setStatus: (client: string, status: ClientStatus) => void;
  /** Create (or update) a contact from the messenger in one call. */
  upsertContact: (client: string, phone: string, status: ClientStatus) => void;
  /** Create (or update) a contact from a Telegram thread in one call. */
  upsertTelegramContact: (client: string, chatId: string, status: ClientStatus) => void;
  /** Move a client's meta to a new name key (profile rename). */
  renameClient: (oldName: string, newName: string) => void;
}

/** 'tgc:<chatId>' → '<chatId>' (accepts bare chat ids too). */
function stripTgc(counterparty: string): string {
  return counterparty.startsWith('tgc:') ? counterparty.slice(4) : counterparty;
}

/** Canonical map key for a client name. */
export function clientMetaKey(client: string): string {
  return client.trim().toLowerCase();
}

/**
 * Persisted per-client metadata (notes + phone). Kept separate from tasks so
 * it survives even when every meeting with a client is deleted.
 */
export const useClientMeta = create<ClientMetaState>()(
  persist(
    (set) => ({
      meta: {},

      setNotes: (client, notes) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          return {
            meta: { ...s.meta, [key]: { ...s.meta[key], notes } },
          };
        }),

      setPhone: (client, phone) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          const normalized = phone.trim() ? normalizePhone(phone) : '';
          return {
            meta: {
              ...s.meta,
              [key]: {
                ...s.meta[key],
                notes: s.meta[key]?.notes ?? '',
                phone: normalized || undefined,
              },
            },
          };
        }),

      setTelegram: (client, chatId) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          const normalized = chatId ? stripTgc(chatId.trim()) : '';
          return {
            meta: {
              ...s.meta,
              [key]: {
                ...s.meta[key],
                notes: s.meta[key]?.notes ?? '',
                telegram: normalized || undefined,
              },
            },
          };
        }),

      setStatus: (client, status) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          return {
            meta: {
              ...s.meta,
              [key]: { ...s.meta[key], notes: s.meta[key]?.notes ?? '', status },
            },
          };
        }),

      upsertContact: (client, phone, status) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          const normalized = phone.trim() ? normalizePhone(phone) : undefined;
          return {
            meta: {
              ...s.meta,
              [key]: {
                ...s.meta[key],
                notes: s.meta[key]?.notes ?? '',
                phone: normalized,
                status,
                displayName: client.trim(),
              },
            },
          };
        }),

      upsertTelegramContact: (client, chatId, status) =>
        set((s) => {
          const key = clientMetaKey(client);
          if (!key) return s;
          const normalized = stripTgc(chatId.trim());
          return {
            meta: {
              ...s.meta,
              [key]: {
                ...s.meta[key],
                notes: s.meta[key]?.notes ?? '',
                telegram: normalized || undefined,
                status,
                displayName: client.trim(),
              },
            },
          };
        }),

      renameClient: (oldName, newName) =>
        set((s) => {
          const oldKey = clientMetaKey(oldName);
          const newKey = clientMetaKey(newName);
          const display = newName.trim();
          if (!oldKey || !newKey || !display) return s;
          const existing = s.meta[oldKey];
          const meta = { ...s.meta };
          if (newKey === oldKey) {
            // Case-only change — keep the entry, refresh how it's displayed.
            meta[oldKey] = { ...existing, notes: existing?.notes ?? '', displayName: display };
            return { meta };
          }
          delete meta[oldKey];
          meta[newKey] = { ...existing, notes: existing?.notes ?? '', displayName: display };
          return { meta };
        }),
    }),
    {
      name: 'dayflow-client-meta',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/**
 * Effective status for a client: explicit status wins; otherwise 'client'
 * when they have meeting history, else 'lead'.
 */
export function effectiveStatus(
  meta: Record<string, ClientMeta>,
  client: string,
  hasMeetings: boolean
): ClientStatus {
  const m = meta[clientMetaKey(client)];
  if (m?.status) return m.status;
  return hasMeetings ? 'client' : 'lead';
}

/** Is this phone number's linked contact blocked? (Unknown numbers: no.) */
export function isPhoneBlocked(meta: Record<string, ClientMeta>, phone: string): boolean {
  const target = normalizePhone(phone);
  if (!target) return false;
  for (const m of Object.values(meta)) {
    if (m.phone && normalizePhone(m.phone) === target) return m.status === 'blocked';
  }
  return false;
}

/** Is this Telegram thread's linked contact blocked? (Unknown chats: no.) */
export function isTelegramBlocked(
  meta: Record<string, ClientMeta>,
  counterparty: string
): boolean {
  const target = stripTgc(counterparty.trim());
  if (!target) return false;
  for (const m of Object.values(meta)) {
    if (m.telegram && m.telegram === target) return m.status === 'blocked';
  }
  return false;
}

/** Find the client name whose linked Telegram chat matches, or null. */
export function clientNameForTelegram(
  meta: Record<string, ClientMeta>,
  counterparty: string,
  displayNames: string[]
): string | null {
  const target = stripTgc(counterparty.trim());
  if (!target) return null;
  for (const [key, m] of Object.entries(meta)) {
    if (m.telegram && m.telegram === target) {
      // Prefer the original-cased display name when the caller knows it.
      const display = displayNames.find((n) => clientMetaKey(n) === key);
      return display ?? m.displayName ?? key;
    }
  }
  return null;
}

/** Find the client name whose saved phone matches, or null. */
export function clientNameForPhone(
  meta: Record<string, ClientMeta>,
  phone: string,
  displayNames: string[]
): string | null {
  const target = normalizePhone(phone);
  if (!target) return null;
  for (const [key, m] of Object.entries(meta)) {
    if (m.phone && normalizePhone(m.phone) === target) {
      // Prefer the original-cased display name when the caller knows it.
      const display = displayNames.find((n) => clientMetaKey(n) === key);
      return display ?? m.displayName ?? key;
    }
  }
  return null;
}
