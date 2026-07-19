import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fromDayKey, isToday, monthShort, toDayKey, todayKey } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { useSettings } from '../../store/settings';
import { RADIUS, SPACING, useTheme } from '../../theme';
import type { DayKey } from '../../types';

interface Props {
  value: DayKey | null;
  onChange: (day: DayKey) => void;
}

const WD_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Inline month calendar — selected day is a solid accent circle. */
export function CalendarGrid({ value, onChange }: Props) {
  const theme = useTheme();
  const weekStartsOn = useSettings((s) => s.settings.weekStartsOn);
  const anchor = fromDayKey(value ?? todayKey());
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));

  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leading = (new Date(year, monthIndex, 1).getDay() - weekStartsOn + 7) % 7;

  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const headerLabels = Array.from({ length: 7 }, (_, i) => WD_LETTERS[(i + weekStartsOn) % 7]);

  const shiftMonth = (delta: number) => {
    selectionHaptic();
    setMonth(new Date(year, monthIndex + delta, 1));
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => shiftMonth(-1)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.navBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={19} color={theme.accent} />
        </Pressable>
        <Text style={[styles.monthLabel, { color: theme.text }]}>
          {monthShort(monthIndex)} {year}
        </Text>
        <Pressable
          onPress={() => shiftMonth(1)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.navBtn,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.5 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={19} color={theme.accent} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {headerLabels.map((l, i) => (
          <Text key={i} style={[styles.weekday, { color: theme.textTertiary }]}>
            {l}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day == null) return <View key={i} style={styles.cell} />;
          const key = toDayKey(new Date(year, monthIndex, day));
          const selected = key === value;
          const today = isToday(key);
          return (
            <View key={i} style={styles.cell}>
              <Pressable
                onPress={() => {
                  tapHaptic();
                  onChange(key);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  pressed && { opacity: 0.7, transform: [{ scale: 0.92 }] },
                ]}
              >
                {selected ? (
                  <View style={[styles.dayCircle, { backgroundColor: theme.accent }]}>
                    <Text style={[styles.dayLabel, styles.dayLabelStrong, { color: '#FFFFFF' }]}>
                      {day}
                    </Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.dayCircle,
                      today && { borderWidth: 1.5, borderColor: theme.accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayLabel,
                        { color: today ? theme.accent : theme.text },
                        today && styles.dayLabelStrong,
                      ]}
                    >
                      {day}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dayLabel: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  dayLabelStrong: {
    fontWeight: '700',
  },
});
