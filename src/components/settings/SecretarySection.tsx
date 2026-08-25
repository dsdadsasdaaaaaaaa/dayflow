import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { askSecretary } from '../../lib/gemini';
import {
  clearGeminiCredentials,
  loadGeminiCredentials,
  saveGeminiCredentials,
} from '../../lib/geminiCredentials';
import { useSecretary } from '../../store/secretary';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const KEY_URL = 'https://aistudio.google.com/apikey';

const CAPTION =
  'Runs on your own free Google AI key. Usage is billed to that key, not to ' +
  'DayFlow, and the free tier covers ordinary use.';

/**
 * Settings → AI secretary. The key lives in the keychain; the honest privacy
 * disclosure lives here, because the whole feature rests on the user trusting
 * what does and does not leave the phone.
 */
export function SecretarySection() {
  const theme = useTheme();
  const setEnabled = useSecretary((s) => s.setEnabled);
  const clearChat = useSecretary((s) => s.clear);

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  /** null while loading — avoids flashing the setup form for a set-up user. */
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    loadGeminiCredentials()
      .then((c) => {
        if (alive) setConfigured(c != null);
      })
      .catch(() => {
        if (alive) setConfigured(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const connect = async () => {
    const apiKey = key.trim();
    if (!apiKey || busy) return;
    tapHaptic();
    setBusy(true);
    try {
      // Verify before saving: a trivial round trip with no tools.
      const probe = await askSecretary(apiKey, [{ role: 'user', text: 'Say OK.', at: Date.now() }], [], () => null);
      if (!probe.ok) {
        warningHaptic();
        Alert.alert('Could not connect', probe.error);
        return;
      }
      await saveGeminiCredentials({ apiKey });
      setEnabled(true);
      setConfigured(true);
      setKey('');
      successHaptic();
      Alert.alert('Secretary connected', 'Ask it anything from the sparkle button on Today.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect the secretary?',
      'Your API key is removed from this phone and the conversation is cleared. Your clients, messages and bookings are untouched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            warningHaptic();
            await clearGeminiCredentials();
            clearChat();
            setEnabled(false);
            setConfigured(false);
          },
        },
      ]
    );
  };

  if (configured) {
    return (
      <SettingsSection title="AI secretary" caption={CAPTION}>
        <SettingsRow
          icon="sparkles"
          tint={taskColor('indigo').solid}
          label="Connected"
          sublabel="Ask about clients, your week, or money"
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        <SettingsRow
          icon="trash"
          tint={taskColor('slate').solid}
          label="Clear conversation"
          onPress={() => {
            tapHaptic();
            clearChat();
          }}
        />
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
    <SettingsSection title="AI secretary" caption={CAPTION}>
      <View style={styles.form}>
        <Text style={[styles.blurb, { color: theme.textSecondary }]}>
          Ask things like “who should I follow up with?” or “find someone who’d
          want tomorrow evening”. It reads your own bookings and clients to
          answer.
        </Text>

        <View style={[styles.privacy, { backgroundColor: theme.surface }]}>
          <Text style={[styles.privacyTitle, { color: theme.text }]}>
            What leaves your phone
          </Text>
          <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
            Sent: booking rhythms, free slots, amounts owed, and clients as
            labels — “Client 3”, never a name.
          </Text>
          <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
            Never sent: names, phone numbers, addresses, notes, or the contents
            of any message.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            tapHaptic();
            Linking.openURL(KEY_URL).catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel="Get a free Google AI key"
          style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="open-outline" size={15} color={theme.accent} />
          <Text style={[styles.linkLabel, { color: theme.accent }]}>
            Get a free key at aistudio.google.com
          </Text>
        </Pressable>

        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="Paste your API key"
          placeholderTextColor={theme.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: theme.surface, color: theme.text }]}
          accessibilityLabel="Google AI API key"
        />
        <Pressable
          onPress={connect}
          disabled={busy || key.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="Connect the secretary"
          style={({ pressed }) => [
            styles.connectBtn,
            {
              backgroundColor: theme.accent,
              opacity: busy || !key.trim() ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.connectLabel}>Connect</Text>
          )}
        </Pressable>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  form: { paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  blurb: { fontSize: 13, lineHeight: 19 },
  privacy: { borderRadius: 10, padding: 12, gap: 6 },
  privacyTitle: { fontSize: 13, fontWeight: '700' },
  privacyLine: { fontSize: 12.5, lineHeight: 18 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkLabel: { fontSize: 13, fontWeight: '600' },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  connectBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  connectLabel: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
