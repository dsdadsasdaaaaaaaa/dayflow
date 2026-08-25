import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, useSettings } from '../store/settings';
import { useTasks } from '../store/tasks';
import { ensureNotificationPermission } from './notifications';
import { loadMessagingCredentials, sendMessage, type MessagingCreds } from './messaging';
import { normalizePhone } from './smsCredentials';
import type { SmsCredentials } from './smsCredentials';

/**
 * Missed-check-in escalation. When a meeting session STARTS with a check-in
 * requested AND the safety alert is enabled in Settings, an escalation record
 * is armed here immediately — if the user is incapacitated mid-meeting and
 * never returns to the app, the persisted deadline still fires (that is the
 * whole point of the feature). The deadline is
 * `plannedEndAt + checkInAfterMin + graceMinutes`, re-anchored when the
 * session is extended (new planned end) or ended (actual end time).
 *
 * If the user hasn't checked in by the deadline, the next time DayFlow runs
 * it texts the trusted contact from the work number: the background message
 * check sends immediately (maybeEscalate), while a foreground app open —
 * itself strong evidence the user is fine — first shows a 60-second
 * "Everything OK?" prompt (maybeEscalateForeground) and only sends when it
 * goes unanswered. Both paths re-check Settings at fire time, so turning the
 * feature off or removing the contact stands the escalation down.
 *
 * The record lives in a tiny zustand-free AsyncStorage blob — it must be
 * readable from the headless background task and survive app restarts.
 * Privacy: every notification this file schedules is generic on the lock
 * screen (no client names, no locations); the location note only ever goes
 * into the SMS to the trusted contact, and only when the user's message
 * template keeps it (see buildAlertBody).
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
/** Persisted ids of the post-end check-in reminder (see storeCheckInReminderIds). */
const CHECKIN_IDS_KEY = 'dayflow-safety-checkin-ids';
/**
 * If the app first runs this long AFTER the deadline (phone off, app unused
 * for days), a "missed check-in" alarm is almost certainly a false alarm by
 * then — disarm without sending instead of alerting the contact days late.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
/** How long the foreground "Everything OK?" prompt waits before auto-sending. */
const FOREGROUND_PROMPT_MS = 60 * 1000;
/** Template token a custom safety message uses to place the location note. */
const LOCATION_TOKEN = '{location}';

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

// ---- Post-end check-in reminder ids -----------------------------------------

/**
 * Remember the notification ids of the check-in reminder that end()
 * re-anchors to the actual end time. The active session (and its
 * notificationIds) is gone by then, so without this persisted slot nothing
 * could ever cancel that reminder — it would fire even after the user tapped
 * "I'm OK" or started the next meeting.
 */
export async function storeCheckInReminderIds(ids: string[]): Promise<void> {
  try {
    if (ids.length > 0) {
      await AsyncStorage.setItem(CHECKIN_IDS_KEY, JSON.stringify(ids));
    } else {
      await AsyncStorage.removeItem(CHECKIN_IDS_KEY);
    }
  } catch {
    // Best-effort — worst case the reminder fires once, spuriously.
  }
}

/** Cancel (and forget) any remembered post-end check-in reminder. */
export async function cancelStoredCheckInReminders(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CHECKIN_IDS_KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(CHECKIN_IDS_KEY);
    const ids: unknown = JSON.parse(raw);
    if (!Array.isArray(ids)) return;
    await Promise.all(
      ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
    );
  } catch {
    // Best-effort.
  }
}

// ---- Public API -------------------------------------------------------------

/**
 * Arm (or re-anchor) the escalation for a session. `endAt` is the anchor:
 * the planned end when arming at start/extend, the actual end time when
 * re-anchoring from end(). Replaces any previous escalation.
 *
 * Stands the escalation DOWN instead when the feature is disabled, the
 * contact number is missing, or the deadline-warning notification cannot be
 * scheduled (notifications denied) — an alert the user can never see coming
 * would be a false-alarm machine, not a safety net.
 */
export async function armSafetyEscalation(input: {
  /** Epoch ms anchor: planned end (start/extend) or actual end (end()). */
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
    if (!safetyAlertEnabled || !normalizePhone(trustedContactPhone)) {
      // Not eligible (feature off / no contact) — make sure nothing stale
      // stays armed from an earlier anchor of this or a previous session.
      await disarmSafetyEscalation();
      return;
    }
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
    if (!warningNotificationId) {
      // Notifications denied (or scheduling failed): the user would get no
      // warning before a silent SMS goes out. Refuse to arm.
      await disarmSafetyEscalation();
      return;
    }
    current = { deadline, meetingLocation, armedAt: Date.now(), warningNotificationId };
    notify();
    await persistCurrent();
  } catch {
    // Best-effort — never let arming break the meeting flow.
  }
}

/**
 * Stand down: cancel the warning, forget the record, and cancel any
 * remembered post-end check-in reminder (the user already checked in — a
 * later "let your contact know" reminder would only confuse). Safe when idle.
 */
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
  await cancelStoredCheckInReminders();
}

/** Module-level guard: never send the alert twice from overlapping runs. */
let escalateInFlight = false;
/** True while the foreground "Everything OK?" prompt is pending an answer. */
let promptPending = false;

/**
 * The alert SMS body. The location note rides along only while the user's
 * message template keeps it: the standard message gets the note appended
 * (when the meeting has one); a custom message must contain `{location}` to
 * include it — a custom message without the token sends exactly as written,
 * keeping locations out of the alert.
 */
