import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { ErrorBanner } from '../src/components/messages/ErrorBanner';
import { AskComposer } from '../src/components/secretary/AskComposer';
import { SecretaryBubble } from '../src/components/secretary/SecretaryBubble';
import { SecretaryPrompts } from '../src/components/secretary/SecretaryPrompts';
import { TypingDots } from '../src/components/secretary/TypingDots';
import { VoiceButton } from '../src/components/secretary/VoiceButton';
import type { ChatTurn } from '../src/lib/gemini';
import { loadGeminiCredentials } from '../src/lib/geminiCredentials';
import { tapHaptic } from '../src/lib/haptics';
import { useSecretary } from '../src/store/secretary';
import { SPACING, useTheme } from '../src/theme';

/** Row model: turns oldest-first, plus a trailing "thinking" row when busy. */
type Row = { type: 'turn'; key: string; turn: ChatTurn } | { type: 'typing'; key: string };

/**
 * The AI secretary: a plain chat over the user's own data. Everything sent to
 * the model is pseudonymized in the store (see lib/secretaryPrivacy) — this
 * screen only ever renders the restored, real-name text.
 */
export default function SecretaryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const messages = useSecretary((s) => s.messages);
  const busy = useSecretary((s) => s.busy);
  const lastError = useSecretary((s) => s.lastError);
  const ask = useSecretary((s) => s.ask);

  const [draft, setDraft] = useState('');
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  /** null while the keychain read is in flight — keeps the UI from flashing. */
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    let alive = true;
    loadGeminiCredentials()
      .then((c) => {
        if (alive) setHasKey(c != null);
      })
      .catch(() => {
        if (alive) setHasKey(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows: Row[] = messages.map((turn, i) => ({
    type: 'turn' as const,
    key: `${turn.at}-${i}`,
    turn,
  }));
  if (busy) rows.push({ type: 'typing', key: 'typing' });

  // Newest at the bottom: keep the view pinned there as turns arrive.
  useEffect(() => {
    if (rows.length === 0) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [rows.length]);

  const send = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      tapHaptic();
      setDraft('');
      void ask(q);
    },
    [ask, busy]
  );

  const showError = lastError != null && lastError !== dismissedError;
  const locked = hasKey === false;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]}>Secretary</Text>
      </View>

      {showError ? (
        <ErrorBanner message={lastError} onDismiss={() => setDismissedError(lastError)} />
      ) : null}

      {locked ? (
        <View style={styles.lockedWrap}>
          <Text style={[styles.lockedTitle, { color: theme.text }]}>Not connected yet</Text>
          <Text style={[styles.lockedBody, { color: theme.textSecondary }]}>
            The secretary needs a free Google AI key. Set it up in Settings, then
            ask it anything about your clients, your week, or your money.
          </Text>
          <Pressable
            onPress={() => {
              tapHaptic();
              router.push('/settings');
            }}
            accessibilityRole="button"
            accessibilityLabel="Open settings to connect the secretary"
            style={({ pressed }) => [
              styles.lockedBtn,
              { backgroundColor: theme.accent },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.lockedBtnLabel}>Set it up</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 8}
          style={styles.flex}
        >
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.list, rows.length === 0 && styles.listEmpty]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <SecretaryPrompts onPick={send} disabled={busy || hasKey !== true} />
            }
            renderItem={({ item }) =>
              item.type === 'typing' ? <TypingDots /> : <SecretaryBubble turn={item.turn} />
            }
          />

          {messages.length > 0 ? (
            <Text style={[styles.privacyNote, { color: theme.textTertiary }]}>
              Clients are sent as labels, never by name.
            </Text>
          ) : null}

          <View style={[styles.composerRow, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <VoiceButton
              disabled={busy || hasKey !== true}
              onText={(text) => setDraft((d) => (d.trim() ? `${d} ${text}` : text))}
            />
            <View style={styles.flex}>
              <AskComposer
                value={draft}
                onChangeText={setDraft}
                onSend={() => send(draft)}
                busy={busy}
                disabled={hasKey !== true}
                placeholder="Ask about your week…"
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  list: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  privacyNote: {
    fontSize: 11,
    textAlign: 'center',
    paddingBottom: 6,
    paddingHorizontal: SPACING.lg,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  lockedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  lockedTitle: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  lockedBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  lockedBtn: {
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
    marginTop: 4,
  },
  lockedBtnLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
