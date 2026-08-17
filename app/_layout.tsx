import * as Notifications from 'expo-notifications';
import * as QuickActions from 'expo-quick-actions';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockGate } from '../src/components/LockGate';
import { UndoToast } from '../src/components/UndoToast';
import { startAutoBackup } from '../src/lib/backup';
import { checkInboundNow, registerMessageAlerts } from '../src/lib/messageAlerts';
import {
  handleNotificationResponse,
  registerNotificationCategories,
  syncAllNotifications,
} from '../src/lib/notifications';
import {
  handleSafetyNotificationResponse,
  maybeEscalateForeground,
  registerSafetyCategory,
} from '../src/lib/safety';
import { subscribeWidgetSync } from '../src/lib/widgetBridge';
import { getPushTokenSafe, setPushRelayActive, subscribePushRefresh } from '../src/lib/push';
import { loadSmsCredentials } from '../src/lib/smsCredentials';
import { ensureVoiceFunctionCurrent } from '../src/lib/voiceApi';
import { useSettings } from '../src/store/settings';
import { useTelegram } from '../src/store/telegramAccount';
import { useTasks } from '../src/store/tasks';
import { useTheme } from '../src/theme';

const QUICK_ACTION_ROUTES: Record<string, string> = {
  'new-task': '/task-editor',
  inbox: '/inbox',
  clients: '/clients',
};

function openQuickAction(action: QuickActions.Action) {
  const href = QUICK_ACTION_ROUTES[action.id];
  if (href) router.push(href as never);
}

