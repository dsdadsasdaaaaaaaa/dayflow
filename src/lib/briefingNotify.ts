import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Briefing } from './briefing';
import { ensureNotificationPermission } from './notifications';

/**
 * OPTIONAL morning nudge for the briefing. Default OFF — nothing in this
 * module runs until a caller asks for it, and cancelling wipes it cleanly.
 *
 * DISCRETION (same rule as meeting and message alerts): the body lands on a
 * lock screen other people can see, so it carries COUNTS ONLY — never a
 * client name, never an amount, never a location. "Your day: 3 meetings,
 * 2 people waiting."
 */

/** Scheduled notification id, so a re-schedule replaces rather than stacks. */
const ID_KEY = 'dayflow-briefing-notification-id';

/** A sensible hour when the caller has no stored preference. */
export const DEFAULT_BRIEFING_HOUR = 8;

/** Next occurrence of `hour`:00 local — today if still ahead, else tomorrow. */
export function nextBriefingTime(hour: number, now: number = Date.now()): Date {
  const safeHour = Math.min(23, Math.max(0, Math.round(hour)));
  const at = new Date(now);
  at.setHours(safeHour, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * The lock-screen line. Counts only: meetings, people waiting, regulars to
 * rebook. Outstanding money is deliberately absent — it is an amount.
 * A null briefing (nothing computed yet) gets the generic form.
 */
export function briefingNotificationBody(briefing: Briefing | null): string {
  if (!briefing) return 'Your day is ready.';
  const parts: string[] = [];
  if (briefing.meetings.count > 0) {
    parts.push(`${briefing.meetings.count} meeting${briefing.meetings.count === 1 ? '' : 's'}`);
  }
  if (briefing.waiting.count > 0) {
    parts.push(
      `${briefing.waiting.count} ${briefing.waiting.count === 1 ? 'person' : 'people'} waiting`
    );
  }
  if (briefing.overdue.count > 0) parts.push(`${briefing.overdue.count} to rebook`);
  if (parts.length === 0) return 'Nothing booked today.';
  return `Your day: ${parts.join(', ')}.`;
}

/** Forget the stored id after cancelling — best-effort, never throws. */
async function forgetId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ID_KEY);
  } catch {
    // best-effort
  }
}

/** Cancel the scheduled briefing notification, if any. */
export async function cancelBriefingNotification(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const id = await AsyncStorage.getItem(ID_KEY);
    if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  } catch {
    // best-effort
  }
  await forgetId();
}

/**
 * Schedule the morning nudge at `hour`:00 local, replacing any existing one.
 * Returns false when permission is denied (or on web) — the caller should
 * flip its setting back off rather than pretend it armed.
 *
 * Two shapes, by design:
 * - WITH a briefing: a one-shot dated alert for the NEXT occurrence carrying
 *   live counts. Counts are a snapshot, so re-arm it on app open via
 *   refreshBriefingNotification (which is also what re-arms it after it fires).
 * - WITHOUT one: a self-sustaining DAILY repeat with a generic body, which
 *   keeps working even if the app is not opened for days and can never go
 *   stale, because it states nothing.
 */
export async function scheduleBriefingNotification(
  hour: number = DEFAULT_BRIEFING_HOUR,
  briefing: Briefing | null = null
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await cancelBriefingNotification();
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;
    const safeHour = Math.min(23, Math.max(0, Math.round(hour)));
    const content = {
      title: 'Good morning',
      body: briefingNotificationBody(briefing),
      sound: false,
      data: { briefing: true },
    } as const;
    const id = await Notifications.scheduleNotificationAsync({
      content: { ...content },
      trigger: briefing
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: nextBriefingTime(safeHour),
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: safeHour,
            minute: 0,
          },
    });
    await AsyncStorage.setItem(ID_KEY, id);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one call a setting (and app-open) should wire to: keeps the nudge in
 * sync with the toggle, the chosen hour, and the freshest counts. Off →
 * cancelled. On → re-armed for the next morning. Returns whether a
 * notification is now scheduled.
 */
export async function refreshBriefingNotification(
  enabled: boolean,
  hour: number = DEFAULT_BRIEFING_HOUR,
  briefing: Briefing | null = null
): Promise<boolean> {
  if (!enabled) {
    await cancelBriefingNotification();
    return false;
  }
  return scheduleBriefingNotification(hour, briefing);
}
