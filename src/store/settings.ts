import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setRecurrenceWeekStart } from '../lib/recurrence';
import type { Settings } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  dayStartHour: 0,
  dayEndHour: 24,
  showCalendarEvents: true,
  hiddenCalendarIds: [],
  defaultDurationMinutes: 60,
  defaultAlerts: [0],
  pomodoroWork: 25,
  pomodoroBreak: 5,
  pomodoroLongBreak: 15,
  pomodoroCyclesBeforeLongBreak: 4,
  haptics: true,
  weekStartsOn: 1,
  currencySymbol: '$',
  weeklyEarningsGoal: null,
  appLock: false,
  onboardingDone: false,
};

interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'dayflow-settings',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => ({
        ...current,
        settings: { ...DEFAULT_SETTINGS, ...(persisted as Partial<SettingsState>)?.settings },
      }),
    }
  )
);

// Keep the recurrence engine's week-start aligned with the user's setting.
setRecurrenceWeekStart(useSettings.getState().settings.weekStartsOn);
useSettings.subscribe((s) => setRecurrenceWeekStart(s.settings.weekStartsOn));
