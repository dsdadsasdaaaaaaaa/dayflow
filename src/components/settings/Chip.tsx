import { Pressable, StyleSheet, Text } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Money styling: selected state fills with theme.success. */
  money?: boolean;
}

/**
 * Toggle pill used for alert offsets and currency symbols.
 * Selected = solid fill (accent, or success for currency) with white text.
 */
export function Chip({ label, active, onPress, money = false }: Props) {
  const theme = useTheme();
  const fillColor = money ? theme.success : theme.accent;

  return (
    <Pressable
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? fillColor : theme.surface,
          borderColor: active ? fillColor : theme.border,
          opacity: pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text
        style={[
          styles.label,
          {
            color: active ? '#fff' : theme.textSecondary,
            fontWeight: active ? '700' : '600',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  label: { fontSize: 13 },
});
