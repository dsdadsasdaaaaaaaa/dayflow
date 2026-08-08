import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../store/settings';
import { useTheme } from '../theme';

/**
 * Face ID / passcode gate. When settings.appLock is on, children are hidden
 * behind an opaque lock screen until the user authenticates.
 *
 * Re-lock timing comes from settings.appLockGraceSeconds: re-lock when the
 * app was backgrounded longer than the grace, and 0 = immediately (ANY exit
 * from the 'active' AppState requires re-auth on return).
 *
 * FAIL-OPEN BY DESIGN: if authentication is impossible (Face ID permission
 * denied for the app, biometrics not enrolled, no passcode set), the gate
 * unlocks and disables the lock with an explanation — this is the user's own
 * device and data; a broken lock must never trap them out of their app.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const appLock = useSettings((s) => s.settings.appLock);
  const graceSeconds = useSettings((s) => s.settings.appLockGraceSeconds);
  const [locked, setLocked] = useState(appLock && Platform.OS !== 'web');
  // Opaque privacy cover shown whenever the app is not 'active' — it is what
  // the iOS app-switcher snapshot captures, so it must engage on 'inactive'
  // (before the snapshot), independent of the slower auth lock.
  const [covered, setCovered] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  // True while OUR Face ID sheet is up — the sheet itself flips AppState to
  // 'inactive', and treating that as "left the app" in Immediately mode
  // would re-lock on every successful unlock (an endless prompt loop).
  const authInProgress = useRef(false);
  // Immediately mode: set when the app leaves 'active'; consumed on return.
  const relockPending = useRef(false);

  const failOpen = useCallback((reason: string) => {
    setLocked(false);
    setHint(null);
    useSettings.getState().update({ appLock: false });
    Alert.alert(
      'App lock turned off',
      `${reason} The lock was disabled so you are never locked out of your own data. ` +
        'You can turn it back on in Settings → Privacy once Face ID or a passcode is available ' +
        '(check iOS Settings → DayFlow → Face ID).'
    );
  }, []);

  const lastAttemptAt = useRef(0);

  const unlock = useCallback(async () => {
    if (authBusy) return;
    // Debounce: never stack a second system prompt on top of (or immediately
    // after) another — this is what makes "it keeps prompting me" impossible.
    if (Date.now() - lastAttemptAt.current < 1500) return;
    lastAttemptAt.current = Date.now();
    setAuthBusy(true);
    authInProgress.current = true;
    setHint(null);
    try {
      const [hasHardware, enrolled, secLevel] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.getEnrolledLevelAsync(),
      ]);

      // Nothing on this device can authenticate → never trap the user.
      if (secLevel === LocalAuthentication.SecurityLevel.NONE) {
        failOpen('No Face ID or device passcode is set up on this phone.');
        return;
      }

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock DayFlow',
        cancelLabel: 'Cancel',
        // Explicitly allow the device passcode as a fallback path.
        disableDeviceFallback: false,
      });

      if (res.success) {
        lastAttemptAt.current = 0;
        setLocked(false);
        setHint(null);
        return;
      }

      const err = res.error;
      if (
        err === 'not_available' ||
        err === 'not_enrolled' ||
        err === 'passcode_not_set' ||
        (!hasHardware && !enrolled)
      ) {
        // Face ID permission denied for the app / biometrics unusable, and the
        // system produced no passcode sheet either.
        failOpen('Face ID is not available for DayFlow right now.');
        return;
      }
      if (err === 'lockout') {
        setHint('Face ID is temporarily locked — tap Unlock and use your passcode.');
        return;
      }
      if (err === 'user_cancel' || err === 'system_cancel' || err === 'app_cancel') {
        setHint('Tap Unlock to try again.');
        return;
      }
      // Unknown failure: show the actual reason so it's never a silent no-op.
      setHint(`Couldn’t unlock (${err ?? 'unknown'}) — tap Unlock to try again.`);
    } catch (e) {
      setHint(
        `Couldn’t start Face ID (${e instanceof Error ? e.message : 'error'}) — tap Unlock to try again.`
      );
    } finally {
      authInProgress.current = false;
      setAuthBusy(false);
    }
  }, [authBusy, failOpen]);

  // Lock when the setting turns on; auto-prompt shortly after launch (the
  // small delay avoids iOS cancelling a prompt fired mid-transition).
  useEffect(() => {
    if (!appLock || Platform.OS === 'web') {
      setLocked(false);
      return;
    }
    setLocked(true);
    const t = setTimeout(() => void unlock(), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appLock]);

  // Cover the moment the app leaves 'active' (hides the switcher snapshot);
  // re-lock per the user's grace setting (0 = any exit from 'active').
  useEffect(() => {
    if (!appLock || Platform.OS === 'web') {
      setCovered(false);
      return;
    }
    const graceMs = Math.max(0, graceSeconds) * 1000;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        // 'inactive' fires on the way to the switcher — cover synchronously.
        // (It also fires during the Face ID sheet; harmless, the system UI
        // is on top and the cover clears when we return to 'active'.)
        setCovered(true);
        if (state === 'background') backgroundedAt.current = Date.now();
        // Immediately mode: ANY exit from 'active' demands re-auth — except
        // the 'inactive' blip caused by our own Face ID sheet (see ref note).
        if (graceMs === 0 && !authInProgress.current) relockPending.current = true;
      } else {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
        backgroundedAt.current = null;
        const mustRelock = relockPending.current || away > graceMs;
        relockPending.current = false;
        if (mustRelock) {
          setLocked(true);
          setTimeout(() => void unlock(), 350);
        }
        setCovered(false);
      }
    });
    return () => sub.remove();
  }, [appLock, graceSeconds, unlock]);

  // The app ALWAYS renders underneath; the lock is an opaque cover on top.
  // (Never conditionally unmount the navigator — a successful unlock must
  // only have to remove a view, not boot the whole app tree.)
  return (
    <View style={styles.host}>
      {children}
      {locked ? (
        <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background }]}>
          <View style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: theme.accent }]}>
              <Ionicons name="lock-closed" size={34} color="#fff" />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>DayFlow is locked</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {hint ?? 'Your schedule and earnings stay private.'}
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
      ) : null}
      {covered ? (
        // Plain opaque cover (no blur — snapshots keep blurred content legible
        // enough to read). Sits above the lock screen too so nothing leaks.
        <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: theme.background }]}>
          <View style={[styles.iconCircle, { backgroundColor: theme.accent }]}>
            <Ionicons name="lock-closed" size={34} color="#fff" />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  root: { zIndex: 10000, elevation: 10000 },
  cover: {
    zIndex: 10001,
    elevation: 10001,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  subtitle: { fontSize: 14, textAlign: 'center', minHeight: 18 },
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
