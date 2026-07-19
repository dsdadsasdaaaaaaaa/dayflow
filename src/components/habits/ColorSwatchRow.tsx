import { Pressable, StyleSheet, View } from 'react-native';
import { selectionHaptic } from '../../lib/haptics';
import { TASK_COLORS } from '../../theme';

interface Props {
  value: string;
  onChange: (key: string) => void;
}

/** The 12-color palette as tappable swatches; the selection gets a ring. */
export function ColorSwatchRow({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {TASK_COLORS.map((c) => {
        const selected = c.key === value;
        return (
          <Pressable
            key={c.key}
            onPress={() => {
              selectionHaptic();
              onChange(c.key);
            }}
            style={({ pressed }) => [
              styles.outer,
              { borderColor: selected ? c.solid : 'transparent' },
              { transform: [{ scale: pressed ? 0.9 : 1 }] },
            ]}
            accessibilityLabel={`Color ${c.label}`}
            accessibilityState={{ selected }}
          >
            <View style={[styles.inner, { backgroundColor: c.solid }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  outer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});
