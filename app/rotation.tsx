import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../src/components/clients/BackButton';
import { formatPhoneDisplay } from '../src/components/messages/format';
import { tapHaptic } from '../src/lib/haptics';
import { knownClients } from '../src/lib/meetings';
import {
  buildRotationRoster,
  rotationNoticeFor,
  rotationProgressLabel,
  ROTATION_BATCH_SIZE,
  type RotationEntry,
} from '../src/lib/rotation';
import { useClientMeta } from '../src/store/clientMeta';
import { useMessages } from '../src/store/messages';
import { useTasks } from '../src/store/tasks';
import { RADIUS, SPACING, useTheme } from '../src/theme';

/** "2h" / "3d" / "5w" since we last heard from them. */
function shortAgo(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * The after-a-rotation worklist: everyone still holding an old number, in the
 * order they should hear from the new one. Tapping a row opens their thread
 * with the explainer already in the composer — the send is always a
 * deliberate, per-person tap. See lib/rotation for why this is not a blast.
 */
export default function RotationScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const messages = useMessages((s) => s.messages);
  const hiddenSids = useMessages((s) => s.hiddenSids);
  const currentNumber = useMessages((s) => s.currentNumber);
  const previousNumbers = useMessages((s) => s.previousNumbers);
  const setThreadDraft = useMessages((s) => s.setThreadDraft);
  const meta = useClientMeta((s) => s.meta);
  const tasks = useTasks((s) => s.tasks);

  /** Rows tapped this session, so progress is visible before they send. */
  const [visited, setVisited] = useState<Record<string, true>>({});

  const roster = useMemo(
    () =>
      buildRotationRoster({
        messages,
        meta,
        hiddenSids,
        clientNames: knownClients(tasks),
        currentNumber: currentNumber ?? '',
      }),
    [messages, meta, hiddenSids, tasks, currentNumber]
  );

  const remaining = roster.filter((r) => !visited[r.number]).length;

  const open = (entry: RotationEntry, index: number) => {
    tapHaptic();
    setVisited((v) => ({ ...v, [entry.number]: true }));
    // Seed the wording variant for THIS row so each person gets slightly
    // different text — identical bulk outbound is what gets a fresh number
    // filtered, which is the thing rotation exists to avoid.
    setThreadDraft(entry.number, rotationNoticeFor(index, entry.waiting));
    router.push({ pathname: '/thread', params: { number: entry.number } });
  };

  const renderItem = ({ item, index }: { item: RotationEntry; index: number }) => {
    const done = !!visited[item.number];
    return (
      <Pressable
        onPress={() => open(item, index)}
        accessibilityRole="button"
        accessibilityLabel={`Tell ${item.name} the new number`}
        style={({ pressed }) => [
          styles.row,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            opacity: pressed ? 0.6 : done ? 0.5 : 1,
          },
        ]}
      >
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {item.name === item.number ? formatPhoneDisplay(item.number) : item.name}
          </Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={1}>
            {item.waiting ? 'Waiting on you' : 'Last spoke'} · {shortAgo(item.lastAt)} ago
          </Text>
        </View>
        {item.waiting ? (
          <View style={[styles.tag, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.tagText, { color: theme.accent }]}>Reply</Text>
          </View>
        ) : null}
        <Ionicons
          name={done ? 'checkmark-circle' : 'chevron-forward'}
          size={done ? 20 : 18}
          color={done ? theme.success : theme.textTertiary}
        />
      </Pressable>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: theme.text }]}>Tell your clients</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={roster}
        keyExtractor={(r) => r.number}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + SPACING.xl },
        ]}
        ListHeaderComponent={
          <View style={styles.intro}>
            <Text style={[styles.progress, { color: theme.textSecondary }]}>
              {rotationProgressLabel(remaining, roster.length)}
            </Text>
            {currentNumber ? (
              <Text style={[styles.current, { color: theme.text }]}>
                Now texting from {formatPhoneDisplay(currentNumber)}
              </Text>
            ) : null}
            {roster.length > 0 ? (
              <View
                style={[
                  styles.note,
                  { backgroundColor: theme.surface, borderColor: theme.border },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={16} color={theme.accent} />
                <Text style={[styles.noteText, { color: theme.textSecondary }]}>
                  Tap a name to open the chat with the explainer ready. Send a
                  few at a time, not all at once: a brand new number that fires
                  the same text at everyone in one go is the kind carriers
                  filter. Around {ROTATION_BATCH_SIZE} in a sitting, spaced out,
                  keeps this number healthy.
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color={theme.textTertiary} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {previousNumbers.length === 0
                ? 'No rotation yet'
                : 'Everyone has your new number'}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
              {previousNumbers.length === 0
                ? 'Rotate your number in Settings → Messaging and this list will fill with everyone who still needs to hear from the new one.'
                : 'Every active thread has had a message from your current number. Texts to your old numbers still arrive here.'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  headerSpacer: { width: 40 },
  list: { paddingHorizontal: SPACING.lg },
  intro: { gap: SPACING.xs, paddingBottom: SPACING.md },
  progress: { fontSize: 13, fontWeight: '600' },
  current: { fontSize: 15, fontWeight: '600' },
  note: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.sm },
  tagText: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.xl * 2 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: SPACING.lg },
});
