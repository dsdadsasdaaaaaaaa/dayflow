import { StyleSheet, Text, View } from 'react-native';
import { formatDuration, lastNDays, todayKey, weekdayOf, weekdayShort } from '../../lib/dates';
import { minutesFocusedOn } from '../../store/focus';
import { SPACING, useTheme } from '../../theme';
import type { FocusSession } from '../../types';
import { GlassCard } from '../glass/GlassCard';

const CHART_HEIGHT = 64;

interface Props {
  sessions: FocusSession[];
}

/** 7-day mini bar chart of focused minutes: solid accent bars, today at full opacity. */
export function WeekSparkline({ sessions }: Props) {
  const theme = useTheme();
  const today = todayKey();
  const days = lastNDays(7);
  const values = days.map((d) => minutesFocusedOn(sessions, d));
  const total = values.reduce((sum, v) => sum + v, 0);
  const max = Math.max(...values, 1);

  return (
    <View
      accessibilityLabel={`Focus over the last 7 days: ${formatDuration(total)} total`}
    >
      <GlassCard padding={SPACING.lg}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Last 7 days</Text>
          {total > 0 ? (
            <Text style={[styles.total, { color: theme.textSecondary }]}>
              {formatDuration(total)}
            </Text>
          ) : null}
        </View>

        <View style={styles.chartRow}>
          {days.map((day, i) => {
            const v = values[i];
            const isToday = day === today;
            const barHeight = v > 0 ? Math.max(8, Math.round((v / max) * CHART_HEIGHT)) : 4;
            return (
              <View key={day} style={styles.col}>
                <View style={styles.barSlot}>
                  {v > 0 ? (
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barHeight,
                          backgroundColor: theme.accent,
                          opacity: isToday ? 1 : 0.45,
                        },
                      ]}
                    />
                  ) : (
                    <View
                      style={[styles.bar, { height: barHeight, backgroundColor: theme.surface }]}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <View style={[styles.baseline, { backgroundColor: theme.separator }]} />

        <View style={styles.chartRow}>
          {days.map((day) => {
            const isToday = day === today;
            return (
              <View key={day} style={styles.col}>
                <Text
                  style={[
                    styles.dayLabel,
                    {
                      color: isToday ? theme.accent : theme.textTertiary,
                      fontWeight: isToday ? '800' : '600',
                    },
                  ]}
                >
                  {weekdayShort(weekdayOf(day))[0]}
                </Text>
              </View>
            );
          })}
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  label: { fontSize: 12, fontWeight: '600' },
  total: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  col: { flex: 1, alignItems: 'center' },
  barSlot: {
    height: CHART_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  bar: {
    width: 22,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  baseline: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  dayLabel: { fontSize: 11 },
});
