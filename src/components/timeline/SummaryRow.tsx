import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { ProgressRing } from '../ProgressRing';

interface Props {
  doneCount: number;
  totalCount: number;
  plannedMinutes: number;
  /** Free minutes remaining today, or null when not viewing today. */
  freeMinutes: number | null;
  /** Optional trailing accessory (e.g. the week-earnings chip). */
  right?: React.ReactNode;
}

/** "2h 15m" compact duration. */
function compact(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/**
 * One quiet summary line under the week strip: a small completion ring (only
 * once something is done) and a single sentence of day facts — no chip pile.
 */
export function SummaryRow({ doneCount, totalCount, plannedMinutes, freeMinutes, right }: Props) {
  const theme = useTheme();
  if (totalCount === 0 && plannedMinutes === 0) return null;

  const parts: string[] = [];
  if (totalCount > 0) parts.push(`${doneCount} of ${totalCount} done`);
  if (plannedMinutes > 0) parts.push(`${compact(plannedMinutes)} planned`);
  if (freeMinutes != null && freeMinutes > 0) parts.push(`${compact(freeMinutes)} free`);

  return (
    <View style={styles.row}>
      {doneCount > 0 ? (
        <ProgressRing
          size={18}
          strokeWidth={3}
          progress={totalCount > 0 ? doneCount / totalCount : 0}
          color={theme.accent}
          trackColor={theme.surface}
        />
      ) : null}
      <Text style={[styles.text, { color: theme.textSecondary }]} numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
      <View style={styles.spacer} />
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  text: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  spacer: { flex: 1 },
});
