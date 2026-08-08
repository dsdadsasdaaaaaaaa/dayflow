import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useTasks } from '../store/tasks';
import { addDays, fromDayKey, todayKey } from './dates';
import { taskOccursOn } from './recurrence';
import type { DayKey, Task } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** iOS category id carried by every task alert so it shows action buttons. */
const TASK_ALERT_CATEGORY = 'task-alert';

let categoriesRegistered = false;

/**
 * Register the actionable-notification category (Complete / Snooze buttons).
 * Idempotent — safe to call on every app launch. No-op on web.
 */
export async function registerNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web' || categoriesRegistered) return;
  categoriesRegistered = true;
  try {
    await Notifications.setNotificationCategoryAsync(TASK_ALERT_CATEGORY, [
      { identifier: 'complete', buttonTitle: 'Complete', options: { opensAppToForeground: false } },
      { identifier: 'snooze15', buttonTitle: 'Snooze 15 min', options: { opensAppToForeground: false } },
    ]);
  } catch {
    // Categories are best-effort; alerts still fire without buttons.
  }
}

/**
 * Handle a tap on a notification or one of its action buttons.
 * 'complete' toggles the occurrence done and re-syncs that task's alerts;
 * 'snooze15' re-fires the same alert 15 minutes from now. A plain tap
 * (DEFAULT_ACTION_IDENTIFIER) just opens the app — nothing extra to do.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse
): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const data = response?.notification?.request?.content?.data as
      | { taskId?: unknown; dateKey?: unknown }
      | undefined;
    const taskId = typeof data?.taskId === 'string' ? data.taskId : null;
    const dateKey = typeof data?.dateKey === 'string' ? (data.dateKey as DayKey) : null;
    if (!taskId || !dateKey) return;

    switch (response.actionIdentifier) {
      case 'complete': {
        // Complete-only, never toggle: a stale notification's button must not
        // UN-complete a task the user already finished in the app.
        const store = useTasks.getState();
        const current = store.tasks[taskId];
        const alreadyDone = current
          ? current.recurrence
            ? current.completions[dateKey] === true
            : current.completed
          : true;
        if (!alreadyDone) store.toggleComplete(taskId, dateKey);
        const task = useTasks.getState().tasks[taskId] ?? null;
        await syncTaskNotifications(task, taskId);
        break;
      }
      case 'snooze15': {
        const title = response.notification.request.content.title ?? 'Reminder';
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body: 'Snoozed reminder',
            sound: true,
            data: { taskId, dateKey },
            categoryIdentifier: TASK_ALERT_CATEGORY,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
        break;
      }
      default:
        // Notifications.DEFAULT_ACTION_IDENTIFIER — the app opens; nothing else.
        break;
    }
  } catch {
    // Best-effort; never crash over a notification action.
  }
}

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
            categoryIdentifier: TASK_ALERT_CATEGORY,
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
          categoryIdentifier: TASK_ALERT_CATEGORY,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
      });
    }
  }
}
