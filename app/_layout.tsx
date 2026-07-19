import * as QuickActions from 'expo-quick-actions';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockGate } from '../src/components/LockGate';
import { syncAllNotifications } from '../src/lib/notifications';
import { subscribeWidgetSync } from '../src/lib/widgetBridge';
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

  // Keep the 7-day local-notification window fresh whenever the app opens.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const refresh = () => syncAllNotifications(useTasks.getState().tasks);
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, []);

  // Mirror tasks/settings/session state into the widget App Group store.
  useEffect(() => subscribeWidgetSync(), []);

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
        </Stack>
        </LockGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
