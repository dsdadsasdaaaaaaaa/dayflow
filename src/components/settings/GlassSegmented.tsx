import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Settings-local segmented control: plain track with a solid accent thumb.
 * (The name is kept from the glass era so call sites compile.)
 */
export function GlassSegmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!active) {
                selectionHaptic();
                onChange(opt.value);
              }
            }}
            style={({ pressed }) => [
              styles.segment,
              active ? { backgroundColor: theme.accent } : null,
              pressed && !active ? { opacity: 0.6 } : null,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text
              style={[
                styles.label,
                { color: active ? '#fff' : theme.textSecondary },
                active && styles.labelActive,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  label: { fontSize: 12.5, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
});
