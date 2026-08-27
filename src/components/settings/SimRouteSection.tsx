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
import { verifyTelerivetCredentials } from '../../lib/telerivet';
import {
  clearTelerivetCredentials,
  loadTelerivetCredentials,
  saveTelerivetCredentials,
  type TelerivetCredentials,
} from '../../lib/telerivetCredentials';
import { useMessages } from '../../store/messages';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_SETUP =
  'Add a real SIM in an Android phone as a second line alongside Twilio. ' +
  'Carriers filter Twilio numbers as automated traffic no matter how ' +
  'ordinary the conversation is, which is what keeps burning numbers. A ' +
  'consumer SIM travels the normal person-to-person path, so there is no ' +
  'campaign to register and nothing to be rejected from.';

const CAPTION_CONNECTED =
  'Both lines are live. Each conversation picks which one it sends from, in ' +
  'the chat itself. New conversations start on Twilio.';

/**
 * Settings → Own SIM: connect a Telerivet project whose Android gateway holds
 * the SIM. Connecting is itself the switch — the messaging layer prefers this
 * route whenever these credentials exist, and falls back to Twilio the moment
 * they are removed (see lib/messaging).
 */
export function SimRouteSection() {
  const theme = useTheme();
  const refreshConfigured = useMessages((s) => s.refreshConfigured);

  const [connected, setConnected] = useState<TelerivetCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTelerivetCredentials().then((c) => {
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
    projectId.trim().length > 0 &&
    normalizePhone(fromNumber).length > 0;

  const connect = async () => {
    if (!canConnect) return;
    tapHaptic();
    const creds: TelerivetCredentials = {
      apiKey: apiKey.trim(),
      projectId: projectId.trim(),
      fromNumber: normalizePhone(fromNumber),
    };
    setBusy(true);
    try {
      const ok = await verifyTelerivetCredentials(creds);
      if (!ok) {
        warningHaptic();
        Alert.alert(
          'Could not connect',
          'Telerivet rejected that API key or project id. Both are on the project page under API settings.'
        );
        return;
      }
      await saveTelerivetCredentials(creds);
      await refreshConfigured();
      setConnected(creds);
      setApiKey('');
      setProjectId('');
      setFromNumber('');
      successHaptic();
      Alert.alert(
        'Second line added',
        `${creds.fromNumber} is now available alongside Twilio. Open any chat and pick which line it sends from — useful for the people who stopped receiving. Scheduled sending stays on Twilio.`
      );
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    Alert.alert(
      'Remove your SIM line?',
      'Every conversation goes back to Twilio, including any you moved onto the SIM. Nothing in your history is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await clearTelerivetCredentials();
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
          label="Second line ready"
          sublabel={connected.fromNumber}
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        <SettingsRow
          icon="close-circle"
          tint={taskColor('red').solid}
          label="Disconnect"
          sublabel="Put every conversation back on Twilio"
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
          Install the Telerivet Gateway app on a spare Android phone with your
          SIM in it, add it to a Telerivet project, then paste the project's
          API key and id here.
        </Text>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            API key
          </Text>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="Your Telerivet API key"
            placeholderTextColor={theme.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="Telerivet API key"
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            Project ID
          </Text>
          <TextInput
            value={projectId}
            onChangeText={setProjectId}
            placeholder="PJ…"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="Telerivet project id"
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            The SIM's number
          </Text>
          <TextInput
            value={fromNumber}
            onChangeText={setFromNumber}
            placeholder="+1 (555) 123-4567"
            placeholderTextColor={theme.textTertiary}
            keyboardType="phone-pad"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="The SIM's phone number"
          />
        </View>
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
