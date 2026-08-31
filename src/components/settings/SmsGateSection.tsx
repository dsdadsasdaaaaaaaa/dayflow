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
  diagnoseSmsGate,
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
  const resyncAll = useMessages((s) => s.resyncAll);

  const [connected, setConnected] = useState<SmsGateCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inboxUrl, setInboxUrl] = useState('');
  const [inboxSecret, setInboxSecret] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resyncing, setResyncing] = useState(false);

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
      // Only an SMSGate failure is fatal: without it nothing can send. A
      // relay problem is worth saying loudly but must NOT abort, because
      // aborting also skipped registering the webhook — so a mistyped secret
      // silently cost the user all incoming messages, which is the opposite
      // of what that check was for.
      const relayProblem = !res.ok && /relay|secret|Worker/i.test(res.error);
      if (!res.ok && !relayProblem) {
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
      if (relayProblem) {
        warningHaptic();
        Alert.alert(
          'Sending works, receiving does not',
          `${!res.ok ? res.error : ''}\n\nEverything else is saved and the webhook is ${
            hook.ok ? 'registered' : 'NOT registered'
          }. Fix the relay details and reconnect, then use Check setup.`
        );
      } else if (!creds.inboxUrl) {
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

  /**
   * Walk the whole inbound path and say where it stops. Four separate things
   * have to be right and all four fail identically as "no messages", so
   * without this the only way to find the broken one is to guess.
   */
  const runCheck = async () => {
    if (!connected || checking) return;
    tapHaptic();
    setChecking(true);
    try {
      const d = await diagnoseSmsGate(connected);
      const body = d.problem
        ? `${d.lines.join('\n')}\n\n${d.problem}`
        : `${d.lines.join('\n')}\n\nEverything is wired up. If messages still are not arriving, the Android app is likely not running: check it is open and that battery optimisation is disabled for it.`;
      Alert.alert(d.problem ? 'Found the problem' : 'Setup looks right', body, [
        { text: 'OK' },
        ...(d.problem
          ? [
              {
                text: 'Re-register webhook',
                onPress: async () => {
                  const r = await registerSmsGateWebhook(connected);
                  Alert.alert(
                    r.ok ? 'Webhook registered' : 'Could not register',
                    r.ok
                      ? r.created
                        ? 'SMSGate will now send incoming messages to your relay.'
                        : 'It was already registered.'
                      : `${r.error}\n\nAdd it by hand in SMSGate, event "sms:received", URL:\n\n${webhookUrlFor(connected)}`
                  );
                },
              },
            ]
          : []),
      ]);
    } finally {
      setChecking(false);
    }
  };

  /**
   * Pull the relay from scratch. Needed after importing history, because a
   * routine sync only asks for messages newer than the last one it saw and
   * imported history is by definition older than that.
   */
  const runResync = async () => {
    if (resyncing) return;
    tapHaptic();
    setResyncing(true);
    try {
      const before = Object.keys(useMessages.getState().messages).length;
      await resyncAll();
      const after = Object.keys(useMessages.getState().messages).length;
      successHaptic();
      Alert.alert(
        'Re-synced',
        after > before
          ? `${after - before} message${after - before === 1 ? '' : 's'} pulled in that were missing. ${after} in total now.`
          : `Nothing new — all ${after} messages were already here.`
      );
    } finally {
      setResyncing(false);
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
          icon="refresh"
          tint={taskColor('violet').solid}
          label="Re-sync all messages"
          sublabel={
            resyncing ? 'Pulling everything…' : 'Pull the full history, including imports'
          }
          onPress={runResync}
          right={
            resyncing ? <ActivityIndicator size="small" color={theme.textTertiary} /> : undefined
          }
        />
        <SettingsRow
          icon="pulse"
          tint={taskColor('sky').solid}
          label="Check setup"
          sublabel={checking ? 'Checking…' : 'Find why messages are not arriving'}
          onPress={runCheck}
          right={
            checking ? <ActivityIndicator size="small" color={theme.textTertiary} /> : undefined
          }
        />
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
