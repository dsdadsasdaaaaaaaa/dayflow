import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  endMeetingActivity,
  startMeetingActivity,
  updateMeetingActivity,
} from '../../modules/dayflow-live-activity';
import { uid } from '../lib/id';
import { cancelMeetingAlerts, scheduleMeetingAlerts } from '../lib/meetingNotifications';
import { formatMoney, meetingKindMeta, occurrenceAmount } from '../lib/meetings';
import type { ActiveMeeting, DayKey, MeetingKind, MeetingLogEntry, Task } from '../types';
import { useSettings } from './settings';

/** SF Symbol for the Live Activity icon, per meeting kind. */
const KIND_SYMBOLS: Record<MeetingKind, string> = {
  incall: 'house.fill',
  outcall: 'car.fill',
  public: 'cup.and.saucer.fill',
};

/** Module-level guard: extend() must never run concurrently with itself. */
let extendInFlight = false;

interface MeetingSessionState {
  /** The one meeting currently in progress (persists across app restarts). */
  active: ActiveMeeting | null;
  /** Finished session history, most recent last. */
  log: MeetingLogEntry[];
  /**
   * Start a live session for a meeting task occurrence.
   * plannedMinutes drives the countdown target; alerts are scheduled.
   */
  start: (
    task: Task,
    dateKey: DayKey,
    plannedMinutes: number,
    checkInAfterMin: number | null
  ) => Promise<void>;
  /** Push the planned end later by N minutes and re-schedule alerts. */
  extend: (minutes: number) => Promise<void>;
  /**
   * End the active session and append a log entry. `finalAmount` is the
   * settled amount for the occurrence (caller also updates the task store).
   * Returns the log entry, or null if nothing was active.
   */
  end: (input: {
    finalAmount: number;
    client: string;
    kind: MeetingKind;
  }) => Promise<MeetingLogEntry | null>;
  /** Abandon the active session without logging it. */
  cancel: () => Promise<void>;
  clearLog: () => void;
  /** Rewrite the client name on past log entries (profile rename). */
  renameLogClient: (oldName: string, newName: string) => void;
}

export const useMeetingSession = create<MeetingSessionState>()(
  persist(
    (set, get) => ({
      active: null,
      log: [],

      start: async (task, dateKey, plannedMinutes, checkInAfterMin) => {
        const prev = get().active;
        // Never silently discard a different in-progress meeting — the UI
        // routes the user to it so they can end or cancel it explicitly.
        if (prev && prev.taskId !== task.id) return;
        if (prev) await cancelMeetingAlerts(prev.notificationIds);
        const startedAt = Date.now();
        const plannedEndAt = startedAt + plannedMinutes * 60 * 1000;
        const label = task.meeting?.client || task.title;
        const notificationIds = await scheduleMeetingAlerts(
          label,
          plannedEndAt,
          checkInAfterMin
        );
        set({
          active: {
            taskId: task.id,
            dateKey,
            startedAt,
            plannedEndAt,
            checkInAfterMin,
            notificationIds,
          },
        });
        const kind = task.meeting?.kind ?? 'incall';
        void startMeetingActivity({
          clientName: label,
          kindLabel: meetingKindMeta(kind).label,
          rateLabel: formatMoney(
            occurrenceAmount(task, dateKey),
            useSettings.getState().settings.currencySymbol
          ),
          symbolName: KIND_SYMBOLS[kind],
          startedAtMs: startedAt,
          endAtMs: plannedEndAt,
        });
      },

      extend: async (minutes) => {
        // Synchronous in-flight guard: a double-tap must not interleave two
        // read-modify-write cycles (lost extension + orphaned alerts).
        if (extendInFlight) return;
        extendInFlight = true;
        try {
          const active = get().active;
          if (!active) return;
          await cancelMeetingAlerts(active.notificationIds);
          const plannedEndAt =
            Math.max(active.plannedEndAt, Date.now()) + minutes * 60 * 1000;
          const notificationIds = await scheduleMeetingAlerts(
            '', // label unknown here; generic copy is fine on extend
            plannedEndAt,
            active.checkInAfterMin
          );
          // The session may have been ended/cancelled while we awaited —
          // don't resurrect it, and don't leave orphaned alerts scheduled.
          const current = get().active;
          if (!current || current.startedAt !== active.startedAt) {
            await cancelMeetingAlerts(notificationIds);
            return;
          }
          set({ active: { ...current, plannedEndAt, notificationIds } });
          void updateMeetingActivity({ endAtMs: plannedEndAt, overtime: false });
        } finally {
          extendInFlight = false;
        }
      },

      end: async ({ finalAmount, client, kind }) => {
        const active = get().active;
        if (!active) return null;
        // Claim the session synchronously so a double-tap can't log it twice.
        set({ active: null });
        void endMeetingActivity();
        const endedAt = Date.now();
        await cancelMeetingAlerts(active.notificationIds);
        // The check-in reminder must survive a normal end — re-anchor it to
        // the actual end time. endedAt is already in the past here, so
        // scheduleMeetingAlerts skips the warning/time's-up alerts and only
        // schedules the check-in at endedAt + checkInAfterMin.
        if (active.checkInAfterMin != null && active.checkInAfterMin > 0) {
          await scheduleMeetingAlerts('', endedAt, active.checkInAfterMin);
        }
        const actualMinutes = Math.max(
          1,
          Math.round((endedAt - active.startedAt) / 60000)
        );
        const plannedMinutes = Math.max(
          1,
          Math.round((active.plannedEndAt - active.startedAt) / 60000)
        );
        const entry: MeetingLogEntry = {
          id: uid(),
          taskId: active.taskId,
          client,
          kind,
          dateKey: active.dateKey,
          startedAt: active.startedAt,
          endedAt,
          plannedMinutes,
          actualMinutes,
          overtimeMinutes: Math.max(0, actualMinutes - plannedMinutes),
          amount: finalAmount,
        };
        set((s) => ({ log: [...s.log, entry].slice(-2000) }));
        return entry;
      },

      cancel: async () => {
        const active = get().active;
        if (active) await cancelMeetingAlerts(active.notificationIds);
        set({ active: null });
        void endMeetingActivity();
      },

      clearLog: () => set({ log: [] }),

      renameLogClient: (oldName, newName) =>
        set((s) => {
          const oldKey = oldName.trim().toLowerCase();
          const next = newName.trim();
          if (!oldKey || !next) return s;
          let changed = false;
          const log = s.log.map((e) => {
            if (e.client.trim().toLowerCase() !== oldKey) return e;
            changed = true;
            return { ...e, client: next };
          });
          return changed ? { log } : s;
        }),
    }),
    {
      name: 'dayflow-meeting-session',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // A persisted session more than 24h past its planned end is stale
        // (e.g. the app was killed mid-meeting yesterday). Drop it rather
        // than resurrecting an absurd multi-hour "overtime" timer — earnings
        // live on the task's paid/completed state, so no money is lost.
        const active = state?.active;
        if (active && Date.now() - active.plannedEndAt > 24 * 60 * 60 * 1000) {
          void cancelMeetingAlerts(active.notificationIds);
          useMeetingSession.setState({ active: null });
        }
      },
    }
  )
);

/** Total actual minutes spent in meetings on the given days. */
export function meetingMinutesOn(log: MeetingLogEntry[], days: DayKey[]): number {
  const set = new Set(days);
  return log
    .filter((e) => set.has(e.dateKey))
    .reduce((sum, e) => sum + e.actualMinutes, 0);
}
