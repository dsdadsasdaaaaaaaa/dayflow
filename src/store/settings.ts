import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { setRecurrenceWeekStart } from '../lib/recurrence';
import type { Settings } from '../types';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

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
  messageTemplates: [
    'Hi! What day and time were you thinking?',
    'Can you tell me a little about yourself first?',
    'A deposit is required to confirm the booking.',
    'Confirmed, see you then!',
    'Running about 10 minutes late, be there soon.',
  ],
  photoQuickReplies: [],
  callingEnabled: false,
  callForwardTo: '',
  callShowWorkNumber: false,
  voicemailGreeting: "Sorry I missed you — leave a message after the tone and I'll text you back.",
  appLock: false,
  appLockGraceSeconds: 60,
  safetyAlertEnabled: false,
  trustedContactName: '',
  trustedContactPhone: '',
  safetyGraceMinutes: 10,
  safetyMessage:
    "Automated safety alert: I haven't checked in after a meeting. Please check on me.",
  secretaryUsesNotes: false,
  secretaryReadsMessages: true,
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
      version: PERSIST_VERSION,
      migrate: migrateStore,
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
