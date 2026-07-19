import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayRelative, fromDayKey, isToday, weekdayOf, weekdayShort } from '../../lib/dates';
import { selectionHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { DayCompletion } from './compute';
import { InlineEmpty, StatsCard } from './StatsCard';

const CHART_HEIGHT = 110;

interface Props {
  data: DayCompletion[];
}

/**
 * Per-day stacked bars: completed portion in accent over a soft "planned"
 * track (never red — unfinished is just quiet). Today reads at full opacity.
 * Tapping a bar shows its details in the caption row.
 */
export function CompletionChart({ data }: Props) {
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);

  // Week (7 bars) ↔ Month (30 bars) switches invalidate the selection.
  useEffect(() => {
    setSelected(null);
  }, [data.length]);

  const totals = useMemo(() => {
    const planned = data.reduce((s, d) => s + d.planned, 0);
    const completed = data.reduce((s, d) => s + d.completed, 0);
    const max = Math.max(...data.map((d) => d.planned), 1);
    return { planned, completed, max };
  }, [data]);

  const labels = useMemo(
    () =>
      data.map((d, i) => {
        if (data.length <= 7) return weekdayShort(weekdayOf(d.day)).slice(0, 2);
        const dom = fromDayKey(d.day).getDate();
        return i === 0 || i === data.length - 1 || dom % 5 === 0 ? String(dom) : '';
      }),
    [data]
  );

  const sel = selected != null ? data[selected] : null;
  const caption = sel
    ? `${formatDayRelative(sel.day)} — ${sel.completed} of ${sel.planned} done`
    : `${totals.completed} of ${totals.planned} planned tasks done`;

  const onBarPress = (i: number) => {
    selectionHaptic();
    setSelected((prev) => (prev === i ? null : i));
  };

  return (
    <StatsCard label="Completion">
      {totals.planned === 0 ? (
        <InlineEmpty
          icon="checkmark-circle-outline"
          text="Nothing planned in this period yet. Schedule a few tasks and your daily rhythm will chart itself."
        />
      ) : (
        <View style={styles.body}>
          <View style={styles.captionRow}>
            <View
              style={[
                styles.captionDot,
                { backgroundColor: sel ? theme.accent : theme.textTertiary },
              ]}
            />
            <Text style={[styles.caption, { color: sel ? theme.text : theme.textSecondary }]}>
              {caption}
            </Text>
          </View>

          <View style={styles.chartRow}>
            {data.map((d, i) => {
              const plannedH =
                d.planned <= 0 ? 3 : Math.max(6, (d.planned / totals.max) * CHART_HEIGHT);
              const doneH =
                d.completed <= 0
                  ? 0
                  : Math.max(6, (d.completed / totals.max) * CHART_HEIGHT);
              const today = isToday(d.day);
              const dimmed = selected != null && selected !== i;
              return (
                <Pressable
                  key={d.day}
                  onPress={() => onBarPress(i)}
                  style={[styles.col, { opacity: dimmed ? 0.45 : 1 }]}
                  accessibilityLabel={`${formatDayRelative(d.day)}: ${d.completed} of ${d.planned} tasks done`}
                >
                  <View style={styles.barArea}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: plannedH,
                          backgroundColor: theme.surface,
                        },
                        selected === i && { borderWidth: 1, borderColor: theme.accent },
                      ]}
                    />
                    {doneH > 0 ? (
                      <View
                        style={[
                          styles.bar,
                          styles.doneBar,
                          {
                            height: doneH,
                            backgroundColor: theme.accent,
                            opacity: today ? 1 : 0.8,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      { color: today ? theme.accent : theme.textTertiary },
                      today && styles.labelToday,
                    ]}
                  >
                    {labels[i]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </StatsCard>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 18 },
  captionDot: { width: 6, height: 6, borderRadius: 3 },
  caption: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chartRow: { flexDirection: 'row', gap: 3, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'stretch', gap: 5 },
  barArea: { height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: {
    width: '100%',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    overflow: 'hidden',
  },
  doneBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  label: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
  labelToday: { fontWeight: '800' },
});
