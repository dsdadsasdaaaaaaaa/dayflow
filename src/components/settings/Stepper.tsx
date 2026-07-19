import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Formats the value for display, e.g. minutes → "1 h 30 min". */
  format?: (value: number) => string;
}

/** Compact − / + stepper: plain circles around a tabular value. */
export function Stepper({ value, onChange, min, max, step = 1, format }: Props) {
  const theme = useTheme();
  const canDec = value > min;
  const canInc = value < max;

  const nudge = (dir: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + dir * step));
    if (next !== value) {
      selectionHaptic();
      onChange(next);
    }
  };

  const plainBtn = {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => nudge(-1)}
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
        accessibilityLabel="Decrease"
      >
        <Ionicons name="remove" size={16} color={theme.text} />
      </Pressable>
      <Text style={[styles.value, { color: theme.text }]} numberOfLines={1}>
        {format ? format(value) : String(value)}
      </Text>
      <Pressable
        onPress={() => nudge(1)}
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
        accessibilityLabel="Increase"
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
  value: {
    fontSize: 13,
    fontWeight: '800',
    minWidth: 62,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
