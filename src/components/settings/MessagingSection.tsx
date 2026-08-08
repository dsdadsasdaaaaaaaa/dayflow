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
import { verifySmsCredentials } from '../../lib/smsApi';
import {
  clearSmsCredentials,
  loadSmsCredentials,
  normalizePhone,
  saveSmsCredentials,
  type SmsCredentials,
} from '../../lib/smsCredentials';
import { useMessages } from '../../store/messages';
import { taskColor, useTheme } from '../../theme';
import { PhotoQuickReplies } from './PhotoQuickReplies';
import { QuickRepliesEditor } from './QuickRepliesEditor';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_SETUP =
  'Works with any Twilio number — buy one for ~$1/mo or port your existing ' +
  'number in the Twilio console. Messages are between your phone and your ' +
  'Twilio account only.';
const CAPTION_CONNECTED =
  'Messages are between your phone and your Twilio account only.';

type Busy = 'connect' | 'test' | null;

/**
 * Settings → Messaging: connect the user's own Twilio account for in-app
 * client texting. Credentials go straight to the keychain (smsCredentials);
 * nothing touches app storage or backups.
 */
export function MessagingSection() {
  const theme = useTheme();

  const configured = useMessages((s) => s.configured);
  const refreshConfigured = useMessages((s) => s.refreshConfigured);
  const clearAll = useMessages((s) => s.clearAll);

  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [connectedNumber, setConnectedNumber] = useState<string | null>(null);

  // Know which state to render as soon as the screen opens.
  useEffect(() => {
    refreshConfigured();
  }, [refreshConfigured]);

  // Surface the connected number (read back from the keychain, never cached).
  useEffect(() => {
    if (!configured) {
      setConnectedNumber(null);
      return;
    }
    let alive = true;
    loadSmsCredentials().then((creds) => {
      if (alive) setConnectedNumber(creds?.fromNumber ?? null);
    });
    return () => {
      alive = false;
    };
  }, [configured]);

  const canConnect =
    busy === null &&
    sid.trim().length > 0 &&
    token.trim().length > 0 &&
    normalizePhone(fromNumber).length > 0;

  const connect = async () => {
    if (!canConnect) return;
    tapHaptic();
    const creds: SmsCredentials = {
      accountSid: sid.trim(),
      authToken: token.trim(),
      fromNumber: normalizePhone(fromNumber),
    };
    setBusy('connect');
    try {
      const ok = await verifySmsCredentials(creds);
      if (!ok) {
        warningHaptic();
        Alert.alert('Connection failed', 'Check the SID/token — Twilio rejected them.');
        return;
      }
      await saveSmsCredentials(creds);
      await refreshConfigured();
      setSid('');
      setToken('');
      setFromNumber('');
      successHaptic();
      Alert.alert('Messaging connected', `Texts will send from ${creds.fromNumber}.`);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (busy) return;
    setBusy('test');
    try {
      const creds = await loadSmsCredentials();
      const ok = creds != null && (await verifySmsCredentials(creds));
      if (ok) {
        successHaptic();
        Alert.alert('Connection OK', 'Twilio accepted your saved credentials.');
      } else {
        warningHaptic();
        Alert.alert('Connection failed', 'Check the SID/token — Twilio rejected them.');
      }
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect messaging?',
      'Your Twilio credentials are removed from this phone and the local message history is cleared. Nothing changes in your Twilio account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            warningHaptic();
            await clearSmsCredentials();
            clearAll();
            await refreshConfigured();
          },
        },
      ]
    );
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, color: theme.text },
  ];

  if (configured) {
    return (
      <SettingsSection title="Messaging" caption={CAPTION_CONNECTED}>
        <SettingsRow
          icon="chatbubbles"
          tint={taskColor('cyan').solid}
          label="Connected number"
          sublabel={connectedNumber ?? ' '}
          right={
            <Ionicons name="checkmark-circle" size={22} color={theme.success} />
          }
        />
        <SettingsRow
          icon="pulse"
          tint={taskColor('sky').solid}
          label="Test"
          sublabel="Ping Twilio with your saved keys"
          onPress={test}
          right={
            busy === 'test' ? (
              <ActivityIndicator size="small" color={theme.textTertiary} />
            ) : undefined
          }
        />
        <QuickRepliesEditor />
        <PhotoQuickReplies />
        <SettingsRow
          icon="unlink"
          tint={theme.danger}
          label="Disconnect"
          destructive
          onPress={confirmDisconnect}
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Messaging" caption={CAPTION_SETUP}>
      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            Account SID
          </Text>
          <TextInput
            value={sid}
            onChangeText={setSid}
            placeholder="AC…"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="Twilio Account SID"
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            Auth Token
          </Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Your auth token"
            placeholderTextColor={theme.textTertiary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="Twilio Auth Token"
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
            Your number
          </Text>
          <TextInput
            value={fromNumber}
            onChangeText={setFromNumber}
            placeholder="+1 (555) 123-4567"
            placeholderTextColor={theme.textTertiary}
            keyboardType="phone-pad"
            autoCorrect={false}
            style={inputStyle}
            accessibilityLabel="Your Twilio number"
          />
        </View>
        <Pressable
          onPress={connect}
          disabled={!canConnect}
          accessibilityRole="button"
          accessibilityLabel="Connect messaging"
          style={({ pressed }) => [
            styles.connectBtn,
            {
              backgroundColor: theme.accent,
              opacity: !canConnect ? 0.4 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed && canConnect ? 0.98 : 1 }],
            },
          ]}
        >
          {busy === 'connect' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.connectLabel}>Connect</Text>
          )}
        </Pressable>
      </View>
      <QuickRepliesEditor />
      <PhotoQuickReplies />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  form: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  field: { gap: 6 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  connectBtn: {
    marginTop: 2,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  connectLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
