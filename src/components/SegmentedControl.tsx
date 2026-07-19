import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectionHaptic } from '../lib/haptics';
import { useTheme, RADIUS } from '../theme';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surface }]}>
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
            style={[
              styles.segment,
              active && { backgroundColor: theme.card, ...styles.segmentActive },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: active ? theme.text : theme.textSecondary },
                active && styles.labelActive,
              ]}
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
    borderRadius: RADIUS.sm,
    padding: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: RADIUS.sm - 3,
  },
  segmentActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  label: { fontSize: 13, fontWeight: '500' },
  labelActive: { fontWeight: '700' },
});
