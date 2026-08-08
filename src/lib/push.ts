import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useMessages } from '../store/messages';

/**
 * Expo push plumbing for the inbound-SMS relay. The push itself is
 * CONTENT-FREE (generic title/body); the counterparty rides in `data` so a
 * tap opens the right thread and a foreground receipt refreshes it.
 *
 * Everything degrades: no permission, no APNs key in the build, or an old
 * binary → getPushTokenSafe() returns null and the app stays on polling.
 */

const PUSH_ACTIVE_KEY = 'dayflow-push-active-v1';

let cachedToken: string | null | undefined;

/** The Expo push token, or null when push isn't available. Never prompts. */
export async function getPushTokenSafe(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (Platform.OS !== 'ios') {
    cachedToken = null;
    return null;
  }
  try {
    // Only piggyback an existing notification grant — the task-alert flow
    // owns the permission prompt.
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return null; // not cached — retry after they allow
    const projectId: string | undefined =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) {
      cachedToken = null;
      return null;
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedToken = token.data ?? null;
  } catch {
    // Missing APNs credentials / old binary — polling covers it.
    cachedToken = null;
  }
  return cachedToken;
}

/** Remember that the Twilio-side relay is live (suppresses local dupes). */
export async function setPushRelayActive(active: boolean): Promise<void> {
  try {
    if (active) await AsyncStorage.setItem(PUSH_ACTIVE_KEY, '1');
    else await AsyncStorage.removeItem(PUSH_ACTIVE_KEY);
  } catch {
    // Best-effort.
  }
}

/** Is the Twilio-side push relay believed live? */
export async function isPushRelayActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_ACTIVE_KEY)) === '1';
  } catch {
    return false;
  }
}

/**
 * Foreground push receipts: a relay push landing while the app is open means
 * "their message just hit Twilio" — refresh that thread immediately instead
 * of waiting for the next poll tick. Returns an unsubscribe.
 */
export function subscribePushRefresh(): () => void {
  if (Platform.OS !== 'ios') return () => {};
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data as
      | { messageThread?: unknown }
      | undefined;
    const thread = typeof data?.messageThread === 'string' ? data.messageThread : null;
    if (!thread || thread.startsWith('tgc:')) return;
    void useMessages.getState().pollThread(thread);
  });
  return () => sub.remove();
}
