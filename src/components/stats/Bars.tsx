import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';

interface Props {
  /** One bar per value, oldest first. */
  values: number[];
  /** Solid bar fill. */
  color: string;
  /** Chart height in px (bars only, labels excluded). */
  height?: number;
  /** Index rendered at full opacity (usually today). */
  highlightIndex?: number;
  /** Optional label under each bar ('' renders an empty slot). */
  labels?: string[];
}

/**
 * Tiny dependency-free bar chart. Solid bars with rounded tops; zero values
 * render as a faint dot so the day still reads as "tracked, just quiet".
 */
export function Bars({ values, color, height = 64, highlightIndex, labels }: Props) {
  const theme = useTheme();
  const max = Math.max(...values, 1);

  return (
    <View>
      <View style={[styles.row, { height }]}>
        {values.map((v, i) => {
          const h = v <= 0 ? 3 : Math.max(5, Math.round((v / max) * height));
          const highlighted = i === highlightIndex && v > 0;
          return (
            <View key={i} style={styles.col}>
              <View
                style={[
                  styles.bar,
                  v > 0
                    ? { height: h, backgroundColor: color, opacity: highlighted ? 1 : 0.8 }
                    : {
                        height: h,
                        backgroundColor: theme.surface,
                        borderTopLeftRadius: 2,
                        borderTopRightRadius: 2,
                      },
                ]}
              />
            </View>
          );
        })}
      </View>
      {labels ? (
        <View style={styles.labelRow}>
          {labels.map((label, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={[styles.label, { color: theme.textTertiary }]}
            >
              {label}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  col: { flex: 1, alignItems: 'stretch' },
  bar: {
    width: '100%',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    overflow: 'hidden',
  },
  labelRow: { flexDirection: 'row', gap: 3, marginTop: 5 },
  label: { flex: 1, fontSize: 9, fontWeight: '600', textAlign: 'center' },
});
