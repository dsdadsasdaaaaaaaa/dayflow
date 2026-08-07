import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { successHaptic, tapHaptic } from '../../lib/haptics';
import { knownClients } from '../../lib/meetings';
import { useClientMeta } from '../../store/clientMeta';
import { useTasks } from '../../store/tasks';
import { RADIUS, SPACING, useTheme } from '../../theme';

interface Props {
  /** The thread's counterparty (E.164) to save on the picked client. */
  number: string;
}

/** Slim row above the composer for unlinked numbers: pick a client to attach it to. */
export function LinkClientRow({ number }: Props) {
  const theme = useTheme();
  const tasks = useTasks((s) => s.tasks);
  const setPhone = useClientMeta((s) => s.setPhone);
  const [expanded, setExpanded] = useState(false);

  const clients = useMemo(() => knownClients(tasks), [tasks]);

  const pick = (client: string) => {
    successHaptic();
    setPhone(client, number);
    setExpanded(false);
  };

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
        accessibilityLabel="Link this number to a client"
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
        clients.length > 0 ? (
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
        ) : (
          <Text style={[styles.hint, { color: theme.textTertiary }]}>
            Clients appear here once you have added a meeting with one.
          </Text>
        )
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
