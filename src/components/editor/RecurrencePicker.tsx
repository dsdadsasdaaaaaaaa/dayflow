import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addDays, formatDayShort, weekdayOf } from '../../lib/dates';
import { selectionHaptic } from '../../lib/haptics';
import { describeRecurrence } from '../../lib/recurrence';
import { SPACING, useTheme } from '../../theme';
import type { DayKey, Recurrence, RecurrenceFreq } from '../../types';
import { CalendarGrid } from './CalendarGrid';
import { Chip, Stepper } from './ui';

interface Props {
  value: Recurrence | null;
  onChange: (rule: Recurrence | null) => void;
  /** Anchor date of the task — seeds the weekly weekday selection. */
  anchor: DayKey;
}

const FREQ_OPTIONS: Array<{ value: RecurrenceFreq | 'once'; label: string }> = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const WD_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const UNIT: Record<RecurrenceFreq, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

/** Full recurrence editor: frequency pills, weekday chips, interval, end date. */
export function RecurrencePicker({ value, onChange, anchor }: Props) {
  const theme = useTheme();
  const [showUntilPicker, setShowUntilPicker] = useState(false);

  const setFreq = (freq: RecurrenceFreq | 'once') => {
    if (freq === 'once') {
      onChange(null);
      setShowUntilPicker(false);
      return;
    }
    onChange({
      freq,
      interval: value?.interval ?? 1,
      weekdays:
        freq === 'weekly'
          ? value && value.weekdays && value.weekdays.length > 0
            ? value.weekdays
            : [weekdayOf(anchor)]
          : undefined,
      until: value?.until ?? null,
    });
  };

  const toggleWeekday = (wd: number) => {
    if (!value || value.freq !== 'weekly') return;
    const current = value.weekdays ?? [weekdayOf(anchor)];
    const next = current.includes(wd)
      ? current.filter((d) => d !== wd)
      : [...current, wd].sort((a, b) => a - b);
    if (next.length === 0) return; // keep at least one day
    selectionHaptic();
    onChange({ ...value, weekdays: next });
  };

  const setInterval = (delta: number) => {
    if (!value) return;
    const next = Math.min(99, Math.max(1, (value.interval || 1) + delta));
    onChange({ ...value, interval: next });
  };

  const activeFreq = value?.freq ?? 'once';
  const summary = value
    ? describeRecurrence(value) + (value.until ? ` until ${formatDayShort(value.until)}` : '')
    : null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
        keyboardShouldPersistTaps="handled"
      >
        {FREQ_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            label={opt.label}
            selected={activeFreq === opt.value}
            onPress={() => setFreq(opt.value)}
          />
        ))}
      </ScrollView>

      {value ? (
        <View>
          {value.freq === 'weekly' ? (
            <View style={styles.weekdayRow}>
              {WD_LETTERS.map((letter, wd) => {
                const selected = (value.weekdays ?? []).includes(wd);
                return (
                  <Pressable
                    key={wd}
                    onPress={() => toggleWeekday(wd)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      pressed && { opacity: 0.75, transform: [{ scale: 0.92 }] },
                    ]}
                  >
                    <View
                      style={[
                        styles.weekdayChip,
                        selected
                          ? { backgroundColor: theme.accent }
                          : {
                              backgroundColor: theme.surface,
                              borderWidth: StyleSheet.hairlineWidth,
                              borderColor: theme.border,
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.weekdayLabel,
                          { color: selected ? '#FFFFFF' : theme.textSecondary },
                        ]}
                      >
                        {letter}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.intervalRow}>
            <Text style={[styles.intervalText, { color: theme.textSecondary }]}>Every</Text>
            <Stepper
              label={String(Math.max(1, value.interval || 1))}
              onDecrement={() => setInterval(-1)}
              onIncrement={() => setInterval(1)}
            />
            <Text style={[styles.intervalText, { color: theme.textSecondary }]}>
              {UNIT[value.freq]}
              {(value.interval || 1) > 1 ? 's' : ''}
            </Text>
          </View>

          <View style={styles.endRow}>
            <Text style={[styles.endLabel, { color: theme.textSecondary }]}>Ends</Text>
            <Chip
              small
              label="Never"
              selected={!value.until}
              onPress={() => {
                onChange({ ...value, until: null });
                setShowUntilPicker(false);
              }}
            />
            <Chip
              small
              icon="calendar-outline"
              label={value.until ? formatDayShort(value.until) : 'On date'}
              selected={!!value.until}
              onPress={() => setShowUntilPicker((s) => !s)}
            />
          </View>

          {showUntilPicker ? (
            <CalendarGrid
              value={value.until ?? addDays(anchor, 30)}
              onChange={(day) => {
                onChange({ ...value, until: day });
                setShowUntilPicker(false);
              }}
            />
          ) : null}

          {summary ? (
            <View style={styles.summaryRow}>
              <Ionicons name="repeat" size={15} color={theme.accent} />
              <Text style={[styles.summaryText, { color: theme.accent }]}>{summary}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: {
    gap: SPACING.sm,
    paddingRight: SPACING.lg,
    paddingVertical: 2,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.md + 2,
  },
  weekdayChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  weekdayLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginTop: SPACING.md + 2,
  },
  intervalText: {
    fontSize: 15,
    fontWeight: '500',
  },
  endRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md + 2,
  },
  endLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginRight: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.md,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
