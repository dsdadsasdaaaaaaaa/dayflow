import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { SPACING, useTheme } from '../../theme';

export interface StatusFilterOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label (e.g. leads waiting). */
  count?: number;
}

interface Props<T extends string> {
  options: StatusFilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Flat filter chip row (All · Leads · Clients). Selected chip is a solid
 * accent fill with white text; the rest are plain cards with hairline borders.
 */
export function StatusFilterChips<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const selected = value === opt.value;
        const label =
          opt.count != null && opt.count > 0 ? `${opt.label} · ${opt.count}` : opt.label;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              selectionHaptic();
              onChange(opt.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              selected
                ? { backgroundColor: theme.accent, borderColor: theme.accent }
                : { backgroundColor: theme.card, borderColor: theme.border },
              pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: selected ? '#FFFFFF' : theme.textSecondary },
                selected && styles.labelSelected,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 4,
  },
  chip: {
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  labelSelected: {
    fontWeight: '700',
  },
});
