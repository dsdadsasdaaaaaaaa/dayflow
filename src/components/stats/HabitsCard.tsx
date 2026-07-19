import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { taskColor, useTheme } from '../../theme';
import type { HabitRow } from './compute';
import { InlineEmpty, StatsCard } from './StatsCard';

interface Props {
  rows: HabitRow[];
  /** 0..1 share of active habit-days completed across the period. */
  overall: number;
}

/** Per-habit streaks + contribution strips, with the overall completion %. */
export function HabitsCard({ rows, overall }: Props) {
  const theme = useTheme();
  const amber = taskColor('amber').solid;

  return (
    <StatsCard
      label="Habits"
      right={
        rows.length > 0 ? (
          <Text style={[styles.overall, { color: theme.accent }]}>
            {Math.round(overall * 100)}%
          </Text>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <InlineEmpty
          icon="leaf-outline"
          text="No habits yet. Plant one in the Habits tab and watch your streaks grow here."
        />
      ) : (
        <View style={styles.list}>
          {rows.map(({ habit, streak, cells }) => {
            const c = taskColor(habit.color);
            return (
              <View key={habit.id} style={styles.row}>
                <View style={styles.headRow}>
                  <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
                    <Ionicons name={habit.icon as never} size={13} color="#fff" />
                  </View>
                  <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
                    {habit.title}
                  </Text>
                  <View style={styles.streak}>
                    <Ionicons
                      name="flame"
                      size={13}
                      color={streak > 0 ? amber : theme.textTertiary}
                    />
                    <Text
                      style={[
                        styles.streakLabel,
                        { color: streak > 0 ? theme.text : theme.textTertiary },
                      ]}
                    >
                      {streak}d
                    </Text>
                  </View>
                </View>
                <View style={styles.strip}>
                  {cells.map((cell, i) => (
                    <View
                      key={i}
                      style={[
                        styles.cell,
                        cell < 0
                          ? { backgroundColor: theme.surface, opacity: 0.45 }
                          : {
                              backgroundColor: c.solid,
                              opacity: cell > 0 ? 0.25 + 0.75 * cell : 0.1,
                            },
                      ]}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </StatsCard>
  );
}

const styles = StyleSheet.create({
  overall: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  list: { gap: 16 },
  row: { gap: 7 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 14, fontWeight: '600' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  streakLabel: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  strip: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, height: 14, borderRadius: 4 },
});
