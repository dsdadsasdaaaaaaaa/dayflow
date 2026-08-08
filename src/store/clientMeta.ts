import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { normalizePhone } from '../lib/smsCredentials';

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
  status?: ClientStatus;
  /** Name as the user typed it (map keys are lowercased). */
  displayName?: string;
}

interface ClientMetaState {
  /** Keyed by trimmed, lowercased client name. */
  meta: Record<string, ClientMeta>;
  setNotes: (client: string, notes: string) => void;
  setPhone: (client: string, phone: string) => void;
  setStatus: (client: string, status: ClientStatus) => void;
  /** Create (or update) a contact from the messenger in one call. */
  upsertContact: (client: string, phone: string, status: ClientStatus) => void;
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
    }),
    {
      name: 'dayflow-client-meta',
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
