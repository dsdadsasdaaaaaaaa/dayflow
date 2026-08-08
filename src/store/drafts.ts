import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DayKey, Priority, Recurrence, Subtask } from '../types';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

/**
 * Auto-saved editor drafts. The task editor writes its form state here
 * (debounced) while the user types; closing without saving keeps the draft,
 * saving or explicitly discarding clears it.
 *
 * Keys: 'new' for the create flow, or the task id for unsaved edits.
 */
export interface TaskDraftSnapshot {
  title: string;
  icon: string;
  color: string;
  where: 'inbox' | 'scheduled';
  date: DayKey;
  allDay: boolean;
  startMinutes: number;
  duration: number;
  recurrence: Recurrence | null;
  alerts: number[];
  priority: Priority;
  tags: string[];
  subtasks: Subtask[];
  notes: string;
  meeting: {
    enabled: boolean;
    kind: 'incall' | 'outcall' | 'public';
    client: string;
    rate: string;
    location: string;
  };
  savedAt: number;
}

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface DraftState {
  drafts: Record<string, TaskDraftSnapshot>;
  saveDraft: (key: string, snapshot: Omit<TaskDraftSnapshot, 'savedAt'>) => void;
  clearDraft: (key: string) => void;
  getDraft: (key: string) => TaskDraftSnapshot | null;
}

export const useDrafts = create<DraftState>()(
  persist(
    (set, get) => ({
      drafts: {},

      saveDraft: (key, snapshot) =>
        set((s) => ({
          drafts: { ...s.drafts, [key]: { ...snapshot, savedAt: Date.now() } },
        })),

      clearDraft: (key) =>
        set((s) => {
          if (!(key in s.drafts)) return s;
          const { [key]: _removed, ...rest } = s.drafts;
          return { drafts: rest };
        }),

      getDraft: (key) => get().drafts[key] ?? null,
    }),
    {
      name: 'dayflow-drafts',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Expire stale drafts so weeks-old half-typed tasks don't resurface.
        const drafts = state?.drafts;
        if (!drafts) return;
        const cutoff = Date.now() - DRAFT_TTL_MS;
        const fresh = Object.fromEntries(
          Object.entries(drafts).filter(([, d]) => d.savedAt > cutoff)
        );
        if (Object.keys(fresh).length !== Object.keys(drafts).length) {
          useDrafts.setState({ drafts: fresh });
        }
      },
    }
  )
);

/** Does this draft contain anything worth restoring? */
export function draftHasContent(d: TaskDraftSnapshot): boolean {
  return (
    d.title.trim().length > 0 ||
    d.notes.trim().length > 0 ||
    d.subtasks.length > 0 ||
    d.meeting.enabled ||
    d.tags.length > 0
  );
}
