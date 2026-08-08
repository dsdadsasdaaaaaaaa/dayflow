import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import { ensureNotificationPermission } from './notifications';
import { sendSms } from './smsApi';
import { loadSmsCredentials, normalizePhone } from './smsCredentials';

/**
 * Missed-check-in escalation. When a meeting session ends with a check-in
 * requested AND the safety alert is enabled in Settings, an escalation record
 * is armed here: if the user hasn't tapped "I'm OK" by
 * `endAt + checkInAfterMin + graceMinutes`, the next time DayFlow runs
 * (foreground or the background message check) it texts the trusted contact
 * from the work number.
 *
 * The record lives in a tiny zustand-free AsyncStorage blob — it must be
 * readable from the headless background task and survive app restarts.
 * Privacy: every notification this file schedules is generic on the lock
 * screen (no client names, no locations); the location note only ever goes
 * into the SMS to the trusted contact.
 */

export interface SafetyEscalation {
  /** Epoch ms after which the trusted contact gets texted. */
  deadline: number;
  /** Location note from the meeting task, included in the alert SMS. */
  meetingLocation: string;
  /** Epoch ms when the escalation was armed. */
  armedAt: number;
  /** Scheduled deadline-warning notification id (cancelled on disarm). */
  warningNotificationId: string | null;
}

/** iOS notification category carrying the "I'm OK" action button. */
export const SAFETY_CATEGORY = 'safety-checkin';
export const SAFETY_OK_ACTION = 'im-ok';

const STORAGE_KEY = 'dayflow-safety-escalation';

// ---- Zustand-free store: in-memory record + AsyncStorage persistence -------

let current: SafetyEscalation | null = null;
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Load the persisted record once; every mutator awaits this first. */
function ready(): Promise<void> {
  if (hydrated) return Promise.resolve();
  hydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SafetyEscalation>;
        if (typeof parsed.deadline === 'number' && typeof parsed.armedAt === 'number') {
          current = {
            deadline: parsed.deadline,
            armedAt: parsed.armedAt,
            meetingLocation:
              typeof parsed.meetingLocation === 'string' ? parsed.meetingLocation : '',
            warningNotificationId:
              typeof parsed.warningNotificationId === 'string'
                ? parsed.warningNotificationId
                : null,
          };
        }
      }
    } catch {
      // Corrupted blob — treat as disarmed.
    }
    hydrated = true;
    notify();
  })();
  return hydration;
}

async function persistCurrent(): Promise<void> {
  try {
    if (current) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory record still covers this run.
  }
}

/** Settings persist async — the background task may run before hydration. */
async function settingsReady(): Promise<boolean> {
  if (useSettings.persist.hasHydrated()) return true;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(useSettings.persist.hasHydrated());
    }, 5000);
    const unsub = useSettings.persist.onFinishHydration(() => {
      clearTimeout(timer);
      unsub();
      resolve(true);
    });
  });
}

// ---- Notifications ----------------------------------------------------------

/**
 * Register the "I'm OK" action category. Idempotent; call at app launch.
 * The check-in reminder (meetingNotifications) and the deadline warning both
 * carry this category so the user can disarm right from the lock screen.
 */
let categoryRegistered = false;
export async function registerSafetyCategory(): Promise<void> {
  if (Platform.OS === 'web' || categoryRegistered) return;
  categoryRegistered = true;
  try {
    await Notifications.setNotificationCategoryAsync(SAFETY_CATEGORY, [
      {
        identifier: SAFETY_OK_ACTION,
        buttonTitle: "I'm OK",
        options: { opensAppToForeground: false },
      },
    ]);
  } catch {
    // Best-effort; the notifications still fire without the button.
  }
}

/** Generic on the lock screen — no client, no location, ever. */
async function scheduleWarningNotification(deadline: number): Promise<string | null> {
  if (Platform.OS === 'web' || deadline <= Date.now()) return null;
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return null;
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'DayFlow',
        body: 'Check in now or your trusted contact will be alerted.',
        sound: true,
        data: { safety: 'warning' },
        categoryIdentifier: SAFETY_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(deadline),
      },
    });
  } catch {
    return null;
  }
}

// ---- Public API -------------------------------------------------------------

/**
 * Arm the escalation for a just-ended session. No-op unless the safety alert
 * is enabled with a contact number. Replaces any previous escalation.
 */
