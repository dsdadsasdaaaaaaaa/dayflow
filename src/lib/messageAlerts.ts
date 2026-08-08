import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { useClientMeta, isPhoneBlocked } from '../store/clientMeta';
import { mergeMessage, useMessages } from '../store/messages';
import { listRecentSms } from './smsApi';
import { loadSmsCredentials } from './smsCredentials';

/**
 * Inbound-message alerting without a server:
 * - A background task polls the provider every ~15 min (iOS decides exact
 *   timing) and fires a local notification for texts we haven't seen.
 * - The same check runs on every foreground sync via notifyNewInbound().
 * Clients initiate most conversations, so surfacing inbound fast matters
 * more than anything else in the messenger.
 */

const TASK_NAME = 'dayflow-message-check';

/** Fire local notifications for inbound messages newer than the last check. */
async function notifyNewInbound(): Promise<void> {
  const creds = await loadSmsCredentials();
  if (!creds) return;

  const store = useMessages.getState();
  const known = new Set(Object.keys(store.messages));
  // Don't re-fetch media lists for messages whose media we already have.
  const knownMediaSids = new Set(
    Object.values(store.messages)
      .filter((m) => m.mediaUrls && m.mediaUrls.length > 0)
      .map((m) => m.sid)
  );
  const fetched = await listRecentSms(creds, 50, knownMediaSids);

  const metaNow = useClientMeta.getState().meta;
  const fresh = fetched.filter(
    (m) =>
      m.direction === 'in' &&
      !known.has(m.sid) &&
      Date.now() - m.sentAt < 24 * 3600_000 &&
      !isPhoneBlocked(metaNow, m.counterparty)
  );
  if (fresh.length === 0) {
    // Still merge outbound/status updates quietly.
    if (fetched.length > 0) {
      useMessages.setState((s) => {
        const messages = { ...s.messages };
        for (const m of fetched) mergeMessage(messages, m);
        return { messages, lastSyncAt: Date.now() };
      });
    }
    return;
  }

  // Merge first so opening the app shows them immediately.
  useMessages.setState((s) => {
    const messages = { ...s.messages };
    for (const m of fetched) mergeMessage(messages, m);
    return { messages, lastSyncAt: Date.now() };
  });

  // Deliberately discreet: no sender, no preview — the lock screen only ever
  // says that messages exist. One combined notification, not one per text.
  const threads = new Set(fresh.map((m) => m.counterparty));
  const single = threads.size === 1 ? [...threads][0] : null;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'DayFlow',
      body: fresh.length === 1 ? 'You have a new message.' : `You have ${fresh.length} new messages.`,
      sound: true,
      // Tapping still lands in the right thread when there's only one.
      data: single ? { messageThread: single } : {},
    },
    trigger: null, // immediately
  }).catch(() => {});
}

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await notifyNewInbound();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the periodic background check (call once at startup, iOS only). */
export async function registerMessageAlerts(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: 15, // minutes; iOS treats this as a floor, not a promise
    });
  } catch {
    // Background tasks unavailable (simulator, restrictions) — foreground
    // sync still covers it.
  }
}

/** Foreground-path check, safe to call on app active / after sync. */
export async function checkInboundNow(): Promise<void> {
  try {
    await notifyNewInbound();
  } catch {
    // Offline — next check catches up.
  }
}
