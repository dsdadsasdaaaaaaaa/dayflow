import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { RADIUS, SPACING, useTheme } from '../../theme';

interface Props {
  /** Start of the task, minutes from midnight. */
  startMinutes: number;
  /** Task length in minutes (end = start + duration). */
  durationMinutes: number;
  /** Start moved — duration stays fixed, so the end moves with it. */
  onStartChange: (minutes: number) => void;
  /** End moved — duration recomputed as end - start (min 5). */
  onDurationChange: (minutes: number) => void;
}

const MIN_DURATION = 5;
const DAY = 24 * 60;

/** Minutes-from-midnight → a Date the native wheel can display (day is irrelevant). */
function minutesToDate(minutes: number): Date {
  const m = Math.max(0, Math.min(DAY - 1, Math.round(minutes)));
  // Snap to the wheel's 5-minute grid so the spinner lands on a real row.
  const snapped = Math.round(m / 5) * 5;
  return new Date(2000, 0, 1, Math.floor(snapped / 60), snapped % 60);
}

/** Native wheel Date → minutes from midnight. */
function dateToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

const HOUR_W = 60;
const MIN_W = 52;
const GAP = 6;

/**
 * Start + end time control: two side-by-side tappable fields, a native
 * time wheel expanding inline underneath (chip rows on web), and the
 * computed duration displayed below.
 */
export function StartEndPicker({
  startMinutes,
  durationMinutes,
  onStartChange,
  onDurationChange,
}: Props) {
  const theme = useTheme();
  const [active, setActive] = useState<'start' | 'end' | null>(null);

  const endMinutes = (startMinutes + durationMinutes) % DAY;

  const applyEnd = (end: number) => {
    const d = end > startMinutes ? end - startMinutes : MIN_DURATION;
    onDurationChange(d);
  };

  const applyStart = (start: number) => {
    // Duration stays fixed; the end rides along.
    onStartChange(start);
  };

  const onWheelChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      // Android presents a dialog — close it on either outcome.
      setActive(null);
      if (event.type !== 'set' || !date) return;
    }
    if (!date) return;
    const minutes = dateToMinutes(date);
    if (active === 'end') applyEnd(minutes);
    else applyStart(minutes);
  };

  const field = (which: 'start' | 'end', label: string, minutes: number) => {
    const open = active === which;
    return (
      <Pressable
        onPress={() => {
          tapHaptic();
          setActive((prev) => (prev === which ? null : which));
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label} at ${formatMinutes(minutes)}`}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: open ? theme.accentSoft : theme.surface,
            borderColor: open ? theme.accent : theme.border,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[styles.fieldTime, { color: open ? theme.accent : theme.text }]}>
          {formatMinutes(minutes)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View>
      <View style={styles.fieldRow}>
        {field('start', 'Starts', startMinutes)}
        {field('end', 'Ends', endMinutes)}
      </View>

      {active != null ? (
        Platform.OS === 'web' ? (
          <WebTimeChips
            minutes={active === 'start' ? startMinutes : endMinutes}
            onChange={(m) => (active === 'start' ? applyStart(m) : applyEnd(m))}
          />
        ) : (
          <DateTimePicker
            value={minutesToDate(active === 'start' ? startMinutes : endMinutes)}
            mode="time"
            display="spinner"
            minuteInterval={5}
            themeVariant={theme.dark ? 'dark' : 'light'}
            onChange={onWheelChange}
            style={styles.wheel}
          />
        )
      ) : null}

      <View style={styles.durationRow}>
        <Ionicons name="hourglass-outline" size={15} color={theme.textSecondary} />
        <Text style={[styles.durationValue, { color: theme.text }]}>
          {formatDuration(durationMinutes)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Web fallback: the pre-wheel chip-list pattern — two auto-centered
 * scrollable rows (hours, 5-minute increments).
 */
function WebTimeChips({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const theme = useTheme();
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const hourScroll = useRef<ScrollView>(null);
  const minScroll = useRef<ScrollView>(null);

  const chip = (
    key: number,
    width: number,
    label: string,
    selected: boolean,
    onPress: () => void
  ) => (
    <Pressable
      key={key}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{ width }}
    >
      <View
        style={[
          styles.chip,
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
            styles.chipLabel,
            { color: selected ? '#FFFFFF' : theme.textSecondary },
            selected && styles.chipLabelSelected,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={{ marginTop: SPACING.sm }}>
      <ScrollView
        ref={hourScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        contentOffset={{ x: Math.max(0, hour * (HOUR_W + GAP) - 110), y: 0 }}
        keyboardShouldPersistTaps="handled"
      >
        {Array.from({ length: 24 }, (_, h) =>
          chip(h, HOUR_W, formatMinutes(h * 60), h === hour, () => onChange(h * 60 + minute))
        )}
      </ScrollView>
      <ScrollView
        ref={minScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chipRow, { marginTop: GAP + 2 }]}
        contentOffset={{ x: Math.max(0, Math.floor(minute / 5) * (MIN_W + GAP) - 110), y: 0 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* 5-min steps; an off-grid minute simply shows no highlighted chip. */}
        {Array.from({ length: 12 }, (_, i) =>
          chip(i * 5, MIN_W, `:${String(i * 5).padStart(2, '0')}`, i * 5 === minute, () =>
            onChange(hour * 60 + i * 5)
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  field: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  fieldTime: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  wheel: {
    alignSelf: 'stretch',
    marginTop: SPACING.xs,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.md,
  },
  durationValue: {
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chipRow: {
    gap: GAP,
    paddingRight: SPACING.lg,
    paddingVertical: 2,
  },
  chip: {
    paddingVertical: 9,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    overflow: 'hidden',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  chipLabelSelected: {
    fontWeight: '700',
  },
});
