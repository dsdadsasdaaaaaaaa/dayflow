import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { normalizePhone } from '../lib/smsCredentials';

/** Extra per-client info the user keeps outside of any single task. */
export interface ClientMeta {
  notes: string;
  /** Client's phone number (E.164) — links messenger threads to profiles. */
  phone?: string;
}

interface ClientMetaState {
  /** Keyed by trimmed, lowercased client name. */
  meta: Record<string, ClientMeta>;
  setNotes: (client: string, notes: string) => void;
  setPhone: (client: string, phone: string) => void;
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
              [key]: { notes: s.meta[key]?.notes ?? '', phone: normalized || undefined },
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
      return display ?? key;
    }
  }
  return null;
}