function buildAlertBody(template: string, location: string): string {
  const message = template.trim() || DEFAULT_SETTINGS.safetyMessage;
  if (message.includes(LOCATION_TOKEN)) {
    return message.split(LOCATION_TOKEN).join(location).replace(/ {2,}/g, ' ').trim();
  }
  if (message === DEFAULT_SETTINGS.safetyMessage && location) {
    return `${message} Last location note: ${location}`;
  }
  return message;
}

/** Everything needed to fire the alert, re-resolved and re-checked per call. */
interface DueEscalation {
  armed: SafetyEscalation;
  to: string;
  creds: MessagingCreds;
  body: string;
}

/**
 * Re-check the persisted record AND current Settings at fire time. Returns
 * the send payload when the alert is genuinely due; returns null (standing
 * the escalation down where appropriate) in every other case:
 * - nothing armed / deadline not reached — nothing to do;
 * - deadline long past (STALE_AFTER_MS) — false alarm by now, disarm;
 * - the user disabled the safety alert after arming — disarm, never send;
 * - contact number or SMS credentials gone — the alert can never send, disarm.
 */
async function checkDue(): Promise<DueEscalation | null> {
  await ready();
  const armed = current;
  if (!armed || Date.now() <= armed.deadline) return null;
  if (Date.now() - armed.deadline > STALE_AFTER_MS) {
    await disarmSafetyEscalation();
    return null;
  }
  if (!(await settingsReady())) return null; // can't trust defaults — retry later
  const { safetyAlertEnabled, trustedContactPhone, safetyMessage } =
    useSettings.getState().settings;
  if (!safetyAlertEnabled) {
    await disarmSafetyEscalation();
    return null;
  }
  const to = normalizePhone(trustedContactPhone);
  const creds = await loadMessagingCredentials();
  if (!to || !creds) {
    await disarmSafetyEscalation();
    return null;
  }
  // An "I'm OK" may have landed while credentials loaded — re-check.
  if (current !== armed) return null;
  return { armed, to, creds, body: buildAlertBody(safetyMessage, armed.meetingLocation) };
}

/**
 * One send, one confirmation notification, done. Verifies the record is
 * still the one that was due (an "I'm OK" from anywhere wins), disarms
 * right after the send so no later run can re-send, then confirms once.
 */
async function sendEscalation(due: DueEscalation): Promise<void> {
  if (current !== due.armed) return; // disarmed since the check
  await sendMessage(due.creds, due.to, due.body);
  await disarmSafetyEscalation();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'DayFlow', body: 'Trusted contact alerted.', sound: true },
    trigger: null,
  }).catch(() => {});
}

/**
 * Background path: if an armed escalation is past its deadline, text the
 * trusted contact immediately — the app isn't in front of the user, so
 * there is nobody to ask first (that is the point of the feature). Called
 * from the background message check. A failed send stays armed so the next
 * run retries.
 */
export async function maybeEscalate(): Promise<void> {
  if (Platform.OS === 'web' || escalateInFlight) return;
  escalateInFlight = true;
  try {
    const due = await checkDue();
    if (due) await sendEscalation(due);
  } catch {
    // Offline or the send failed — stay armed; the next run retries.
  } finally {
    escalateInFlight = false;
  }
}

/**
 * Foreground twin of maybeEscalate(): the user actively opening the app is
 * strong evidence they are fine, so instead of silently texting we ask —
 * "I'm OK" disarms, "Alert now" sends, and an unanswered prompt auto-sends
 * after 60 seconds of foreground time. Every outcome re-checks the persisted
 * record before sending, so an "I'm OK" from anywhere still wins; if the app
 * dies mid-prompt the record stays armed and the next run re-checks.
 */
export async function maybeEscalateForeground(): Promise<void> {
  if (Platform.OS === 'web' || escalateInFlight || promptPending) return;
  promptPending = true;
  try {
    const due = await checkDue();
    if (!due) {
      promptPending = false;
      return;
    }
    const name =
      useSettings.getState().settings.trustedContactName.trim() || 'Your trusted contact';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** First outcome wins; later button taps / the timer become no-ops. */
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      if (timer) clearTimeout(timer);
      promptPending = false;
      return true;
    };
    const fire = async (): Promise<void> => {
      if (escalateInFlight) return;
      escalateInFlight = true;
      try {
        const stillDue = await checkDue(); // may have been disarmed meanwhile
        if (stillDue) await sendEscalation(stillDue);
      } catch {
        // Send failed — stays armed; the next run retries.
      } finally {
        escalateInFlight = false;
      }
    };
    timer = setTimeout(() => {
      if (settle()) void fire();
    }, FOREGROUND_PROMPT_MS);
    Alert.alert(
      'Everything OK?',
      `You missed your check-in. ${name} will be alerted in 60 seconds unless you check in.`,
      [
        {
          text: "I'm OK",
          onPress: () => {
            if (settle()) void disarmSafetyEscalation();
          },
        },
        {
          text: 'Alert now',
          style: 'destructive',
          onPress: () => {
            if (settle()) void fire();
          },
        },
      ],
      { cancelable: false }
    );
  } catch {
    promptPending = false;
  }
}

/**
 * Handle a response to a safety notification. Returns true when it consumed
 * the response (the caller should stop). ANY response to a safety-category
 * notification is proof of life: the "I'm OK" action from anywhere, a plain
 * tap on the deadline warning, and a plain tap on the check-in reminder
 * itself — the most natural reaction to "check in now" must never leave the
 * countdown armed, let alone fire the alarm the user is actively answering.
 */
export function handleSafetyNotificationResponse(
  response: Notifications.NotificationResponse
): boolean {
  const data = response?.notification?.request?.content?.data as
    | { safety?: unknown }
    | undefined;
  const kind = typeof data?.safety === 'string' ? data.safety : null;
  if (!kind) return false;
  void disarmSafetyEscalation();
  return true;
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