export async function armSafetyEscalation(input: {
  /** Epoch ms the session actually ended. */
  endAt: number;
  checkInAfterMin: number;
  /** Task the session belonged to — its meeting location goes in the SMS. */
  taskId: string;
}): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await settingsReady();
    const { safetyAlertEnabled, trustedContactPhone, safetyGraceMinutes } =
      useSettings.getState().settings;
    if (!safetyAlertEnabled || !normalizePhone(trustedContactPhone)) return;
    await ready();
    if (current?.warningNotificationId) {
      await Notifications.cancelScheduledNotificationAsync(
        current.warningNotificationId
      ).catch(() => {});
    }
    const deadline =
      input.endAt + (input.checkInAfterMin + safetyGraceMinutes) * 60 * 1000;
    const meetingLocation =
      useTasks.getState().tasks[input.taskId]?.meeting?.location?.trim() ?? '';
    const warningNotificationId = await scheduleWarningNotification(deadline);
    current = { deadline, meetingLocation, armedAt: Date.now(), warningNotificationId };
    notify();
    await persistCurrent();
  } catch {
    // Best-effort — never let arming break the end-meeting flow.
  }
}

/** Stand down: cancel the warning and forget the record. Safe when idle. */
export async function disarmSafetyEscalation(): Promise<void> {
  await ready();
  if (!current) return;
  const warningId = current.warningNotificationId;
  current = null;
  notify();
  if (warningId) {
    await Notifications.cancelScheduledNotificationAsync(warningId).catch(() => {});
  }
  await persistCurrent();
}

/** Module-level guard: never send the alert twice from overlapping runs. */
let escalateInFlight = false;

/**
 * If an armed escalation is past its deadline, text the trusted contact,
 * disarm, and confirm with a local notification. Called on app foreground
 * and from the background message check. A failed send stays armed so the
 * next run retries.
 */
export async function maybeEscalate(): Promise<void> {
  if (Platform.OS === 'web' || escalateInFlight) return;
  escalateInFlight = true;
  try {
    await ready();
    const armed = current;
    if (!armed || Date.now() <= armed.deadline) return;
    if (!(await settingsReady())) return; // can't trust defaults — retry later
    const { trustedContactPhone, safetyMessage } = useSettings.getState().settings;
    const to = normalizePhone(trustedContactPhone);
    const creds = await loadSmsCredentials();
    if (!to || !creds) {
      // Messaging was disconnected or the contact removed — the alert can
      // never send, so stand down instead of retrying forever.
      await disarmSafetyEscalation();
      return;
    }
    // An "I'm OK" may have landed while credentials loaded — re-check.
    if (current !== armed) return;
    const body =
      safetyMessage.trim() +
      (armed.meetingLocation ? ` Last location note: ${armed.meetingLocation}` : '');
    await sendSms(creds, to, body);
    await disarmSafetyEscalation();
    await Notifications.scheduleNotificationAsync({
      content: { title: 'DayFlow', body: 'Trusted contact alerted.', sound: true },
      trigger: null,
    }).catch(() => {});
  } catch {
    // Offline or the send failed — stay armed; the next run retries.
  } finally {
    escalateInFlight = false;
  }
}

/**
 * Handle a response to a safety notification. Returns true when it consumed
 * the response (the caller should stop). "I'm OK" disarms from anywhere; a
 * plain tap on the deadline warning also disarms — the user is clearly fine,
 * and the foreground escalation check must not fire the alert they just
 * responded to.
 */
export function handleSafetyNotificationResponse(
  response: Notifications.NotificationResponse
): boolean {
  const data = response?.notification?.request?.content?.data as
    | { safety?: unknown }
    | undefined;
  const kind = typeof data?.safety === 'string' ? data.safety : null;
  if (!kind) return false;
  if (response.actionIdentifier === SAFETY_OK_ACTION || kind === 'warning') {
    void disarmSafetyEscalation();
    return true;
  }
  return false; // plain tap on the check-in reminder just opens the app
}

/** The armed escalation, live-updating — null when disarmed. */
export function useSafetyEscalation(): SafetyEscalation | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      void ready();
      return () => {
        listeners.delete(onChange);
      };
    },
    () => current,
    () => null
  );
}
