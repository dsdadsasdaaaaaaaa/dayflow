import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

/** Re-lock when the app was backgrounded longer than this. */
const RELOCK_AFTER_MS = 60_000;

/**
 * Face ID / passcode gate. When settings.appLock is on, children are hidden
 * behind an opaque lock screen until the user authenticates. Re-locks after
 * the app sits in the background for a minute.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const appLock = useSettings((s) => s.settings.appLock);
  const [locked, setLocked] = useState(appLock && Platform.OS !== 'web');
  const [authBusy, setAuthBusy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock DayFlow',
      });
      if (res.success) setLocked(false);
    } catch {
      // Stay locked; the button lets the user retry.
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy]);

  // Lock immediately when the setting turns on; unlock state resets on cold start.
  useEffect(() => {
    if (!appLock || Platform.OS === 'web') {
      setLocked(false);
      return;
    }
    setLocked(true);
    void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appLock]);

  // Re-lock after a long background stay.
  useEffect(() => {
    if (!appLock || Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active') {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS) {
          setLocked(true);
          void unlock();
        }
      }
    });
    return () => sub.remove();
  }, [appLock, unlock]);

  if (!locked) return <>{children}</>;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.center}>
        <View style={[styles.iconCircle, { backgroundColor: theme.accent }]}>
          <Ionicons name="lock-closed" size={34} color="#fff" />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>DayFlow is locked</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Your schedule and earnings stay private.
        </Text>
        <Pressable
          onPress={unlock}
          disabled={authBusy}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.accent, opacity: authBusy ? 0.6 : 1 },
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
        >
          <Ionicons name="finger-print" size={20} color="#fff" />
          <Text style={styles.buttonText}>Unlock</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, textAlign: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