export default function RootLayout() {
  const theme = useTheme();
  /** Ids of notification responses already handled (avoids double-handling the launch response). */
  const handledResponseIds = useRef<Set<string>>(new Set());

  // Actionable notifications: register the Complete/Snooze category and route
  // action taps (including the one that may have launched the app) to the handler.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void registerNotificationCategories();
    void registerSafetyCategory();

    const handleOnce = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponseIds.current.has(id)) return;
      handledResponseIds.current.add(id);
      // Safety check-in responses ("I'm OK" / a tap on the escalation
      // warning) disarm the missed-check-in escalation.
      if (handleSafetyNotificationResponse(response)) return;
      const thread = response.notification.request.content.data?.messageThread;
      if (typeof thread === 'string' && thread) {
        // Defer so the navigator is mounted when launched from a notification.
        setTimeout(() => router.push(`/thread?number=${encodeURIComponent(thread)}`), 300);
        return;
      }
      void handleNotificationResponse(response);
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleOnce);
    // App may have been opened (from killed) via a notification action.
    Notifications.getLastNotificationResponseAsync()
      .then(handleOnce)
      .catch(() => {});
    return () => sub.remove();
  }, []);

  // Keep the 7-day local-notification window fresh whenever the app opens.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const refresh = () => syncAllNotifications(useTasks.getState().tasks);
    // Cold start races persist rehydration: syncing from an EMPTY tasks map
    // would cancel every scheduled alert. Wait for hydration first.
    if (useTasks.persist.hasHydrated()) refresh();
    else {
      const unsub = useTasks.persist.onFinishHydration(() => {
        unsub();
        refresh();
      });
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useTasks.persist.hasHydrated()) refresh();
    });
    return () => sub.remove();
  }, []);

  // Mirror tasks/settings/session state into the widget App Group store.
  useEffect(() => subscribeWidgetSync(), []);

  // Daily local backup (kept for 7 days, restorable from Settings → Data).
  useEffect(() => {
    startAutoBackup();
  }, []);

  // Inbound-message alerts: periodic background check + a check whenever the
  // app comes to the foreground (clients text first — never miss one).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void registerMessageAlerts();
    void checkInboundNow();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkInboundNow();
    });
    return () => sub.remove();
  }, []);

  // Self-healing voice deploy: TwiML fixes ship inside the app, but they only
  // protect the user once they're ON their Twilio account. Requiring a manual
  // "Save changes" tap left a real identity leak live for days — so the app
  // now rolls out voice-function updates itself, once per session, silently.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let attempted = false;
    const heal = async () => {
      if (attempted) return;
      const s = useSettings.getState().settings;
      attempted = true;
      try {
        const creds = await loadSmsCredentials();
        if (!creds) {
          attempted = false; // creds may appear after setup — retry later
          return;
        }
        // Push token (null when permission/APNs aren't there — fine, the
        // relay just stays token-less and polling covers freshness).
        const pushToken = await getPushTokenSafe();
        const result = await ensureVoiceFunctionCurrent(
          creds,
          {
            forwardTo: s.callForwardTo,
            showWorkNumber: s.callShowWorkNumber,
            greeting: s.voicemailGreeting,
          },
          pushToken
        );
        // Failure: retry next foreground (deploys are idempotent).
        if (!result.ok) attempted = false;
        await setPushRelayActive(result.ok && pushToken != null);
      } catch {
        attempted = false;
      }
    };
    void heal();
    const unsubPush = subscribePushRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void heal();
    });
    return () => {
      unsubPush();
      sub.remove();
    };
  }, []);

  // Telegram: connect at launch/foreground when chats are imported — waiting
  // until the Messages tab is opened left badges stale and updates dead.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const connect = () => {
      const s = useTelegram.getState();
      if (s.importedChatIds.length > 0) void s.connectAndSync();
    };
    if (useTelegram.persist.hasHydrated()) connect();
    else {
      const unsub = useTelegram.persist.onFinishHydration(() => {
        unsub();
        connect();
      });
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && useTelegram.persist.hasHydrated()) connect();
    });
    return () => sub.remove();
  }, []);

  // Missed-check-in escalation: check whenever the app runs. Foregrounding
  // is strong evidence the user is fine, so this path shows an "Everything
  // OK?" prompt with a 60s countdown instead of silently texting — only the
  // background task path (messageAlerts) sends without asking. The small
  // delay lets a launching notification response ("I'm OK", or a tap on the
  // warning/check-in reminder) disarm first — never prompt a user who just
  // responded.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const check = () => setTimeout(() => void maybeEscalateForeground(), 1200);
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  // Over-the-air updates: check when the app opens or foregrounds; a fetched
  // update applies silently on the next cold start. Best-effort, never blocks.
  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__) return;
    const check = async () => {
      try {
        const Updates = await import('expo-updates');
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline or updates unconfigured — fine.
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, []);

  // First run: present the welcome setup only AFTER the settings store has
  // rehydrated from disk — checking earlier would misread the default
  // onboardingDone=false and show the welcome to returning users.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      if (!useSettings.getState().settings.onboardingDone) {
        // Small defer so the navigator is mounted before the push.
        setTimeout(() => {
          if (!cancelled) router.push('/welcome');
        }, 250);
      }
    };
    if (useSettings.persist.hasHydrated()) {
      check();
      return () => {
        cancelled = true;
      };
    }
    const unsub = useSettings.persist.onFinishHydration(check);
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Home-screen quick actions (long-press the app icon).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let sub: { remove: () => void } | null = null;
    try {
      QuickActions.setItems([
        {
          id: 'new-task',
          title: 'New Task',
          subtitle: 'Plan something for today',
          icon: 'symbol:plus.circle.fill',
        },
        { id: 'inbox', title: 'Inbox', icon: 'symbol:tray.fill' },
        { id: 'clients', title: 'Clients', icon: 'symbol:person.2.fill' },
      ]);
      const initial = QuickActions.initial;
      if (initial) {
        // Defer past the first render so the navigator is mounted.
        setTimeout(() => openQuickAction(initial), 0);
      }
      sub = QuickActions.addListener(openQuickAction);
    } catch {
      // Quick actions unavailable (Expo Go / web) — skip silently.
    }
    return () => sub?.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <LockGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="task-editor"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="settings"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="habit-editor"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="meeting-live"
            options={{
              presentation: 'fullScreenModal',
              animation: 'slide_from_bottom',
              gestureEnabled: false,
            }}
          />
          <Stack.Screen name="clients" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="client-detail" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="thread" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="calls" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="search" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="settings-messaging" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="telegram-login" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="telegram-chats" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="week" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="welcome"
            options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: false }}
          />
        </Stack>
        <UndoToast />
        </LockGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
