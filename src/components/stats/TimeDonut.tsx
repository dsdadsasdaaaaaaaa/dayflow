import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SPACING, taskColor, useTheme } from '../../theme';
import type { ColorSlice } from './compute';
import { fmtHoursCompact } from './format';
import { InlineEmpty, StatsCard } from './StatsCard';

const SIZE = 128;
const STROKE = 24;
const MAX_SLICES = 5;

interface Props {
  slices: ColorSlice[];
}

/** SVG donut of scheduled time by task color/tag, with a legend. */
export function TimeDonut({ slices }: Props) {
  const theme = useTheme();

  const { shown, total } = useMemo(() => {
    const totalMin = slices.reduce((s, x) => s + x.minutes, 0);
    if (slices.length <= MAX_SLICES + 1) return { shown: slices, total: totalMin };
    const head = slices.slice(0, MAX_SLICES);
    const restMin = slices.slice(MAX_SLICES).reduce((s, x) => s + x.minutes, 0);
    return {
      shown: [
        ...head,
        { key: 'other', label: 'Other', color: taskColor('slate').solid, minutes: restMin },
      ],
      total: totalMin,
    };
  }, [slices]);

  const r = (SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = shown.length > 1 ? 3 : 0;

  let acc = 0;
  const segments = shown.map((s) => {
    const frac = total > 0 ? s.minutes / total : 0;
    const len = Math.max(0, frac * circumference - gap);
    const offset = acc;
    acc += frac * circumference;
    return { ...s, len, offset };
  });

  return (
    <StatsCard label="Time by category">
      {total === 0 ? (
        <InlineEmpty
          icon="color-palette-outline"
          text="Once you schedule timed tasks, you'll see where your hours actually go."
        />
      ) : (
        <View style={styles.row}>
          <View style={{ width: SIZE, height: SIZE }}>
            <Svg width={SIZE} height={SIZE}>
              {segments.map((s) =>
                s.len > 0 ? (
                  <Circle
                    key={s.key}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={r}
                    stroke={s.color}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeDasharray={`${s.len} ${Math.max(0, circumference - s.len)}`}
                    strokeDashoffset={-s.offset}
                    strokeLinecap="butt"
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  />
                ) : null
              )}
            </Svg>
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={[styles.totalValue, { color: theme.text }]}>
                {fmtHoursCompact(total)}
              </Text>
              <Text style={[styles.totalLabel, { color: theme.textTertiary }]}>
                scheduled
              </Text>
            </View>
          </View>

          <View style={styles.legend}>
            {segments.map((s) => (
              <View key={s.key} style={styles.legendRow}>
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <Text
                  numberOfLines={1}
                  style={[styles.legendLabel, { color: theme.text }]}
                >
                  {s.label}
                </Text>
                <Text style={[styles.legendValue, { color: theme.textTertiary }]}>
                  {fmtHoursCompact(s.minutes)} · {Math.round((s.minutes / total) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </StatsCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  center: { alignItems: 'center', justifyContent: 'center' },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  legendValue: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
