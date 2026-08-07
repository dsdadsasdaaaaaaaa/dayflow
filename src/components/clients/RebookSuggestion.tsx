import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  addDays,
  formatMinutes,
  lastNDays,
  todayKey,
  weekdayOf,
} from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import { meetingOccurrences } from '../../lib/meetings';
import { useTasks } from '../../store/tasks';
import { SPACING, useTheme } from '../../theme';
import type { DayKey, Task } from '../../types';

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface Suggestion {
  weekday: number;
  /** Mode of start times, or null when the pattern is all-day meetings. */
  startMinutes: number | null;
  /** Next such weekday, strictly after today. */
  date: DayKey;
}

/** Mode of values; ties broken by the most recent dateKey. */
function modeOf(entries: { value: number; dateKey: DayKey }[]): number | null {
  const stats = new Map<number, { count: number; recent: DayKey }>();
  for (const e of entries) {
    const s = stats.get(e.value);
    if (!s) stats.set(e.value, { count: 1, recent: e.dateKey });
    else {
      s.count += 1;
      if (e.dateKey > s.recent) s.recent = e.dateKey;
    }
  }
  let best: number | null = null;
  let bestStat: { count: number; recent: DayKey } | null = null;
  for (const [value, s] of stats) {
    if (
      !bestStat ||
      s.count > bestStat.count ||
      (s.count === bestStat.count && s.recent > bestStat.recent)
    ) {
      best = value;
      bestStat = s;
    }
  }
  return best;
}

/** The client's usual slot from the last 90 days of completed meetings. */
function computeSuggestion(tasks: Record<string, Task>, client: string): Suggestion | null {
  const key = client.trim().toLowerCase();
  if (!key) return null;
  const done = meetingOccurrences(tasks, lastNDays(90)).filter(
    (o) => o.completed && o.client.trim().toLowerCase() === key
  );
  if (done.length < 2) return null;

  const weekday = modeOf(done.map((o) => ({ value: weekdayOf(o.dateKey), dateKey: o.dateKey })));
  if (weekday == null) return null;

  const timed = done.filter((o) => !o.task.allDay && o.task.startMinutes != null);
  const startMinutes = modeOf(
    timed.map((o) => ({ value: o.task.startMinutes as number, dateKey: o.dateKey }))
  );

  const today = todayKey();
  const delta = (weekday - weekdayOf(today) + 7) % 7 || 7;
  return { weekday, startMinutes, date: addDays(today, delta) };
}

interface Props {
  client: string;
}

/**
 * "Usually Friday around 3 PM" row with a one-tap rebook button for the
 * client's usual slot. Renders null with fewer than 2 completed meetings.
 */
export function RebookSuggestion({ client }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const tasks = useTasks((s) => s.tasks);

  const suggestion = useMemo(() => computeSuggestion(tasks, client), [tasks, client]);
  if (!suggestion) return null;

  const dayName = WEEKDAYS_LONG[suggestion.weekday];
  const label =
    suggestion.startMinutes != null
      ? `Usually ${dayName} around ${formatMinutes(suggestion.startMinutes)}`
      : `Usually ${dayName}`;

  const book = () => {
    tapHaptic();
    const params = [
      `client=${encodeURIComponent(client)}`,
      `date=${suggestion.date}`,
      suggestion.startMinutes != null ? `startMinutes=${suggestion.startMinutes}` : null,
    ]
      .filter(Boolean)
      .join('&');
    router.push(`/task-editor?${params}`);
  };

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
    >
      <Ionicons name="repeat-outline" size={16} color={theme.accent} />
      <Text style={[styles.label, { color: theme.text }]} numberOfLines={2}>
        {label}
      </Text>
      <Pressable
        onPress={book}
        accessibilityRole="button"
        accessibilityLabel={`Book next ${dayName}`}
        style={({ pressed }) => [
          styles.bookPill,
          { backgroundColor: theme.accent },
          pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
        ]}
      >
        <Text style={styles.bookPillLabel}>Book next {dayName}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    marginBottom: SPACING.sm + 2,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  bookPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  bookPillLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
