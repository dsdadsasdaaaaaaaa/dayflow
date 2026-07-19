import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { formatMoney } from '../../lib/meetings';
import { useTheme } from '../../theme';

interface Props {
  /** Current weekly goal amount; null = off. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Currency symbol for display, e.g. "$". */
  symbol: string;
}

const STEP = 100;
const MAX = 99900;
/** Tapping "Off" jumps straight to a sensible starting goal. */
const TAP_START = 500;

/**
 * Weekly-goal stepper: − / "$1,500" (or "Off") / +. Mirrors the plain
 * Stepper look; stepping below the minimum turns the goal off, and tapping
 * the "Off" value kick-starts it at a default amount.
 */
export function GoalStepper({ value, onChange, symbol }: Props) {
  const theme = useTheme();
  const canDec = value != null;
  const canInc = value == null || value < MAX;

  const dec = () => {
    if (value == null) return;
    selectionHaptic();
    const next = value - STEP;
    onChange(next <= 0 ? null : next);
  };

  const inc = () => {
    const next = Math.min(MAX, (value ?? 0) + STEP);
    if (next !== value) {
      selectionHaptic();
      onChange(next);
    }
  };

  const startFromOff = () => {
    if (value != null) return;
    selectionHaptic();
    onChange(TAP_START);
  };

  const plainBtn = {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={dec}
        disabled={!canDec}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          plainBtn,
          {
            opacity: canDec ? (pressed ? 0.6 : 1) : 0.35,
            transform: [{ scale: pressed && canDec ? 0.92 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Decrease weekly goal"
      >
        <Ionicons name="remove" size={16} color={theme.text} />
      </Pressable>
      <Pressable
        onPress={startFromOff}
        disabled={value != null}
        hitSlop={6}
        style={({ pressed }) => [
          styles.valueWrap,
          pressed && value == null ? { opacity: 0.6 } : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          value == null
            ? 'Weekly goal off — tap to set'
            : `Weekly goal ${formatMoney(value, symbol)}`
        }
      >
        <Text
          style={[
            styles.value,
            { color: value == null ? theme.textTertiary : theme.text },
          ]}
          numberOfLines={1}
        >
          {value == null ? 'Off' : formatMoney(value, symbol)}
        </Text>
      </Pressable>
      <Pressable
        onPress={inc}
        disabled={!canInc}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          plainBtn,
          {
            opacity: canInc ? (pressed ? 0.6 : 1) : 0.35,
            transform: [{ scale: pressed && canInc ? 0.92 : 1 }],
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Increase weekly goal"
      >
        <Ionicons name="add" size={16} color={theme.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueWrap: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
