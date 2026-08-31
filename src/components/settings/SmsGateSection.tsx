import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { normalizePhone } from '../../lib/smsCredentials';
import {
  registerSmsGateWebhook,
  verifySmsGateCredentials,
  webhookUrlFor,
} from '../../lib/smsgate';
import {
  clearSmsGateCredentials,
  defaultSmsGateBase,
  loadSmsGateCredentials,
  saveSmsGateCredentials,
  type SmsGateCredentials,
} from '../../lib/smsgateCredentials';
import { useMessages } from '../../store/messages';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_SETUP =
  'Texting through your own SIM at no cost. SMSGate sends from anywhere for ' +
  'free; a small Worker you deploy catches incoming messages so this app can ' +
  'read them. Setup steps are in worker/README.md in the project.';

const CAPTION_CONNECTED =
  'Texting and receiving run through your SIM for free. Photos still go ' +
  'through Telerivet below, which is the only part that is billed.';

/**
 * Settings → Own SIM, served by SMSGate plus the user's own inbox relay.
 *
 * Two addresses rather than one because the free setup is genuinely two
 * pieces: SMSGate's cloud can send from anywhere but only delivers received
 * messages by webhook, so the Worker exists to hold them for polling.
 */
export function SmsGateSection() {
  const theme = useTheme();
  const refreshConfigured = useMessages((s) => s.refreshConfigured);

  const [connected, setConnected] = useState<SmsGateCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inboxUrl, setInboxUrl] = useState('');
  const [inboxSecret, setInboxSecret] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSmsGateCredentials().then((c) => {
      if (!alive) return;
      setConnected(c);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const canConnect =
    !busy &&
    username.trim().length > 0 &&
    password.trim().length > 0 &&
    normalizePhone(fromNumber).length > 0;

  const connect = async () => {
    if (!canConnect) return;
    tapHaptic();
    const creds: SmsGateCredentials = {
      baseUrl: defaultSmsGateBase(),
      username: username.trim(),
      password: password.trim(),
      inboxUrl: inboxUrl.replace(/\s+/g, '').replace(/\/+$/, ''),
      inboxSecret: inboxSecret.replace(/\s+/g, ''),
      fromNumber: normalizePhone(fromNumber),
    };
    setBusy(true);
    try {
      const res = await verifySmsGateCredentials(creds);
      if (!res.ok) {
        warningHaptic();
        Alert.alert('Could not connect', res.error);
        return;
      }
      // Point SMSGate at the relay here rather than leaving it as a manual
      // last step. Getting this wrong is invisible: sending keeps working
      // while nothing ever comes back.
      const hook = creds.inboxUrl
        ? await registerSmsGateWebhook(creds)
        : ({ ok: false, error: 'no relay' } as const);

      await saveSmsGateCredentials(creds);
      await refreshConfigured();
      setConnected(creds);
      setUsername('');
      setPassword('');
      setInboxUrl('');
      setInboxSecret('');
      setFromNumber('');
      successHaptic();
      if (!creds.inboxUrl) {
        Alert.alert(
          'Sending only',
          'Texts will send from your SIM, but without a relay address nothing incoming can reach the app. Add the Worker URL to receive replies.'
        );
      } else if (hook.ok) {
        Alert.alert(
          'SIM line connected',
          `Texting runs through ${creds.fromNumber} at no cost, and incoming messages are wired up${
            hook.created ? '' : ' (already were)'
          }. Pick which line a conversation uses in the chat itself.`
        );
      } else {
        // Everything works except receiving, and that is worth saying loudly
        // along with the exact URL to paste, rather than a vague failure.
        Alert.alert(
          'Connected, but incoming needs one step',
          `Sending works. DayFlow could not register the webhook automatically (${hook.error}).\n\nAdd it in SMSGate manually, event "sms:received", URL:\n\n${webhookUrlFor(creds)}`
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    Alert.alert(
      'Disconnect the free SIM line?',
      'Texting from your SIM falls back to Telerivet if it is connected, which is billed per request, or to Twilio otherwise.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearSmsGateCredentials();
            await refreshConfigured();
            setConnected(null);
            successHaptic();
          },
        },
      ]
    );
  };

  if (!loaded) return null;

  if (connected) {
    return (
      <SettingsSection title="Own SIM" caption={CAPTION_CONNECTED}>
        <SettingsRow
          icon="hardware-chip"
          tint={taskColor('green').solid}
          label="Texting from your SIM"
          sublabel={`${connected.fromNumber} · free`}
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        {!connected.inboxUrl ? (
          <SettingsRow
            icon="warning"
            tint={taskColor('amber').solid}
            label="No inbox relay"
            sublabel="Sending works, but replies cannot reach the app"
          />
        ) : null}
        <SettingsRow
          icon="close-circle"
          tint={taskColor('red').solid}
          label="Disconnect"
          sublabel="Stop using the free SIM line"
          onPress={disconnect}
        />
      </SettingsSection>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, color: theme.text },
  ];

  const fields = [
    { label: 'SMSGate username', value: username, set: setUsername, ph: "From the app's Home tab", secure: false },
    { label: 'SMSGate password', value: password, set: setPassword, ph: "From the app's Home tab", secure: true },
    { label: 'Inbox relay URL', value: inboxUrl, set: setInboxUrl, ph: 'https://…workers.dev', secure: false },
    { label: 'Relay secret', value: inboxSecret, set: setInboxSecret, ph: 'The Worker SHARED_SECRET', secure: true },
    { label: "The SIM's number", value: fromNumber, set: setFromNumber, ph: '+1 (555) 123-4567', secure: false },
  ];

  return (
    <SettingsSection title="Own SIM" caption={CAPTION_SETUP}>
      <View style={styles.form}>
        {fields.map((f) => (
          <View key={f.label} style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>{f.label}</Text>
            <TextInput
              value={f.value}
              onChangeText={f.set}
              placeholder={f.ph}
              placeholderTextColor={theme.textTertiary}
              secureTextEntry={f.secure}
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle}
              accessibilityLabel={f.label}
            />
          </View>
        ))}
        <Pressable
          onPress={connect}
          disabled={!canConnect}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.connectBtn,
            {
              backgroundColor: canConnect ? theme.accent : theme.surface,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text
              style={[styles.connectLabel, { color: canConnect ? '#fff' : theme.textTertiary }]}
            >
              Connect
            </Text>
          )}
        </Pressable>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  connectBtn: {
    marginTop: 2,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  connectLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
