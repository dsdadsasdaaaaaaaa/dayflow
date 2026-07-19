import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { todayKey, weekOf, weekdayOf, weekdayShort } from '../../lib/dates';
import { habitActiveOn, habitDoneOn } from '../../store/habits';
import { RADIUS, useTheme } from '../../theme';
import type { DayKey, Habit } from '../../types';
import { GlassCard } from '../glass/GlassCard';
import { ProgressRing } from '../ProgressRing';

interface Props {
  /** Non-archived habits. */
  habits: Habit[];
  weekStartsOn: 0 | 1;
}

interface DayStat {
  day: DayKey;
  active: number;
  done: number;
  future: boolean;
  today: boolean;
}

/**
 * Current week at a glance on a plain card: one small ring per day.
 * Full ring + filled dot = every active habit done, partial ring = some,
 * empty ring = none. Future days are dimmed.
 */
export function WeekOverview({ habits, weekStartsOn }: Props) {
  const theme = useTheme();
  const today = todayKey();
  const days = weekOf(today, weekStartsOn);

  const stats: DayStat[] = days.map((day) => {
    const activeHabits = habits.filter((h) => habitActiveOn(h, day));
    const done = activeHabits.filter((h) => habitDoneOn(h, day)).length;
    return {
      day,
      active: activeHabits.length,
      done,
      future: day > today,
      today: day === today,
    };
  });

  // Week-to-date completion percentage (past + today only).
  const pastStats = stats.filter((s) => !s.future);
  const totalActive = pastStats.reduce((sum, s) => sum + s.active, 0);
  const totalDone = pastStats.reduce((sum, s) => sum + s.done, 0);
  const pct = totalActive > 0 ? Math.round((totalDone / totalActive) * 100) : null;

  return (
    <GlassCard radius={RADIUS.xl} padding={14}>
      <View style={styles.inner}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerLabel, { color: theme.textSecondary }]}>This week</Text>
          {pct != null ? (
            <Text style={[styles.headerPct, { color: theme.accent }]}>{pct}%</Text>
          ) : null}
        </View>
        <View style={styles.daysRow}>
          {stats.map((s) => {
            const progress = s.active > 0 ? s.done / s.active : 0;
            const allDone = s.active > 0 && s.done === s.active;
            return (
              <View
                key={s.day}
                style={[
                  styles.dayCol,
                  s.today && { backgroundColor: theme.accentSoft },
                  s.future && styles.future,
                ]}
              >
                <Text
                  style={[
                    styles.dayLetter,
                    { color: s.today ? theme.accent : theme.textTertiary },
                    s.today && styles.dayLetterToday,
                  ]}
                >
                  {weekdayShort(weekdayOf(s.day)).charAt(0)}
                </Text>
                <ProgressRing
                  size={28}
                  strokeWidth={3.5}
                  progress={progress}
                  color={theme.accent}
                  trackColor={theme.surface}
                >
                  {allDone ? (
                    <View style={[styles.doneDot, { backgroundColor: theme.accent }]}>
                      <Ionicons name="checkmark" size={11} color="#fff" />
                    </View>
                  ) : null}
                </ProgressRing>
              </View>
            );
          })}
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  inner: { gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  headerPct: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCol: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 7,
    borderRadius: RADIUS.md,
  },
  future: { opacity: 0.35 },
  dayLetter: { fontSize: 11, fontWeight: '600' },
  dayLetterToday: { fontWeight: '800' },
  doneDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
