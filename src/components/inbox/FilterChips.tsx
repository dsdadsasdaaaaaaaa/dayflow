import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { PRIORITY_META, SPACING, useTheme } from '../../theme';
import type { Task } from '../../types';

/**
 * Inbox filter: 'all', a priority level, or a tag currently in use.
 * Encoded as strings so it can live in simple component state.
 */
export type InboxFilter = 'all' | 'priority:1' | 'priority:2' | 'priority:3' | `tag:${string}`;

export function taskMatchesFilter(task: Task, filter: InboxFilter): boolean {
  if (filter === 'all') return true;
  if (filter.startsWith('priority:')) {
    return task.priority === Number(filter.slice('priority:'.length));
  }
  return task.tags.includes(filter.slice('tag:'.length));
}

interface Props {
  /** Tags currently in use across the inbox, in display order. */
  tags: string[];
  active: InboxFilter;
  onChange: (filter: InboxFilter) => void;
}

const PRIORITY_CHIPS: { filter: InboxFilter; priority: 1 | 2 | 3 }[] = [
  { filter: 'priority:3', priority: 3 },
  { filter: 'priority:2', priority: 2 },
  { filter: 'priority:1', priority: 1 },
];

export function FilterChips({ tags, active, onChange }: Props) {
  const theme = useTheme();

  const chip = (
    key: string,
    filter: InboxFilter,
    label: string,
    icon?: { name: string; color: string }
  ) => {
    const selected = active === filter;
    return (
      <Pressable
        key={key}
        onPress={() => {
          selectionHaptic();
          onChange(selected ? 'all' : filter);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          pressed && { transform: [{ scale: 0.96 }], opacity: 0.85 },
        ]}
      >
        <View
          style={[
            styles.chip,
            selected
              ? { backgroundColor: theme.accent, borderColor: theme.accent }
              : { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          {icon ? (
            <Ionicons
              name={icon.name as never}
              size={12}
              color={selected ? '#fff' : icon.color}
            />
          ) : null}
          <Text
            style={[
              styles.chipText,
              { color: selected ? '#fff' : theme.textSecondary },
              selected && styles.chipTextSelected,
            ]}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {chip('all', 'all', 'All')}
      {PRIORITY_CHIPS.map(({ filter, priority }) =>
        chip(filter, filter, PRIORITY_META[priority].label, {
          name: 'flag',
          color: PRIORITY_META[priority].color,
        })
      )}
      {tags.map((tag) =>
        chip(`tag:${tag}`, `tag:${tag}`, `#${tag}`)
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    fontWeight: '700',
  },
});
