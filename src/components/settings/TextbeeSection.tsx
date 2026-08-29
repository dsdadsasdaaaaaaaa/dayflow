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
import { verifyTextbeeCredentials } from '../../lib/textbee';
import {
  clearTextbeeCredentials,
  defaultTextbeeBase,
  loadTextbeeCredentials,
  saveTextbeeCredentials,
  type TextbeeCredentials,
} from '../../lib/textbeeCredentials';
import { useMessages } from '../../store/messages';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_SETUP =
  'Texting through a real SIM in an Android phone, with no per-message or ' +
  'per-request cost. textbee is open source and can run on your own server, ' +
  'so nobody meters it and nobody else holds your messages.';

const CAPTION_CONNECTED =
  'Texting and receiving run through your SIM at no cost. Photos need ' +
  'Telerivet below, which is the only part that is billed.';

/**
 * Settings → Own SIM. The unmetered half of the SIM line.
 *
 * Telerivet does the same job but charges per API call, which turned routine
 * polling into a running bill. This carries all the text and all the
 * receiving; Telerivet stays only for photos, since it is the one that can
 * send MMS. See lib/messaging for how a send is split.
 */
export function TextbeeSection() {
  const theme = useTheme();
  const refreshConfigured = useMessages((s) => s.refreshConfigured);

  const [connected, setConnected] = useState<TextbeeCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTextbeeCredentials().then((c) => {
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
    apiKey.trim().length > 0 &&
    deviceId.trim().length > 0 &&
    normalizePhone(fromNumber).length > 0;

  const connect = async () => {
    if (!canConnect) return;
    tapHaptic();
    const creds: TextbeeCredentials = {
      baseUrl: baseUrl.trim() || defaultTextbeeBase(),
      apiKey: apiKey.trim(),
      deviceId: deviceId.trim(),
      fromNumber: normalizePhone(fromNumber),
    };
    setBusy(true);
    try {
      const ok = await verifyTextbeeCredentials(creds);
      if (!ok) {
        warningHaptic();
        Alert.alert(
          'Could not connect',
          'The gateway rejected that key, or the address is wrong. Check the API key and server address from your textbee dashboard.'
        );
        return;
      }
      await saveTextbeeCredentials(creds);
      await refreshConfigured();
      setConnected(creds);
      setApiKey('');
      setDeviceId('');
      setFromNumber('');
      setBaseUrl('');
      successHaptic();
      Alert.alert(
        'SIM line connected',
        `Texting now runs through ${creds.fromNumber} with no per-message cost. Pick which line a conversation uses in the chat itself.`
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    Alert.alert(
      'Disconnect the free gateway?',
      'Texting from your SIM falls back to Telerivet if it is connected, which is billed per request, or to Twilio otherwise.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearTextbeeCredentials();
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
          sublabel={`${connected.fromNumber} · no per-message cost`}
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        <SettingsRow
          icon="close-circle"
          tint={taskColor('red').solid}
          label="Disconnect"
          sublabel="Stop using the free gateway"
          onPress={disconnect}
        />
      </SettingsSection>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, color: theme.text },
  ];

  return (
    <SettingsSection title="Own SIM" caption={CAPTION_SETUP}>
      <View style={styles.form}>
        <Text style={[styles.hint, { color: theme.textTertiary }]}>
          Install the textbee app on the Android phone holding your SIM,
          register it, then paste the API key and device id from the
          dashboard. Leave the server blank to use textbee&apos;s own.
        </Text>
        {[
          {
            label: 'API key',
            value: apiKey,
            set: setApiKey,
            placeholder: 'Your gateway API key',
            secure: true,
          },
          {
            label: 'Device ID',
            value: deviceId,
            set: setDeviceId,
            placeholder: 'The registered Android device',
            secure: false,
          },
          {
            label: "The SIM's number",
            value: fromNumber,
            set: setFromNumber,
            placeholder: '+1 (555) 123-4567',
            secure: false,
          },
          {
            label: 'Server (optional)',
            value: baseUrl,
            set: setBaseUrl,
            placeholder: defaultTextbeeBase(),
            secure: false,
          },
        ].map((f) => (
          <View key={f.label} style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
              {f.label}
            </Text>
            <TextInput
              value={f.value}
              onChangeText={f.set}
              placeholder={f.placeholder}
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
              style={[
                styles.connectLabel,
                { color: canConnect ? '#fff' : theme.textTertiary },
              ]}
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
  hint: { fontSize: 12, lineHeight: 17 },
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
