import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { addDays, fromDayKey, todayKey } from './dates';
import { taskOccursOn } from './recurrence';
import type { Task } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/**
 * Re-schedule all notifications for a task for the next 7 days.
 * Simple strategy: wipe this task's pending notifications, then schedule
 * each alert for each occurrence in the window. Called on task save/delete
 * and on app foreground.
 */
export async function syncTaskNotifications(task: Task | null, taskId?: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const id = task?.id ?? taskId;
    if (!id) return;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => n.content.data?.taskId === id)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    if (!task || !task.date || task.alerts.length === 0) return;
    if (task.allDay || task.startMinutes == null) return;

    const granted = await ensureNotificationPermission();
    if (!granted) return;

    const today = todayKey();
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i);
      if (!taskOccursOn(task, day)) continue;
      const done = task.recurrence ? !!task.completions[day] : task.completed;
      if (done) continue;
      for (const offset of task.alerts) {
        const fireAt = new Date(fromDayKey(day));
        fireAt.setMinutes(task.startMinutes - offset);
        if (fireAt.getTime() <= Date.now()) continue;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: task.title,
            body:
              offset === 0
                ? 'Starting now'
                : offset < 60
                  ? `Starts in ${offset} min`
                  : `Starts in ${Math.round(offset / 60)} h`,
            sound: true,
            data: { taskId: task.id, dateKey: day },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
        });
      }
    }
  } catch {
    // Notifications are best-effort; never crash the app over them.
  }
}

/**
 * Refresh the 7-day scheduling window for every task. Cancels ONLY task
 * alerts (data.taskId) — live meeting-session alerts and focus-timer chains
 * must survive app foregrounds.
 */
export async function syncAllNotifications(tasks: Record<string, Task>): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => n.content.data?.taskId != null)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
    for (const task of Object.values(tasks)) {
      if (!task.date || task.alerts.length === 0) continue;
      await syncTaskNotificationsNoWipe(task);
    }
  } catch {
    // best-effort
  }
}

async function syncTaskNotificationsNoWipe(task: Task): Promise<void> {
  if (task.allDay || task.startMinutes == null) return;
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  const today = todayKey();
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    if (!taskOccursOn(task, day)) continue;
    const done = task.recurrence ? !!task.completions[day] : task.completed;
    if (done) continue;
    for (const offset of task.alerts) {
      const fireAt = new Date(fromDayKey(day));
      fireAt.setMinutes(task.startMinutes - offset);
      if (fireAt.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: task.title,
          body:
            offset === 0
              ? 'Starting now'
              : offset < 60
                ? `Starts in ${offset} min`
                : `Starts in ${Math.round(offset / 60)} h`,
          sound: true,
          data: { taskId: task.id, dateKey: day },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
      });
    }
  }
}
