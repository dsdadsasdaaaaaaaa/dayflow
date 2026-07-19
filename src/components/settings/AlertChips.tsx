import { StyleSheet, View } from 'react-native';
import { Chip } from './Chip';

const OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'At start' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 1440, label: '1 day' },
];

interface Props {
  /** Selected alert offsets (minutes before start). */
  value: number[];
  onChange: (value: number[]) => void;
}

/** Multi-select chips for the default alert offsets of new tasks. */
export function AlertChips({ value, onChange }: Props) {
  const toggle = (v: number) => {
    onChange(
      value.includes(v)
        ? value.filter((x) => x !== v)
        : [...value, v].sort((a, b) => a - b)
    );
  };

  return (
    <View style={styles.wrap}>
      {OPTIONS.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          active={value.includes(opt.value)}
          onPress={() => toggle(opt.value)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
