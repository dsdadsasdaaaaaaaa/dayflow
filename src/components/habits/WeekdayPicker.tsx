import { Pressable, StyleSheet, Text, View } from 'react-native';
import { weekdayShort } from '../../lib/dates';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';

interface Props {
  /** Selected weekdays (0=Sun..6=Sat). Empty = every day. */
  value: number[];
  onChange: (weekdays: number[]) => void;
  weekStartsOn: 0 | 1;
  /** Solid hex of the habit color for selected chips. */
  solidColor: string;
}

/** Seven weekday chips. Empty selection means the habit repeats every day. */
export function WeekdayPicker({ value, onChange, weekStartsOn, solidColor }: Props) {
  const theme = useTheme();
  const order =
    weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

  const toggle = (day: number) => {
    selectionHaptic();
    onChange(
      value.includes(day) ? value.filter((d) => d !== day) : [...value, day]
    );
  };

  const caption =
    value.length === 0 || value.length === 7
      ? 'Repeats every day'
      : `Repeats ${order
          .filter((d) => value.includes(d))
          .map((d) => weekdayShort(d))
          .join(' · ')}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {order.map((day) => {
          const selected = value.includes(day);
          return (
            <Pressable
              key={day}
              onPress={() => toggle(day)}
              style={({ pressed }) => [
                { transform: [{ scale: pressed ? 0.92 : 1 }] },
              ]}
              accessibilityLabel={weekdayShort(day)}
              accessibilityState={{ selected }}
            >
              {selected ? (
                <View style={[styles.chip, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.chipLabel, styles.chipLabelSelected]}>
                    {weekdayShort(day).charAt(0)}
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: theme.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: theme.textSecondary }]}>
                    {weekdayShort(day).charAt(0)}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.captionRow}>
        <View style={[styles.captionDot, { backgroundColor: solidColor }]} />
        <Text style={[styles.caption, { color: theme.textTertiary }]}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  chipLabelSelected: { fontWeight: '700', color: '#fff' },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  captionDot: { width: 5, height: 5, borderRadius: 2.5 },
  caption: { fontSize: 12, fontWeight: '500' },
});
