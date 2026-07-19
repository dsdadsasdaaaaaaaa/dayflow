import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { toDayKey } from '../lib/dates';
import { uid } from '../lib/id';
import type { FocusMode, FocusSession } from '../types';

interface FocusState {
  /** Completed sessions history (most recent last). */
  sessions: FocusSession[];
  logSession: (input: {
    taskId?: string | null;
    taskTitle?: string | null;
    mode: FocusMode;
    startedAt: number;
    minutes: number;
  }) => void;
  clearHistory: () => void;
}

export const useFocus = create<FocusState>()(
  persist(
    (set) => ({
      sessions: [],

      logSession: (input) =>
        set((s) => ({
          sessions: [
            ...s.sessions,
            {
              id: uid(),
              taskId: input.taskId ?? null,
              taskTitle: input.taskTitle ?? null,
              mode: input.mode,
              startedAt: input.startedAt,
              minutes: Math.max(0, Math.round(input.minutes)),
              // Attribute to the day the session STARTED (matters past midnight).
              dateKey: toDayKey(new Date(input.startedAt)),
            },
          ].slice(-2000),
        })),

      clearHistory: () => set({ sessions: [] }),
    }),
    {
      name: 'dayflow-focus',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export function minutesFocusedOn(sessions: FocusSession[], day: string): number {
  return sessions.filter((s) => s.dateKey === day).reduce((sum, s) => sum + s.minutes, 0);
}
