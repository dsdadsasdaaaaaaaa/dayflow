import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING, useTheme } from '../../theme';
import { GlassCard } from '../glass/GlassCard';
import type { PeriodStats } from './compute';
import { fmtHoursCompact } from './format';

interface Props {
  current: PeriodStats;
  previous: PeriodStats;
}

/**
 * Three hero tiles: tasks done, completion rate, focus minutes — each
 * with a gentle trend vs the previous period (never red; down is just quiet).
 */
export function HeroTiles({ current, previous }: Props) {
  const rateNow = Math.round(current.rate * 100);
  const ratePrev = Math.round(previous.rate * 100);

  return (
    <View style={styles.row}>
      <Tile
        icon="checkmark-circle-outline"
        label="Tasks done"
        value={String(current.done)}
        delta={current.done - previous.done}
        deltaLabel={signed(current.done - previous.done)}
        hadPrev={previous.planned > 0 || previous.done > 0}
      />
      <Tile
        icon="speedometer-outline"
        label="Completion"
        value={current.planned > 0 ? `${rateNow}%` : '—'}
        delta={rateNow - ratePrev}
        deltaLabel={`${signed(rateNow - ratePrev)}%`}
        hadPrev={previous.planned > 0 && current.planned > 0}
      />
      <Tile
        icon="timer-outline"
        label="Focus"
        value={current.focusMinutes > 0 ? fmtHoursCompact(current.focusMinutes) : '0m'}
        delta={current.focusMinutes - previous.focusMinutes}
        deltaLabel={signedDuration(current.focusMinutes - previous.focusMinutes)}
        hadPrev={previous.focusMinutes > 0}
      />
    </View>
  );
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function signedDuration(min: number): string {
  const body = fmtHoursCompact(Math.abs(min));
  return min > 0 ? `+${body}` : min < 0 ? `-${body}` : '0m';
}

function Tile({
  icon,
  label,
  value,
  delta,
  deltaLabel,
  hadPrev,
}: {
  icon: string;
  label: string;
  value: string;
  delta: number;
  deltaLabel: string;
  hadPrev: boolean;
}) {
  const theme = useTheme();
  const showTrend = hadPrev && delta !== 0;
  const up = delta > 0;

  return (
    <View style={styles.tileWrap}>
      <GlassCard padding={0} style={styles.tileCard}>
        <View style={styles.tileInner}>
          <View style={styles.tileHead}>
            <Ionicons name={icon as never} size={12} color={theme.textTertiary} />
            <Text numberOfLines={1} style={[styles.tileLabel, { color: theme.textTertiary }]}>
              {label}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            style={[styles.tileValue, { color: theme.text }]}
          >
            {value}
          </Text>
          <View style={styles.trendRow}>
            {showTrend ? (
              <>
                <Ionicons
                  name={up ? 'arrow-up' : 'arrow-down'}
                  size={11}
                  color={up ? theme.success : theme.textTertiary}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.trendLabel, { color: up ? theme.success : theme.textTertiary }]}
                >
                  {deltaLabel}
                </Text>
              </>
            ) : (
              <Text style={[styles.trendLabel, { color: theme.textTertiary }]}>
                {hadPrev ? 'steady' : ' '}
              </Text>
            )}
          </View>
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  tileWrap: { flex: 1 },
  tileCard: { flex: 1 },
  tileInner: {
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.md - 2,
    gap: 6,
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileLabel: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  tileValue: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 14 },
  trendLabel: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
