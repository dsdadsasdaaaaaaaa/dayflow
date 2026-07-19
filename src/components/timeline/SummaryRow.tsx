import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { ProgressRing } from '../ProgressRing';

interface Props {
  doneCount: number;
  totalCount: number;
  plannedMinutes: number;
  /** Free minutes remaining today, or null when not viewing today. */
  freeMinutes: number | null;
}

/** "2h 15m" compact duration. */
function compact(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/** Plain surface chip. */
function Chip({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <View style={[styles.chip, { backgroundColor: theme.surface }]}>{children}</View>
  );
}

/** Day summary: completion ring + plain done / planned / free chips. */
export function SummaryRow({ doneCount, totalCount, plannedMinutes, freeMinutes }: Props) {
  const theme = useTheme();
  if (totalCount === 0 && plannedMinutes === 0) return null;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;

  return (
    <View style={styles.row}>
      <ProgressRing
        size={34}
        strokeWidth={4}
        progress={progress}
        color={theme.accent}
        trackColor={theme.surface}
      >
        <Text style={[styles.ringText, { color: theme.textSecondary }]}>
          {Math.round(progress * 100)}
        </Text>
      </ProgressRing>
      <Chip theme={theme}>
        <Ionicons name="checkmark-circle-outline" size={13} color={theme.textSecondary} />
        <Text style={[styles.chipText, { color: theme.textSecondary }]}>
          {doneCount} of {totalCount} done
        </Text>
      </Chip>
      {plannedMinutes > 0 ? (
        <Chip theme={theme}>
          <Ionicons name="time-outline" size={13} color={theme.textSecondary} />
          <Text style={[styles.chipText, { color: theme.textSecondary }]}>
            {compact(plannedMinutes)} planned
          </Text>
        </Chip>
      ) : null}
      {freeMinutes != null && freeMinutes > 0 ? (
        <Chip theme={theme}>
          <Ionicons name="sparkles-outline" size={13} color={theme.success} />
          <Text style={[styles.chipText, { color: theme.textSecondary }]}>
            {compact(freeMinutes)} free
          </Text>
        </Chip>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    flexWrap: 'wrap',
  },
  ringText: { fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
