import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { selectionHaptic, successHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { askSecretary as askClaude } from '../../lib/claude';
import {
  clearClaudeCredentials,
  saveClaudeCredentials,
} from '../../lib/claudeCredentials';
import { askSecretary as askGemini } from '../../lib/gemini';
import {
  clearGeminiCredentials,
  saveGeminiCredentials,
} from '../../lib/geminiCredentials';
import {
  brainLabel,
  connectedBrains,
  loadBrain,
  type BrainId,
} from '../../lib/secretaryBrain';
import { useSecretary } from '../../store/secretary';
import { useSettings } from '../../store/settings';
import { taskColor, useTheme } from '../../theme';
import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

const KEY_URL = 'https://console.anthropic.com/settings/keys';

const CAPTION =
  'Runs on Claude Sonnet, using your own Anthropic key. Usage is billed to ' +
  'that key, not to DayFlow. A Google AI key still works if you have one.';

/**
 * Which service a pasted key belongs to, from its prefix. One field is kinder
 * than a provider picker: the key already says what it is.
 */
function detectBrain(key: string): BrainId | null {
  if (key.startsWith('sk-ant-')) return 'claude';
  if (key.startsWith('AIza')) return 'gemini';
  return null;
}

/**
 * The honest disclosure. It changes with the notes setting, because a promise
 * that stops being true the moment a switch is flipped is worse than no
 * promise at all.
 */
function PrivacyNote({
  usesNotes,
  readsMessages,
}: {
  usesNotes: boolean;
  readsMessages: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.privacy, { backgroundColor: theme.surface }]}>
      <Text style={[styles.privacyTitle, { color: theme.text }]}>
        What leaves your phone
      </Text>
      <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
        Sent: booking rhythms, free slots, amounts owed, call times, and
        clients as labels — “Client 3”, never a name.
      </Text>
      <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
        {usesNotes
          ? 'Also sent: your client notes, with any name, number or email inside them swapped for a label first.'
          : 'Not sent: your client notes. With the switch off the assistant is not even given a way to ask for them.'}
      </Text>
      <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
        {readsMessages
          ? 'Also sent: what your messages actually say, for the clients it looks up. Names, numbers and emails inside them are swapped for labels first, but the wording itself goes as written.'
          : 'Not sent: the contents of your messages. With the switch off the assistant can see when someone wrote, never what they said.'}
      </Text>
      <Text style={[styles.privacyLine, { color: theme.textSecondary }]}>
        Never sent: names, phone numbers, addresses, or voicemail audio.
      </Text>
    </View>
  );
}

/**
 * Settings → AI secretary. The key lives in the keychain; the honest privacy
 * disclosure lives here, because the whole feature rests on the user trusting
 * what does and does not leave the phone.
 */
