import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMinutes } from '../../lib/dates';
import { useTheme } from '../../theme';
import { InlineEmpty, StatsCard } from './StatsCard';

interface Props {
  /** Scheduled minutes per hour, 24 entries (from hourLoad). */
  hours: number[];
}

/** 24-column heat strip of when the schedule is busiest, opacity-scaled. */
export function HourHeatStrip({ hours }: Props) {
  const theme = useTheme();

  const { max, peakHour } = useMemo(() => {
    let m = 0;
    let peak = -1;
    hours.forEach((v, h) => {
      if (v > m) {
        m = v;
        peak = h;
      }
    });
    return { max: m, peakHour: peak };
  }, [hours]);

  return (
    <StatsCard
      label="Busiest hours"
      right={
        peakHour >= 0 ? (
          <Text style={[styles.peak, { color: theme.accent }]}>
            Peak {formatMinutes(peakHour * 60)}
          </Text>
        ) : undefined
      }
    >
      {max === 0 ? (
        <InlineEmpty
          icon="sunny-outline"
          text="No timed tasks in this period — give a few tasks a start time to see your busy hours."
        />
      ) : (
        <View style={styles.body}>
          <View style={styles.strip}>
            {hours.map((v, h) => (
              <View
                key={h}
                style={[
                  styles.cell,
                  {
                    backgroundColor: theme.accent,
                    opacity: v > 0 ? 0.14 + 0.86 * (v / max) : 0.07,
                  },
                ]}
                accessibilityLabel={`${formatMinutes(h * 60)}: ${Math.round(v)} scheduled minutes`}
              />
            ))}
          </View>
          <View style={styles.labelRow}>
            {['12 AM', '6 AM', '12 PM', '6 PM', '11 PM'].map((l) => (
              <Text key={l} style={[styles.label, { color: theme.textTertiary }]}>
                {l}
              </Text>
            ))}
          </View>
        </View>
      )}
    </StatsCard>
  );
}

const styles = StyleSheet.create({
  peak: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { gap: 6 },
  strip: { flexDirection: 'row', gap: 2 },
  cell: { flex: 1, height: 28, borderRadius: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 9, fontWeight: '600' },
});
