import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { selectionHaptic, successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { loadSmsCredentials, normalizePhone } from '../../lib/smsCredentials';
import {
  disableCalling,
  enableCalling,
  updateCallingConfig,
  type CallingConfig,
} from '../../lib/voiceApi';
import { useMessages } from '../../store/messages';
import { useSettings } from '../../store/settings';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const CAPTION_PITCH =
  'Calls to your work number ring your own phone. Missed calls go to ' +
  'voicemail here in DayFlow.';
const CAPTION_ENABLED =
  'Changes apply from the very next call. Clients only ever see your work number.';

type Busy = 'enable' | 'save' | 'off' | null;

/**
 * Settings → Calling & voicemail: forward inbound calls on the user's Twilio
 * number to their own cell, with voicemail fallback. Rides the messaging
 * credentials (keychain) — nothing works until messaging is connected.
 */
export function CallingSection() {
  const theme = useTheme();

  const configured = useMessages((s) => s.configured);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  const [forwardDraft, setForwardDraft] = useState(settings.callForwardTo);
  const [showWork, setShowWork] = useState(settings.callShowWorkNumber);
  const [greetingDraft, setGreetingDraft] = useState(settings.voicemailGreeting);
  const [busy, setBusy] = useState<Busy>(null);

  // Seed the drafts when calling flips on/off — not on every settings echo.
  useEffect(() => {
    setForwardDraft(settings.callForwardTo);
    setShowWork(settings.callShowWorkNumber);
    setGreetingDraft(settings.voicemailGreeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.callingEnabled]);

  const draftConfig = (): CallingConfig => ({
    forwardTo: normalizePhone(forwardDraft),
    showWorkNumber: showWork,
    greeting: greetingDraft.trim(),
  });

  const dirty =
    normalizePhone(forwardDraft) !== settings.callForwardTo ||
    showWork !== settings.callShowWorkNumber ||
    greetingDraft.trim() !== settings.voicemailGreeting;

  const turnOn = async () => {
    if (busy) return;
    tapHaptic();
    const cfg = draftConfig();
    setBusy('enable');
    try {
      const creds = await loadSmsCredentials();
      if (!creds) {
        warningHaptic();
        Alert.alert('Calling setup failed', 'Connect messaging above first.');
        return;
      }
      const res = await enableCalling(creds, cfg);
      if (!res.ok) {
        warningHaptic();
        Alert.alert('Calling setup failed', res.error);
        return;
      }
      update({
        callingEnabled: true,
        callForwardTo: cfg.forwardTo,
        callShowWorkNumber: cfg.showWorkNumber,
        voicemailGreeting: cfg.greeting,
      });
      successHaptic();
      Alert.alert(
        'Calling is on',
        cfg.forwardTo
          ? `Calls to your work number now ring ${cfg.forwardTo}.`
          : 'Calls to your work number now go straight to voicemail.'
      );
    } finally {
      setBusy(null);
    }
  };

  const saveChanges = async () => {
    if (busy || !dirty) return;
    tapHaptic();
    const cfg = draftConfig();
    setBusy('save');
    try {
      const creds = await loadSmsCredentials();
      if (!creds) {
        warningHaptic();
        Alert.alert('Save failed', 'Connect messaging above first.');
        return;
      }
      const res = await updateCallingConfig(creds, cfg);
      if (!res.ok) {
        warningHaptic();
        Alert.alert('Save failed', res.error);
        return;
      }
      update({
        callForwardTo: cfg.forwardTo,
        callShowWorkNumber: cfg.showWorkNumber,
        voicemailGreeting: cfg.greeting,
      });
      successHaptic();
    } finally {
      setBusy(null);
    }
  };

  const confirmTurnOff = () => {
    Alert.alert(
      'Turn off calling?',
      'Calls to your work number stop ringing your phone and stop reaching voicemail. Nothing else changes in your Twilio account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            warningHaptic();
            setBusy('off');
            try {
              const creds = await loadSmsCredentials();
              if (!creds) {
                Alert.alert('Could not turn off calling', 'Connect messaging above first.');
                return;
              }
              const res = await disableCalling(creds);
              if (!res.ok) {
                Alert.alert('Could not turn off calling', res.error);
                return;
              }
              update({ callingEnabled: false });
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  if (!configured) {
    return (
      <SettingsSection title="Calling & voicemail">
        <Text style={[styles.captionRow, { color: theme.textTertiary }]}>
          Connect messaging above first.
        </Text>
      </SettingsSection>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.surface, color: theme.text },
  ];
  const enabled = settings.callingEnabled;

  const fields = (
    <>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
          Your cell number
        </Text>
        <TextInput
          value={forwardDraft}
          onChangeText={setForwardDraft}
          placeholder="+1 (555) 123-4567"
          placeholderTextColor={theme.textTertiary}
          keyboardType="phone-pad"
          autoCorrect={false}
          style={inputStyle}
          accessibilityLabel="Your cell number"
        />
        <Text style={[styles.fieldHint, { color: theme.textTertiary }]}>
          Leave empty to send every call straight to voicemail.
        </Text>
      </View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleLabels}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>
            Show my work number when it rings
          </Text>
          <Text style={[styles.toggleSublabel, { color: theme.textTertiary }]}>
            Otherwise you see the caller's real number
          </Text>
        </View>
        <Switch
          value={showWork}
          onValueChange={(on) => {
            selectionHaptic();
            setShowWork(on);
          }}
          trackColor={{ false: theme.surface, true: theme.accent }}
          ios_backgroundColor={theme.surface}
          accessibilityLabel="Show my work number when it rings"
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: theme.textTertiary }]}>
          Voicemail greeting
        </Text>
        <TextInput
          value={greetingDraft}
          onChangeText={setGreetingDraft}
          placeholder="Sorry I missed you — leave a message after the tone."
          placeholderTextColor={theme.textTertiary}
          multiline
          style={[...inputStyle, styles.greetingInput]}
          accessibilityLabel="Voicemail greeting"
        />
      </View>
    </>
  );

  if (enabled) {
    return (
      <SettingsSection title="Calling & voicemail" caption={CAPTION_ENABLED}>
        <SettingsRow
          icon="call"
          tint={taskColor('emerald').solid}
          label="Calling is on"
          sublabel={
            settings.callForwardTo
              ? `Forwarding to ${settings.callForwardTo}`
              : 'Straight to voicemail'
          }
          right={
            <Ionicons name="checkmark-circle" size={22} color={theme.success} />
          }
        />
        <View style={styles.form}>
          {fields}
          <Pressable
            onPress={saveChanges}
            disabled={busy !== null || !dirty}
            accessibilityRole="button"
            accessibilityLabel="Save calling changes"
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: theme.accent,
                opacity: busy !== null || !dirty ? 0.4 : pressed ? 0.85 : 1,
                transform: [{ scale: pressed && dirty && !busy ? 0.98 : 1 }],
              },
            ]}
          >
            {busy === 'save' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.primaryLabel}>Save changes</Text>
            )}
          </Pressable>
        </View>
        <SettingsRow
          icon="call"
          tint={theme.danger}
          label="Turn off calling"
          destructive
          onPress={confirmTurnOff}
          right={
            busy === 'off' ? (
              <ActivityIndicator size="small" color={theme.danger} />
            ) : undefined
          }
        />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Calling & voicemail" caption={CAPTION_PITCH}>
      <View style={styles.form}>
        {fields}
        <Pressable
          onPress={turnOn}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Turn on calling"
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: theme.accent,
              opacity: busy !== null ? 0.6 : pressed ? 0.85 : 1,
              transform: [{ scale: pressed && !busy ? 0.98 : 1 }],
            },
          ]}
        >
          {busy === 'enable' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryLabel}>Turn on calling</Text>
          )}
        </Pressable>
        {busy === 'enable' ? (
          <Text style={[styles.deployNote, { color: theme.textTertiary }]}>
            Setting up on your Twilio account — takes 30–60 seconds…
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  captionRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 13,
    fontWeight: '500',
  },
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
  fieldHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  greetingInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabels: { flex: 1, gap: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  toggleSublabel: { fontSize: 12.5, fontWeight: '500' },
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
  deployNote: {
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: 'center',
  },
});
