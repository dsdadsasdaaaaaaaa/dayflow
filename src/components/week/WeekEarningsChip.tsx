import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { todayKey, weekOf } from '../../lib/dates';
import { tapHaptic } from '../../lib/haptics';
import { earningsForDays, formatMoney } from '../../lib/meetings';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { useTheme } from '../../theme';

interface Props {
  onPress?: () => void;
}

/**
 * Small "$450 this week" pill for the Today screen — earnings from completed
 * meetings in the current week. Renders null when nothing is earned yet.
 */
export function WeekEarningsChip({ onPress }: Props) {
  const theme = useTheme();
  const tasks = useTasks((s) => s.tasks);
  const weekStartsOn = useSettings((s) => s.settings.weekStartsOn);
  const symbol = useSettings((s) => s.settings.currencySymbol);

  const earned = useMemo(
    () => earningsForDays(tasks, weekOf(todayKey(), weekStartsOn)).earned,
    [tasks, weekStartsOn]
  );

  if (earned === 0) return null;

  return (
    <Pressable
      onPress={() => {
        tapHaptic();
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${formatMoney(earned, symbol)} earned this week`}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: theme.surface, borderColor: theme.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Ionicons name="wallet-outline" size={13} color={theme.success} />
      <Text style={[styles.label, { color: theme.success }]} numberOfLines={1}>
        {formatMoney(earned, symbol)} this week
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
    fontVariant: ['tabular-nums'],
  },
});
