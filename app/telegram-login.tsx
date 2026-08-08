import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { GlassCard } from '../src/components/glass/GlassCard';
import { successHaptic, tapHaptic, warningHaptic } from '../src/lib/haptics';
import {
  onTdUpdate,
  tdAvailable,
  tdLogin,
  tdStart,
  tdVerifyCode,
  tdVerifyPassword,
  type TdAuthState,
} from '../src/lib/tdlib';
import {
  loadTelegramCredentials,
  saveTelegramCredentials,
} from '../src/lib/telegramCredentials';
import { useTelegram } from '../src/store/telegramAccount';
import { SPACING, useTheme } from '../src/theme';

type Step = 'api' | 'phone' | 'code' | 'password';

const STEP_TITLES: Record<Step, string> = {
  api: 'Your API keys',
  phone: 'Your phone number',
  code: 'Enter the code',
  password: 'Two-step password',
};

const GUIDE_STEPS = [
  'Open my.telegram.org and sign in with your Telegram phone number.',
  'Choose “API development tools”.',
  'Create an app — any name works, it’s free — then copy the api_id and api_hash below.',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Solid-accent primary button with a busy spinner. */
function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const blocked = disabled || busy;
  return (
    <Pressable
      onPress={() => {
        if (blocked) return;
        tapHaptic();
        onPress();
      }}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.primaryBtn,
        {
          backgroundColor: theme.accent,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !blocked ? 0.98 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Connect the user's own Telegram account: API keys → phone → login code →
 * optional two-step password. Steps follow TDLib's live authorization state.
 * On binaries without the native module this renders a single friendly card.
 */
export default function TelegramLoginScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const refreshAuth = useTelegram((s) => s.refreshAuth);

  const available = tdAvailable();

  const [step, setStep] = useState<Step>('api');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Route to the chat picker exactly once when TDLib reports ready. */
  const routedRef = useRef(false);

  const applyAuthState = useCallback(
    (state: TdAuthState) => {
      switch (state) {
        case 'waitCode':
          setStep('code');
          return;
        case 'waitPassword':
          setStep('password');
          return;
        case 'ready':
          if (routedRef.current) return;
          routedRef.current = true;
          successHaptic();
          router.replace('/telegram-chats');
          return;
        case 'waitPhone':
          // Only advance forward — never yank the user back mid-step.
          setStep((prev) => (prev === 'api' ? 'phone' : prev));
          return;
        default:
          return;
      }
    },
    [router]
  );

  // TDLib settles auth transitions asynchronously — after each action we
  // poll for a few seconds (events below usually beat the poll).
  const pollAuth = useCallback(async () => {
    for (let i = 0; i < 6; i += 1) {
      const state = await refreshAuth();
      applyAuthState(state);
      if (state === 'waitCode' || state === 'waitPassword' || state === 'ready') return;
      await sleep(700);
    }
  }, [refreshAuth, applyAuthState]);

  // Live auth-state events (fire while this screen is open).
  useEffect(() => {
    if (!available) return;
    return onTdUpdate((u) => {
      if (u.kind === 'authState') applyAuthState(u.state);
    });
  }, [available, applyAuthState]);

  // Resume where the user left off: saved keys skip straight to the phone step.
  useEffect(() => {
    if (!available) return;
    let alive = true;
    (async () => {
      const creds = await loadTelegramCredentials();
      if (!alive) return;
      if (creds) {
        setApiId(String(creds.apiId));
        setStep('phone');
        await tdStart();
        if (!alive) return;
        applyAuthState(await refreshAuth());
      }
    })();
    return () => {
      alive = false;
    };
  }, [available, refreshAuth, applyAuthState]);

  const openTelegramSite = () => {
    tapHaptic();
    Linking.openURL('https://my.telegram.org').catch(() => {});
  };

  const submitApi = async () => {
    const id = Number(apiId.trim());
    const hash = apiHash.trim();
    if (!Number.isInteger(id) || id <= 0 || !hash) return;
    setBusy(true);
    setError(null);
    try {
      await saveTelegramCredentials({ apiId: id, apiHash: hash });
      const started = await tdStart();
      if (!started.ok) {
        warningHaptic();
        setError(started.error);
        return;
      }
      setStep('phone');
      void pollAuth();
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = async () => {
    const cc = countryCode.trim();
    const number = phone.trim();
    if (!cc || !number) return;
    setBusy(true);
    setError(null);
    try {
      const res = await tdLogin(cc, number);
      if (!res.ok) {
        warningHaptic();
        setError(res.error);
        return;
      }
      setStep('code');
      void pollAuth();
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    const otp = code.trim();
    if (!otp) return;
    setBusy(true);
    setError(null);
    try {
      const res = await tdVerifyCode(otp);
      if (!res.ok) {
        warningHaptic();
        setError(res.error);
        return;
      }
      await pollAuth();
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await tdVerifyPassword(password);
      setPassword('');
      if (!res.ok) {
        warningHaptic();
        setError(res.error);
        return;
      }
      await pollAuth();
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.surface, color: theme.text }];
  const fieldLabelStyle = [styles.fieldLabel, { color: theme.textTertiary }];

  const renderStep = () => {
    switch (step) {
      case 'api':
        return (
          <GlassCard>
            <View style={styles.cardInner}>
              <Text style={[styles.stepBody, { color: theme.textSecondary }]}>
                Telegram gives every account free API keys. Three quick steps:
              </Text>
              {GUIDE_STEPS.map((line, i) => (
                <View key={i} style={styles.guideRow}>
                  <View style={[styles.guideNum, { backgroundColor: theme.accentSoft }]}>
                    <Text style={[styles.guideNumText, { color: theme.accent }]}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.guideText, { color: theme.textSecondary }]}>{line}</Text>
                </View>
              ))}
              <Pressable
                onPress={openTelegramSite}
                accessibilityRole="link"
                accessibilityLabel="Open my.telegram.org"
                style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="open-outline" size={15} color={theme.accent} />
                <Text style={[styles.linkText, { color: theme.accent }]}>
                  Open my.telegram.org
                </Text>
              </Pressable>
              <View style={styles.field}>
                <Text style={fieldLabelStyle}>api_id</Text>
                <TextInput
                  value={apiId}
                  onChangeText={setApiId}
                  placeholder="1234567"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="number-pad"
                  autoCorrect={false}
                  style={inputStyle}
                  accessibilityLabel="Telegram api_id"
                />
              </View>
              <View style={styles.field}>
                <Text style={fieldLabelStyle}>api_hash</Text>
                <TextInput
                  value={apiHash}
                  onChangeText={setApiHash}
                  placeholder="Long string of letters and numbers"
                  placeholderTextColor={theme.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={inputStyle}
                  accessibilityLabel="Telegram api_hash"
                />
              </View>
              <PrimaryButton
                label="Continue"
                onPress={() => void submitApi()}
                disabled={!Number.isInteger(Number(apiId.trim())) || Number(apiId.trim()) <= 0 || !apiHash.trim()}
                busy={busy}
              />
            </View>
          </GlassCard>
        );
      case 'phone':
        return (
          <GlassCard>
            <View style={styles.cardInner}>
              <Text style={[styles.stepBody, { color: theme.textSecondary }]}>
                The phone number on your Telegram account. Telegram will send a
                sign-in code — no SMS charges, nothing changes on your account.
              </Text>
              <View style={styles.phoneRow}>
                <View style={styles.ccField}>
                  <Text style={fieldLabelStyle}>Country</Text>
                  <TextInput
                    value={countryCode}
                    onChangeText={setCountryCode}
                    placeholder="+1"
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    style={inputStyle}
                    accessibilityLabel="Country code"
                  />
                </View>
                <View style={styles.numberField}>
                  <Text style={fieldLabelStyle}>Phone number</Text>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="555 123 4567"
                    placeholderTextColor={theme.textTertiary}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    style={inputStyle}
                    accessibilityLabel="Telegram phone number"
                  />
                </View>
              </View>
              <PrimaryButton
                label="Send code"
                onPress={() => void submitPhone()}
                disabled={!countryCode.trim() || !phone.trim()}
                busy={busy}
              />
            </View>
          </GlassCard>
        );
      case 'code':
        return (
          <GlassCard>
            <View style={styles.cardInner}>
              <Text style={[styles.stepBody, { color: theme.textSecondary }]}>
                Telegram sent a code to your other devices — check your Telegram
                app.
              </Text>
              <View style={styles.field}>
                <Text style={fieldLabelStyle}>Login code</Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="12345"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="number-pad"
                  autoCorrect={false}
                  autoFocus
                  style={inputStyle}
                  accessibilityLabel="Telegram login code"
                />
              </View>
              <PrimaryButton
                label="Verify"
                onPress={() => void submitCode()}
                disabled={!code.trim()}
                busy={busy}
              />
            </View>
          </GlassCard>
        );
      case 'password':
        return (
          <GlassCard>
            <View style={styles.cardInner}>
              <Text style={[styles.stepBody, { color: theme.textSecondary }]}>
                Your account has two-step verification. Enter your Telegram
                password — it’s used once to sign in and never stored.
              </Text>
              <View style={styles.field}>
                <Text style={fieldLabelStyle}>Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Telegram password"
                  placeholderTextColor={theme.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  style={inputStyle}
                  accessibilityLabel="Telegram two-step password"
                />
              </View>
              <PrimaryButton
                label="Sign in"
                onPress={() => void submitPassword()}
                disabled={!password}
                busy={busy}
              />
            </View>
          </GlassCard>
        );
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>Connect Telegram</Text>
          {available ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {STEP_TITLES[step]}
            </Text>
          ) : null}
        </View>
      </View>

      {available ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderStep()}
            {error ? (
              <Text
                style={[styles.error, { color: theme.danger }]}
                accessibilityLabel={`Error: ${error}`}
              >
                {error}
              </Text>
            ) : null}
            <Text style={[styles.privacyNote, { color: theme.textTertiary }]}>
              Your keys stay in this phone’s keychain. Only chats you choose to
              import ever appear in DayFlow.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.content}>
          <GlassCard>
            <View style={styles.unavailableInner}>
              <View style={[styles.unavailableIcon, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name="paper-plane-outline" size={26} color={theme.accent} />
              </View>
              <Text style={[styles.unavailableTitle, { color: theme.text }]}>
                Telegram arrives with the next app build
              </Text>
              <Text style={[styles.unavailableBody, { color: theme.textSecondary }]}>
                This version of DayFlow was installed before Telegram support.
                Once the next build reaches your phone, you can connect your
                account right here.
              </Text>
            </View>
          </GlassCard>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  headerText: { flex: 1, gap: 1 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, fontWeight: '600' },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  cardInner: { gap: 12 },
  stepBody: { fontSize: 14, lineHeight: 20 },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guideNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  guideNumText: { fontSize: 12, fontWeight: '700' },
  guideText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  linkText: { fontSize: 14, fontWeight: '600' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  phoneRow: { flexDirection: 'row', gap: 10 },
  ccField: { width: 82, gap: 6 },
  numberField: { flex: 1, gap: 6 },
  primaryBtn: {
    marginTop: 2,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: SPACING.md,
    marginHorizontal: 6,
    fontWeight: '600',
  },
  privacyNote: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: SPACING.lg,
    marginHorizontal: 6,
  },
  unavailableInner: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  unavailableIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  unavailableBody: {
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
  },
});
