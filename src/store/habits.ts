import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { addDays, todayKey, weekdayOf } from '../lib/dates';
import { uid } from '../lib/id';
import type { DayKey, Habit } from '../types';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

interface HabitState {
  habits: Record<string, Habit>;
  addHabit: (input: {
    title: string;
    icon?: string;
    color?: string;
    timesPerDay?: number;
    activeWeekdays?: number[];
  }) => Habit;
  updateHabit: (id: string, patch: Partial<Habit>) => void;
  deleteHabit: (id: string) => void;
  /** Increment today's (or the given day's) completion count, wrapping to 0 past target. */
  tick: (id: string, day?: DayKey) => void;
}

export const useHabits = create<HabitState>()(
  persist(
    (set) => ({
      habits: {},

      addHabit: (input) => {
        const habit: Habit = {
          id: uid(),
          title: input.title.trim(),
          icon: input.icon ?? 'sparkles-outline',
          color: input.color ?? 'emerald',
          timesPerDay: Math.max(1, input.timesPerDay ?? 1),
          activeWeekdays: input.activeWeekdays ?? [],
          completions: {},
          createdAt: Date.now(),
          archived: false,
        };
        set((s) => ({ habits: { ...s.habits, [habit.id]: habit } }));
        return habit;
      },

      updateHabit: (id, patch) =>
        set((s) => {
          const h = s.habits[id];
          if (!h) return s;
          return { habits: { ...s.habits, [id]: { ...h, ...patch, id } } };
        }),

      deleteHabit: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.habits;
          return { habits: rest };
        }),

      tick: (id, day = todayKey()) =>
        set((s) => {
          const h = s.habits[id];
          if (!h) return s;
          const current = h.completions[day] ?? 0;
          const next = current >= h.timesPerDay ? 0 : current + 1;
          return {
            habits: {
              ...s.habits,
              [id]: { ...h, completions: { ...h.completions, [day]: next } },
            },
          };
        }),
    }),
    {
      name: 'dayflow-habits',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export function habitActiveOn(habit: Habit, day: DayKey): boolean {
  if (habit.archived) return false;
  if (habit.activeWeekdays.length === 0) return true;
  return habit.activeWeekdays.includes(weekdayOf(day));
}

export function habitDoneOn(habit: Habit, day: DayKey): boolean {
  return (habit.completions[day] ?? 0) >= habit.timesPerDay;
}

/**
 * Current streak in days, counting back from today (or yesterday if today is
 * not yet done — an unfinished today does not break the streak).
 * Inactive weekdays are skipped, not broken.
 */
export function habitStreak(habit: Habit, from: DayKey = todayKey()): number {
  let streak = 0;
  let day = from;
  // Today: counts if done; if not done, streak continues from yesterday.
  if (habitActiveOn(habit, day)) {
    if (habitDoneOn(habit, day)) streak += 1;
  }
  day = addDays(day, -1);
  for (let i = 0; i < 3650; i++) {
    if (habitActiveOn(habit, day)) {
      if (habitDoneOn(habit, day)) streak += 1;
      else break;
    }
    day = addDays(day, -1);
  }
  return streak;
}

/** Longest streak ever (bounded scan from first completion to today). */
export function habitBestStreak(habit: Habit): number {
  const days = Object.keys(habit.completions).sort();
  if (days.length === 0) return 0;
  let best = 0;
  let run = 0;
  let day = days[0];
  const end = todayKey();
  for (let i = 0; i < 3650 && day <= end; i++) {
    if (habitActiveOn(habit, day)) {
      if (habitDoneOn(habit, day)) {
        run += 1;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    day = addDays(day, 1);
  }
  return best;
}
