import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

const MIN = 1;
const MAX = 10;

interface Props {
  value: number;
  onChange: (value: number) => void;
}

/** "3× per day" stepper, 1–10, with plain round buttons. */
export function TimesStepper({ value, onChange }: Props) {
  const theme = useTheme();

  const step = (delta: number) => {
    const next = Math.min(MAX, Math.max(MIN, value + delta));
    if (next !== value) {
      selectionHaptic();
      onChange(next);
    }
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => step(-1)}
        disabled={value <= MIN}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: value <= MIN ? 0.35 : 1,
            transform: [{ scale: pressed && value > MIN ? 0.9 : 1 }],
          },
        ]}
        accessibilityLabel="Fewer times per day"
      >
        <Ionicons name="remove" size={20} color={theme.textSecondary} />
      </Pressable>
      <Text style={[styles.label, { color: theme.text }]}>
        {value}× per day
      </Text>
      <Pressable
        onPress={() => step(1)}
        disabled={value >= MAX}
        hitSlop={6}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            opacity: value >= MAX ? 0.35 : 1,
            transform: [{ scale: pressed && value < MAX ? 0.9 : 1 }],
          },
        ]}
        accessibilityLabel="More times per day"
      >
        <Ionicons name="add" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
