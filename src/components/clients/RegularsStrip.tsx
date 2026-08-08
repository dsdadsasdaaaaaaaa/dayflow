import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDayRelative } from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import type { OverdueRegular } from '../../lib/rebook';
import { SPACING, useTheme } from '../../theme';
import { LEAD_AMBER } from './status';

const MAX_CARDS = 5;

/** One rebook-radar card: who, their rhythm, and two one-tap actions. */
function RegularCard({ entry }: { entry: OverdueRegular }) {
  const theme = useTheme();
  const router = useRouter();

  const book = () => {
    tapHaptic();
    router.push(`/task-editor?client=${encodeURIComponent(entry.client)}`);
  };

  const message = () => {
    tapHaptic();
    if (entry.phone) {
      router.push(`/thread?number=${encodeURIComponent(entry.phone)}`);
    } else {
      router.push(`/client-detail?name=${encodeURIComponent(entry.client)}`);
    }
  };

  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
    >
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
        {entry.client}
      </Text>
      <Text style={[styles.overdue, { color: LEAD_AMBER }]} numberOfLines={1}>
        {entry.overdueDays}d overdue
      </Text>
      <Text style={[styles.rhythm, { color: theme.textTertiary }]} numberOfLines={2}>
        usually every ~{Math.round(entry.medianDays)}d · last seen{' '}
        {formatDayRelative(entry.lastSeen)}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={book}
          accessibilityRole="button"
          accessibilityLabel={`Book ${entry.client}`}
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: theme.accent },
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
        >
          <Text style={styles.pillSolidLabel}>Book</Text>
        </Pressable>
        <Pressable
          onPress={message}
          accessibilityRole="button"
          accessibilityLabel={`Message ${entry.client}`}
          style={({ pressed }) => [
            styles.pill,
            styles.pillOutline,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
        >
          <Text style={[styles.pillLabel, { color: theme.text }]}>Message</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface Props {
  /** Pre-computed rebook radar entries (see overdueRegulars). */
  regulars: OverdueRegular[];
}

/**
 * Horizontal strip of small cards for regulars who are past their usual
 * rebooking rhythm — at most five, most overdue first.
 */
export function RegularsStrip({ regulars }: Props) {
  if (regulars.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.strip}
    >
      {regulars.slice(0, MAX_CARDS).map((r) => (
        <RegularCard key={r.client.toLowerCase()} entry={r} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    marginHorizontal: -SPACING.lg,
  },
  strip: {
    gap: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  card: {
    width: 190,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: SPACING.md,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  overdue: {
    fontSize: 12,
    fontWeight: '700',
  },
  rhythm: {
    fontSize: 12,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.sm,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillOutline: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillSolidLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
