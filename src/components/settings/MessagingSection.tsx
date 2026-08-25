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
import {
  cancelScheduledSms,
  clearMessagingServiceState,
  verifySmsCredentials,
} from '../../lib/smsApi';
import {
  clearSmsCredentials,
  loadSmsCredentials,
  normalizePhone,
  saveSmsCredentials,
  type SmsCredentials,
} from '../../lib/smsCredentials';
import {
  clearNumberBinding,
  clearVoiceState,
  disableCalling,
  enableCalling,
} from '../../lib/voiceApi';
import { useCalls } from '../../store/calls';
import { useMessages } from '../../store/messages';
import { useSettings } from '../../store/settings';
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

type Busy = 'connect' | 'test' | 'change' | null;

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
  const previousNumbers = useMessages((s) => s.previousNumbers);
  const clearCalls = useCalls((s) => s.clearAll);
  const callingEnabled = useSettings((s) => s.settings.callingEnabled);
  const callForwardTo = useSettings((s) => s.settings.callForwardTo);
  const callShowWorkNumber = useSettings((s) => s.settings.callShowWorkNumber);
  const voicemailGreeting = useSettings((s) => s.settings.voicemailGreeting);
  const updateSettings = useSettings((s) => s.update);

  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [connectedNumber, setConnectedNumber] = useState<string | null>(null);
  /** Inline 'change number' form (same account, new sending number). */
  const [changingNumber, setChangingNumber] = useState(false);
  const [newNumber, setNewNumber] = useState('');

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

  /**
   * Swap the work number on the SAME Twilio account. Unlike Disconnect this
   * keeps every message, client and call record — only the sending identity
   * changes. Calling and scheduled-send plumbing are re-provisioned against
   * the new number (their cached bindings point at the old one).
   */
  const changeNumber = async () => {
    const next = normalizePhone(newNumber);
    if (!next || busy) return;
    const creds = await loadSmsCredentials();
    if (!creds) return;
    setBusy('change');
    try {
      const updated: SmsCredentials = { ...creds, fromNumber: next };
      const ok = await verifySmsCredentials(updated);
      if (!ok) {
        warningHaptic();
        Alert.alert('Could not verify', 'Twilio rejected those credentials.');
        return;
      }
      await saveSmsCredentials(updated);
      // Remember the retired number: its history stays in the same threads,
      // and clients who never got the new number keep reaching us there.
      useMessages.getState().addPreviousNumber(creds.fromNumber);
      // Both caches are keyed to the OLD number — drop them so the next send
      // and the next calling check re-provision against the new one.
      await clearMessagingServiceState();
      await clearNumberBinding();
      // Scheduled sends were queued on the old number's service; they can no
      // longer be tracked or canceled from here.
      const stale = Object.keys(useMessages.getState().scheduled).length;
      if (callingEnabled) {
        const result = await enableCalling(updated, {
          forwardTo: callForwardTo,
          showWorkNumber: callShowWorkNumber,
          greeting: voicemailGreeting,
        });
        if (!result.ok) {
          Alert.alert(
            'Number switched — calling needs attention',
            `Texting now uses ${next}, but calling could not re-point itself: ${result.error}`
          );
        }
      }
      await refreshConfigured();
      setChangingNumber(false);
      setNewNumber('');
      successHaptic();
      Alert.alert(
        'Rotated',
        `Texts now send from ${next}. Your history stays put, and texts to ${creds.fromNumber} keep arriving in the same threads.${
          stale > 0
            ? `\n\n${stale} scheduled message${stale === 1 ? '' : 's'} still queued on the old number — cancel them in the Twilio console if you no longer want them sent.`
            : ''
        }`,
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect messaging?',
      'Your Twilio credentials are removed from this phone, the local message and call history is cleared, and call forwarding is turned off. Nothing else changes in your Twilio account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            warningHaptic();
            // While we still have credentials: detach the voice webhook and
            // cancel any Twilio-scheduled sends — they'd otherwise deliver
            // from an account the app no longer controls (best-effort).
            const creds = await loadSmsCredentials();
            if (creds) {
              if (callingEnabled) await disableCalling(creds);
              const scheduled = useMessages.getState().scheduled;
              await Promise.all(
                Object.keys(scheduled).map((sid) =>
                  cancelScheduledSms(creds, sid).catch(() => {})
                )
              );
            }
            await clearSmsCredentials();
            await clearVoiceState();
            await clearMessagingServiceState();
            clearAll();
            clearCalls();
            updateSettings({ callingEnabled: false });
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
        {previousNumbers.length > 0 ? (
          <SettingsRow
            icon="albums"
            tint={taskColor('violet').solid}
            label="Old numbers"
            sublabel={`Still receiving on ${previousNumbers.join(', ')}`}
          />
        ) : null}
        <SettingsRow
          icon="swap-horizontal"
          tint={taskColor('indigo').solid}
          label="Rotate number"
          sublabel="Move to a new number, keep every conversation"
          onPress={() => setChangingNumber((v) => !v)}
          right={
            busy === 'change' ? (
              <ActivityIndicator size="small" color={theme.textTertiary} />
            ) : (
              <Ionicons
                name={changingNumber ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={theme.textTertiary}
              />
            )
          }
        />
        {changingNumber ? (
          <View style={styles.form}>
            <TextInput
              value={newNumber}
              onChangeText={setNewNumber}
              placeholder="+1 (555) 123-4567"
              placeholderTextColor={theme.textTertiary}
              keyboardType="phone-pad"
              autoCorrect={false}
              style={inputStyle}
              accessibilityLabel="New Twilio number"
            />
            <Text style={[styles.hint, { color: theme.textTertiary }]}>
              Messages, clients and call history stay exactly as they are.
              Calling re-points itself, and texts to your previous numbers
              keep arriving in the same threads.
            </Text>
            <Pressable
              onPress={changeNumber}
              disabled={busy !== null || normalizePhone(newNumber).length === 0}
              accessibilityRole="button"
              accessibilityLabel="Rotate to this number"
              style={({ pressed }) => [
                styles.connectBtn,
                {
                  backgroundColor: theme.accent,
                  opacity:
                    busy !== null || normalizePhone(newNumber).length === 0
                      ? 0.4
                      : pressed
                        ? 0.85
                        : 1,
                },
              ]}
            >
              {busy === 'change' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.connectLabel}>Rotate to this number</Text>
              )}
            </Pressable>
          </View>
        ) : null}
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
  hint: { fontSize: 12, lineHeight: 17 },
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
