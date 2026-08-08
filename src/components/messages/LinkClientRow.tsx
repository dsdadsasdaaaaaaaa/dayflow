import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { successHaptic, tapHaptic } from '../../lib/haptics';
import { allClientNames, linkThreadToClient } from '../../lib/linkClient';
import { clientMetaKey, useClientMeta } from '../../store/clientMeta';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';

/**
 * Horizontal chip list of every existing client (meeting clients AND
 * message-book contacts). Picking one attaches the thread's number/chat to
 * that client via linkThreadToClient.
 */
export function ClientPickerChips({
  counterparty,
  excludeName,
  onLinked,
}: {
  counterparty: string;
  /** Hide this name from the list (the thread's current contact). */
  excludeName?: string | null;
  onLinked?: (client: string) => void;
}) {
  const theme = useTheme();
  const tasks = useTasks((s) => s.tasks);
  const meta = useClientMeta((s) => s.meta);

  const clients = useMemo(() => {
    const all = allClientNames(tasks, meta);
    const skip = excludeName ? clientMetaKey(excludeName) : null;
    return skip ? all.filter((c) => clientMetaKey(c) !== skip) : all;
  }, [tasks, meta, excludeName]);

  const pick = (client: string) => {
    const result = linkThreadToClient(counterparty, client);
    if (result.ok) {
      successHaptic();
      onLinked?.(client);
    }
  };

  if (clients.length === 0) {
    return (
      <Text style={[styles.hint, { color: theme.textTertiary }]}>
        Your other clients and contacts appear here.
      </Text>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chips}
    >
      {clients.map((c) => (
        <Pressable
          key={c}
          onPress={() => pick(c)}
          accessibilityRole="button"
          accessibilityLabel={`Link to ${c}`}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: theme.surface },
            pressed && { backgroundColor: theme.accentSoft },
          ]}
        >
          <Text style={[styles.chipLabel, { color: theme.text }]} numberOfLines={1}>
            {c}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

interface Props {
  /** The thread's counterparty — E.164, or 'tgc:<chatId>' for Telegram. */
  counterparty: string;
}

/** Slim row above the composer for unlinked threads: attach to an existing client. */
export function LinkClientRow({ counterparty }: Props) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Pressable
        onPress={() => {
          tapHaptic();
          setExpanded((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel="Link this conversation to a client"
        style={styles.row}
      >
        <Ionicons name="person-add-outline" size={16} color={theme.accent} />
        <Text style={[styles.label, { color: theme.text }]}>Link to client</Text>
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={15}
          color={theme.textTertiary}
        />
      </Pressable>
      {expanded ? (
        <ClientPickerChips
          counterparty={counterparty}
          onLinked={() => setExpanded(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  label: { flex: 1, fontSize: 13, fontWeight: '600' },
  chips: {
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm + 2,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 160,
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  hint: {
    fontSize: 12,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm + 2,
  },
});
