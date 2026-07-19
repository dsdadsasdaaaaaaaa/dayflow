import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isToday, lastNDays, todayKey, weekdayOf, weekdayShort } from '../../lib/dates';
import { selectionHaptic, successHaptic } from '../../lib/haptics';
import { habitActiveOn, habitDoneOn, habitStreak } from '../../store/habits';
import { RADIUS, taskColor, useTheme } from '../../theme';
import type { DayKey, Habit } from '../../types';
import { AnimatedCheck } from '../AnimatedCheck';
import { GlassCard } from '../glass/GlassCard';
import { ProgressRing } from '../ProgressRing';

const AMBER = taskColor('amber').solid;

interface Props {
  habit: Habit;
  /** Increment the count for a given day (store `tick`). */
  onTickDay: (day: DayKey) => void;
  /** Toggle today's completion (store `tick` with no day). */
  onToggleToday: () => void;
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * One habit as a plain card: icon, title, streak flame, the last 7 days as
 * tappable backfill circles, and a big animated check for today. The habit
 * color appears only on the icon circle and day dots.
 */
export function HabitCard({ habit, onTickDay, onToggleToday, onPress, onLongPress }: Props) {
  const theme = useTheme();
  const c = taskColor(habit.color);
  const today = todayKey();
  const days = lastNDays(7);
  const streak = habitStreak(habit);
  const doneToday = habitDoneOn(habit, today);
  const todayCount = habit.completions[today] ?? 0;
  const onFire = streak >= 3;

  const metaParts: string[] = [];
  if (habit.timesPerDay > 1) metaParts.push(`${habit.timesPerDay}× a day`);
  if (habit.activeWeekdays.length > 0 && habit.activeWeekdays.length < 7) {
    metaParts.push(`${habit.activeWeekdays.length} days a week`);
  }

  const handleDayTick = (day: DayKey) => {
    const current = habit.completions[day] ?? 0;
    const next = current >= habit.timesPerDay ? 0 : current + 1;
    if (next >= habit.timesPerDay) successHaptic();
    else selectionHaptic();
    onTickDay(day);
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.97 : 1 }] }]}
      accessibilityLabel={`${habit.title}, ${streak} day streak`}
    >
      <GlassCard radius={RADIUS.xl} padding={14}>
        <View style={styles.inner}>
          <View style={styles.topRow}>
            <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
              <Ionicons name={habit.icon as never} size={19} color="#fff" />
            </View>
            <View style={styles.titleCol}>
              <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                {habit.title}
              </Text>
              <View style={styles.metaRow}>
                <Ionicons
                  name="flame"
                  size={13}
                  color={onFire ? AMBER : theme.textTertiary}
                />
                <Text
                  style={[
                    styles.streak,
                    { color: onFire ? AMBER : theme.textTertiary },
                  ]}
                >
                  {streak}
                </Text>
                {metaParts.length > 0 ? (
                  <Text style={[styles.meta, { color: theme.textTertiary }]} numberOfLines={1}>
                    {'· '}
                    {metaParts.join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.checkWrap}>
              {habit.timesPerDay > 1 ? (
                <ProgressRing
                  size={46}
                  strokeWidth={3}
                  progress={todayCount / habit.timesPerDay}
                  color={c.solid}
                  trackColor={theme.surface}
                >
                  <AnimatedCheck
                    checked={doneToday}
                    color={c.solid}
                    size={34}
                    onToggle={onToggleToday}
                    borderColor={theme.dark ? c.fgDark : c.solid}
                  />
                </ProgressRing>
              ) : (
                <AnimatedCheck
                  checked={doneToday}
                  color={c.solid}
                  size={34}
                  onToggle={onToggleToday}
                  borderColor={theme.dark ? c.fgDark : c.solid}
                />
              )}
            </View>
          </View>

          <View style={styles.daysRow}>
            {days.map((day) => {
              const count = habit.completions[day] ?? 0;
              const target = habit.timesPerDay;
              const done = count >= target;
              const partial = count > 0 && !done;
              const active = habitActiveOn(habit, day);
              const dayToday = isToday(day);

              return (
                <Pressable
                  key={day}
                  onPress={() => handleDayTick(day)}
                  hitSlop={6}
                  style={styles.dayCell}
                  accessibilityLabel={`${habit.title} on ${day}: ${count} of ${target}`}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      done
                        ? { backgroundColor: c.solid }
                        : partial
                          ? { backgroundColor: theme.dark ? c.bgDark : c.bgLight }
                          : active
                            ? { backgroundColor: theme.surface }
                            : {
                                backgroundColor: 'transparent',
                                borderWidth: 1.5,
                                borderStyle: 'dashed',
                                borderColor: theme.border,
                              },
                    ]}
                  >
                    {done ? (
                      <Ionicons name="checkmark" size={15} color="#fff" />
                    ) : partial && target > 1 ? (
                      <Text
                        style={[styles.dayCount, { color: theme.dark ? c.fgDark : c.fgLight }]}
                      >
                        {count}/{target}
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    style={[
                      styles.dayLetter,
                      { color: dayToday ? theme.accent : theme.textTertiary },
                      dayToday && styles.dayLetterToday,
                    ]}
                  >
                    {weekdayShort(weekdayOf(day)).charAt(0)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  inner: { gap: 12 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCol: { flex: 1, gap: 3 },
  title: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  streak: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  meta: { fontSize: 12, fontWeight: '500', flexShrink: 1 },
  checkWrap: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCell: { alignItems: 'center', gap: 4 },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCount: { fontSize: 9.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dayLetter: { fontSize: 9.5, fontWeight: '600' },
  dayLetterToday: { fontWeight: '800' },
});
