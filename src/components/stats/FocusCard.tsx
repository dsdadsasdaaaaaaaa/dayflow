import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDayShort, fromDayKey, weekdayOf, weekdayShort } from '../../lib/dates';
import { useTheme } from '../../theme';
import type { DayKey } from '../../types';
import { Bars } from './Bars';
import type { FocusStats } from './compute';
import { fmtClockCompact } from './format';
import { InlineEmpty, StatsCard } from './StatsCard';

interface Props {
  stats: FocusStats;
  days: DayKey[];
}

/** Focus summary: session count, minutes, best day, per-day mini bars. */
export function FocusCard({ stats, days }: Props) {
  const theme = useTheme();

  const labels = useMemo(
    () =>
      days.map((d, i) => {
        if (days.length <= 7) return weekdayShort(weekdayOf(d)).slice(0, 2);
        const dom = fromDayKey(d).getDate();
        return i === 0 || i === days.length - 1 || dom % 5 === 0 ? String(dom) : '';
      }),
    [days]
  );

  return (
    <StatsCard label="Focus">
      {stats.sessions === 0 ? (
        <InlineEmpty
          icon="hourglass-outline"
          text="No focus sessions in this period. Start a timer from the Focus tab and your deep-work minutes land here."
        />
      ) : (
        <View style={styles.body}>
          <View style={styles.statsRow}>
            <Stat
              value={String(stats.sessions)}
              label={stats.sessions === 1 ? 'session' : 'sessions'}
            />
            <Divider color={theme.separator} />
            <Stat value={fmtClockCompact(stats.minutes)} label="focused" />
            <Divider color={theme.separator} />
            <Stat
              value={stats.bestDay ? formatDayShort(stats.bestDay).split(', ')[0] : '—'}
              label={
                stats.bestDay
                  ? `best · ${fmtClockCompact(stats.bestMinutes)}`
                  : 'best day'
              }
            />
          </View>
          <Bars
            values={stats.perDay}
            color={theme.accent}
            height={48}
            highlightIndex={days.length - 1}
            labels={labels}
          />
        </View>
      )}
    </StatsCard>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={[styles.statValue, { color: theme.text }]}>
        {value}
      </Text>
      <Text numberOfLines={1} style={[styles.statLabel, { color: theme.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  body: { gap: 16 },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontSize: 11, fontWeight: '600' },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 4 },
});
