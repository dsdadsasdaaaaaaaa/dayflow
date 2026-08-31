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
import { exportContacts, planContactExport } from '../../lib/telerivetContacts';
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
  'Telerivet sends photos from your SIM, which the free gateway above ' +
  'cannot do. It bills per request, so it is used only when a message has a ' +
  'photo attached, never for texting or for checking for replies.';

const CAPTION_CONNECTED =
  'Photos from your SIM go out through Telerivet. With the free line ' +
  'connected it is never polled, so it costs one request per photo and ' +
  'nothing else.';

/**
 * Settings → Photos from your SIM: a Telerivet project attached to the same
 * Android gateway. Kept only because it is the one route that can send MMS —
 * SMSGate carries the texting for free and does all the receiving, and this
 * is never polled, so a photo is the only thing that ever costs anything.
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
  const [exporting, setExporting] = useState<string | null>(null);

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

  /**
   * Copy everyone we have talked to into the Telerivet project. Blocked
   * people are excluded, and the count is shown before anything is sent
   * because each contact is one billable API call.
   */
  const runExport = () => {
    if (!connected || exporting) return;
    const plan = planContactExport();
    if (plan.entries.length === 0) {
      Alert.alert('Nothing to import', 'No conversations on this phone yet.');
      return;
    }
    Alert.alert(
      `Import ${plan.entries.length} contact${plan.entries.length === 1 ? '' : 's'}?`,
      `Everyone you have exchanged messages with goes into your Telerivet project${
        plan.blocked > 0
          ? `. ${plan.blocked} blocked ${plan.blocked === 1 ? 'person is' : 'people are'} left out`
          : ''
      }.\n\nOn the Test plan contacts are capped at 50 and Telerivet already creates one automatically for every number it sees, so this can fill the allowance. Only worth doing if you actually intend to message people from Telerivet's own dashboard.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            tapHaptic();
            setExporting(`0 of ${plan.entries.length}`);
            try {
              const res = await exportContacts(connected, plan, (done, total) =>
                setExporting(`${done} of ${total}`)
              );
              successHaptic();
              Alert.alert(
                'Imported',
                `${res.added} contact${res.added === 1 ? '' : 's'} are now in Telerivet${
                  res.failed > 0 ? `, ${res.failed} could not be added` : ''
                }.`
              );
            } finally {
              setExporting(null);
            }
          },
        },
      ]
    );
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
      <SettingsSection title="Photos from your SIM" caption={CAPTION_CONNECTED}>
        <SettingsRow
          icon="hardware-chip"
          tint={taskColor('green').solid}
          label="Second line ready"
          sublabel={connected.fromNumber}
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        <SettingsRow
          icon="cloud-upload"
          tint={taskColor('sky').solid}
          label="Import contacts to Telerivet"
          sublabel={
            exporting
              ? `Importing ${exporting}…`
              : 'Everyone you have messaged, except blocked people'
          }
          onPress={runExport}
          right={
            exporting ? (
              <ActivityIndicator size="small" color={theme.textTertiary} />
            ) : undefined
          }
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
    <SettingsSection title="Photos from your SIM" caption={CAPTION_SETUP}>
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