export function SecretarySection() {
  const theme = useTheme();
  const setEnabled = useSecretary((s) => s.setEnabled);
  const clearChat = useSecretary((s) => s.clear);
  const usesNotes = useSettings((s) => s.settings.secretaryUsesNotes);
  const readsMessages = useSettings((s) => s.settings.secretaryReadsMessages);
  const preload = useSettings((s) => s.settings.secretaryPreloadChats);
  const update = useSettings((s) => s.update);

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  /** null while loading — avoids flashing the setup form for a set-up user. */
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** Which model is answering, for the connected row. */
  const [brain, setBrain] = useState<BrainId | null>(null);
  /** Every brain with a key saved — a picker only makes sense with two. */
  const [available, setAvailable] = useState<BrainId[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([loadBrain(), connectedBrains()])
      .then(([b, list]) => {
        if (!alive) return;
        setConfigured(b != null);
        setBrain(b?.id ?? null);
        setAvailable(list);
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
      const which = detectBrain(apiKey);
      if (!which) {
        warningHaptic();
        Alert.alert(
          'Key not recognized',
          'An Anthropic key starts with "sk-ant-" and a Google AI key with "AIza". Check you pasted the whole thing.'
        );
        return;
      }
      // Verify before saving: a trivial round trip with no tools.
      const probeAsk = which === 'claude' ? askClaude : askGemini;
      const probe = await probeAsk(
        apiKey,
        [{ role: 'user', text: 'Say OK.', at: Date.now() }],
        [],
        () => null
      );
      if (!probe.ok) {
        warningHaptic();
        Alert.alert('Could not connect', probe.error);
        return;
      }
      if (which === 'claude') await saveClaudeCredentials({ apiKey });
      else await saveGeminiCredentials({ apiKey });
      setEnabled(true);
      setConfigured(true);
      setBrain(which);
      setAvailable((a) => (a.includes(which) ? a : [...a, which]));
      setKey('');
      successHaptic();
      Alert.alert(
        'Secretary connected',
        `Running on ${brainLabel(which)}. Ask it anything from the sparkle button on Today.`
      );
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
            // Clear both, so disconnecting never silently falls back to a
            // key the user thought they had removed.
            await clearClaudeCredentials();
            await clearGeminiCredentials();
            clearChat();
            setEnabled(false);
            setConfigured(false);
            setBrain(null);
            setAvailable([]);
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
          label={brain ? `Running on ${brainLabel(brain)}` : 'Connected'}
          sublabel="Ask about clients, your week, or money"
          right={<Ionicons name="checkmark-circle" size={22} color={theme.success} />}
        />
        {available.length > 1 ? (
          <View style={styles.noteRow}>
            <View style={[styles.iconCircle, { backgroundColor: taskColor('sky').solid }]}>
              <Ionicons name="swap-horizontal" size={16} color="#fff" />
            </View>
            <View style={styles.noteLabels}>
              <Text style={[styles.noteLabel, { color: theme.text }]}>Model</Text>
              <Text style={[styles.noteSub, { color: theme.textTertiary }]}>
                Both keys stay saved, so switching back is one tap.
              </Text>
            </View>
            <View style={styles.brainRow}>
              {available.map((b) => {
                const on = b === brain;
                return (
                  <Pressable
                    key={b}
                    onPress={() => {
                      if (on) return;
                      selectionHaptic();
                      update({ secretaryBrain: b });
                      setBrain(b);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Use ${brainLabel(b)}`}
                    style={({ pressed }) => [
                      styles.brainChip,
                      {
                        backgroundColor: on ? theme.accentSoft : 'transparent',
                        borderColor: on ? theme.accent : theme.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.brainLabel,
                        { color: on ? theme.accent : theme.textSecondary },
                      ]}
                    >
                      {b === 'claude' ? 'Claude' : 'Gemini'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <View style={styles.noteRow}>
          <View style={[styles.iconCircle, { backgroundColor: taskColor('amber').solid }]}>
            <Ionicons name="document-text" size={16} color="#fff" />
          </View>
          <View style={styles.noteLabels}>
            <Text style={[styles.noteLabel, { color: theme.text }]}>
              Let it read client notes
            </Text>
            <Text style={[styles.noteSub, { color: theme.textTertiary }]}>
              Notes often hold the useful context, and they are the most
              personal thing in the app.
            </Text>
          </View>
          <Switch
            value={usesNotes}
            onValueChange={(on) => {
              selectionHaptic();
              update({ secretaryUsesNotes: on });
            }}
            trackColor={{ false: theme.surface, true: theme.accent }}
            ios_backgroundColor={theme.surface}
            accessibilityLabel="Let the secretary read client notes"
          />
        </View>
        <View style={styles.noteRow}>
          <View style={[styles.iconCircle, { backgroundColor: taskColor('rose').solid }]}>
            <Ionicons name="chatbubbles" size={16} color="#fff" />
          </View>
          <View style={styles.noteLabels}>
            <Text style={[styles.noteLabel, { color: theme.text }]}>
              Let it read your messages
            </Text>
            <Text style={[styles.noteSub, { color: theme.textTertiary }]}>
              It can answer from what was actually said, not just who went
              quiet. This is the most it ever sends.
            </Text>
          </View>
          <Switch
            value={readsMessages}
            onValueChange={(on) => {
              selectionHaptic();
              update({ secretaryReadsMessages: on });
            }}
            trackColor={{ false: theme.surface, true: theme.accent }}
            ios_backgroundColor={theme.surface}
            accessibilityLabel="Let the secretary read message contents"
          />
        </View>
        {readsMessages ? (
          <View style={styles.noteRow}>
            <View style={[styles.iconCircle, { backgroundColor: taskColor('violet').solid }]}>
              <Ionicons name="albums" size={16} color="#fff" />
            </View>
            <View style={styles.noteLabels}>
              <Text style={[styles.noteLabel, { color: theme.text }]}>
                Know your inbox up front
              </Text>
              <Text style={[styles.noteSub, { color: theme.textTertiary }]}>
                Gets a summary of every recent conversation with each question,
                instead of looking things up only when it thinks to. Costs a
                little on every question.
              </Text>
            </View>
            <Switch
              value={preload}
              onValueChange={(on) => {
                selectionHaptic();
                update({ secretaryPreloadChats: on });
              }}
              trackColor={{ false: theme.surface, true: theme.accent }}
              ios_backgroundColor={theme.surface}
              accessibilityLabel="Preload recent conversations as context"
            />
          </View>
        ) : null}
        <View style={styles.privacyInset}>
          <PrivacyNote usesNotes={usesNotes} readsMessages={readsMessages} />
        </View>
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

        <PrivacyNote usesNotes={usesNotes} readsMessages={readsMessages} />

        <Pressable
          onPress={() => {
            tapHaptic();
            Linking.openURL(KEY_URL).catch(() => {});
          }}
          accessibilityRole="button"
          accessibilityLabel="Get an Anthropic API key"
          style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="open-outline" size={15} color={theme.accent} />
          <Text style={[styles.linkLabel, { color: theme.accent }]}>
            Get a key at console.anthropic.com
          </Text>
        </Pressable>

        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="sk-ant-…"
          placeholderTextColor={theme.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: theme.surface, color: theme.text }]}
          accessibilityLabel="Anthropic API key"
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
  brainRow: { flexDirection: 'row', gap: 6 },
  brainChip: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  brainLabel: { fontSize: 12, fontWeight: '700' },
  form: { paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  blurb: { fontSize: 13, lineHeight: 19 },
  privacy: { borderRadius: 10, padding: 12, gap: 6 },
  privacyInset: { paddingHorizontal: 14, paddingVertical: 12 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 52,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteLabels: { flex: 1, gap: 2 },
  noteLabel: { fontSize: 15, fontWeight: '600' },
  noteSub: { fontSize: 12.5, fontWeight: '500', lineHeight: 17 },
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
