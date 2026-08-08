import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ensureNotificationPermission } from './notifications';
import { SAFETY_CATEGORY } from './safety';

/**
 * Schedule the alerts for a live meeting session:
 * - a 10-minute warning before the planned end (when ≥ 15 min away),
 * - a "time's up" alert at the planned end,
 * - an optional check-in reminder N minutes after the planned end.
 * Returns the scheduled notification ids (cancel them on end/extend).
 *
 * Content is deliberately generic — these land on the lock screen while the
 * user is physically with the client, so no name, kind, or rate ever appears
 * (same discretion rule as the message alerts).
 */
export async function scheduleMeetingAlerts(
  _clientLabel: string,
  plannedEndAt: number,
  checkInAfterMin: number | null
): Promise<string[]> {
  if (Platform.OS === 'web') return [];
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return [];
    const ids: string[] = [];

    const warnAt = plannedEndAt - 10 * 60 * 1000;
    if (warnAt - Date.now() > 5 * 60 * 1000) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'DayFlow',
            body: 'Wrapping up in 10 minutes.',
            sound: true,
            data: { meetingAlert: 'warning' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(warnAt),
          },
        })
      );
    }

    if (plannedEndAt > Date.now()) {
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Time's up",
            body: 'Planned end time reached.',
            sound: true,
            data: { meetingAlert: 'end' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(plannedEndAt),
          },
        })
      );
    }

    if (checkInAfterMin != null && checkInAfterMin > 0) {
      // Carries the safety category: the "I'm OK" action disarms a pending
      // missed-check-in escalation right from the lock screen (lib/safety).
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Check-in reminder',
            body: 'Let your contact know everything went well.',
            sound: true,
            data: { meetingAlert: 'checkin', safety: 'checkin' },
            categoryIdentifier: SAFETY_CATEGORY,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(plannedEndAt + checkInAfterMin * 60 * 1000),
          },
        })
      );
    }

    return ids;
  } catch {
    return [];
  }
}

export async function cancelMeetingAlerts(ids: string[]): Promise<void> {
  if (Platform.OS === 'web') return;
  await Promise.all(
    ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}))
  );
}
