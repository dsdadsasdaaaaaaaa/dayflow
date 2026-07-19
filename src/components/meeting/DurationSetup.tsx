import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes, minutesOfDay } from '../../lib/dates';
import { selectionHaptic, tapHaptic } from '../../lib/haptics';
import { RADIUS, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';
import { useNow } from './useNow';

const PRESETS: { minutes: number; label: string }[] = [
  { minutes: 30, label: '30m' },
  { minutes: 45, label: '45m' },
  { minutes: 60, label: '1h' },
  { minutes: 90, label: '1.5h' },
  { minutes: 120, label: '2h' },
  { minutes: 180, label: '3h' },
];

const MIN_MINUTES = 5;
const MAX_MINUTES = 12 * 60;

interface Props {
  minutes: number;
  onChange: (minutes: number) => void;
}

/**
 * Planned-duration picker: preset chips + an "Ends at" row that opens a
 * native time wheel (duration = now → picked time). On web, a simple
 * ±5 min stepper stands in for the wheel.
 */
export function DurationSetup({ minutes, onChange }: Props) {
  const theme = useTheme();
  // The "ends at" preview only needs minute-level freshness.
  const now = useNow(30000);
  const endsAt = formatMinutes(minutesOfDay(new Date(now + minutes * 60000)) % (24 * 60));
  const [showWheel, setShowWheel] = useState(false);

  const nudge = (delta: number) => {
    tapHaptic();
    onChange(Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, minutes + delta)));
  };

  /** Duration = now → picked wall-clock time, clamped to at least 5 min. */
  const onWheelChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowWheel(false);
    if (event.type === 'dismissed' || !date) return;
    const nowDate = new Date();
    const picked = new Date(nowDate);
    picked.setHours(date.getHours(), date.getMinutes(), 0, 0);
    const diff = Math.round((picked.getTime() - nowDate.getTime()) / 60000);
    onChange(Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, diff)));
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Duration</Text>

      <View style={styles.presetRow}>
        {PRESETS.map((p) => {
          const selected = p.minutes === minutes;
          return (
            <Pressable
              key={p.minutes}
              onPress={() => {
                selectionHaptic();
                onChange(p.minutes);
              }}
              style={({ pressed }) => [
                styles.presetChip,
                selected
                  ? { backgroundColor: theme.accent }
                  : {
                      backgroundColor: theme.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.border,
                    },
                { transform: [{ scale: pressed ? 0.95 : 1 }] },
              ]}
              accessibilityLabel={`Set duration to ${formatDuration(p.minutes)}`}
            >
              <Text
                style={[
                  styles.presetLabel,
                  { color: selected ? '#fff' : theme.textSecondary },
                ]}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <GlassCard radius={RADIUS.lg} padding={12}>
        {Platform.OS === 'web' ? (
          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => nudge(-5)}
              disabled={minutes <= MIN_MINUTES}
              style={({ pressed }) => [
                styles.stepBtn,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  opacity: minutes <= MIN_MINUTES ? 0.4 : 1,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
              ]}
              accessibilityLabel="Shorten by 5 minutes"
            >
              <Ionicons name="remove" size={20} color={theme.text} />
            </Pressable>

            <View style={styles.stepperCenter}>
              <Text style={[styles.durationLabel, { color: theme.text }]}>
                {formatDuration(minutes)}
              </Text>
              <Text style={[styles.endsLabel, { color: theme.textTertiary }]}>
                Ends at {endsAt}
              </Text>
            </View>

            <Pressable
              onPress={() => nudge(5)}
              disabled={minutes >= MAX_MINUTES}
              style={({ pressed }) => [
                styles.stepBtn,
                {
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                  opacity: minutes >= MAX_MINUTES ? 0.4 : 1,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
              ]}
              accessibilityLabel="Extend by 5 minutes"
            >
              <Ionicons name="add" size={20} color={theme.text} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.nativeCol}>
            <View style={styles.durationRow}>
              <Text style={[styles.durationLabel, { color: theme.text }]}>
                {formatDuration(minutes)}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                tapHaptic();
                setShowWheel((v) => !v);
              }}
              style={({ pressed }) => [
                styles.endsRow,
                {
                  backgroundColor: theme.surface,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              accessibilityLabel={`Ends at ${endsAt}. Pick an end time.`}
            >
              <Ionicons name="time-outline" size={15} color={theme.accent} />
              <Text style={[styles.endsRowLabel, { color: theme.text }]}>
                Ends at <Text style={{ color: theme.accent }}>{endsAt}</Text>
              </Text>
              <Ionicons
                name={showWheel ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.textTertiary}
              />
            </Pressable>
            {showWheel ? (
              <DateTimePicker
                value={new Date(now + minutes * 60000)}
                mode="time"
                display="spinner"
                minuteInterval={5}
                themeVariant={theme.dark ? 'dark' : 'light'}
                onChange={onWheelChange}
              />
            ) : null}
          </View>
        )}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  sectionLabel: { fontSize: 12, fontWeight: '600' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: {
    paddingVertical: 10,
    paddingHorizontal: 17,
    borderRadius: 999,
    overflow: 'hidden',
  },
  presetLabel: { fontSize: 14, fontWeight: '700' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCenter: { flex: 1, alignItems: 'center', gap: 2 },
  nativeCol: { gap: 10 },
  durationRow: { alignItems: 'center' },
  durationLabel: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  endsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
  },
  endsRowLabel: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  endsLabel: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
