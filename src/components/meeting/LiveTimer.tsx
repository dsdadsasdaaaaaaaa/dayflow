import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { formatDuration, formatMinutes, minutesOfDay } from '../../lib/dates';
import { warningHaptic } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { formatClock } from './useNow';

const RING_SIZE = 310;
const RING_STROKE = 18;

/** Warm amber for overtime — never alarming. */
const AMBER = '#D97706';

interface Props {
  startedAt: number;
  plannedEndAt: number;
  now: number;
}

/**
 * The huge live countdown ring. Everything derives from timestamps, so it
 * stays correct across backgrounding. Past the planned end the ring stays
 * full and warms to amber — going over is normal, never shamed.
 */
export function LiveTimer({ startedAt, plannedEndAt, now }: Props) {
  const theme = useTheme();
  const plannedMs = Math.max(60000, plannedEndAt - startedAt);
  const remainingMs = plannedEndAt - now;
  const overtime = remainingMs < 0;
  const overMin = Math.max(1, Math.ceil(-remainingMs / 60000));
  const elapsedMin = Math.max(0, Math.floor((now - startedAt) / 60000));

  const progress = overtime ? 1 : remainingMs / plannedMs;

  // A single gentle buzz when the planned time elapses.
  const wasOver = useRef(overtime);
  useEffect(() => {
    if (overtime && !wasOver.current) warningHaptic();
    wasOver.current = overtime;
  }, [overtime]);

  // Ring geometry.
  const half = RING_SIZE / 2;
  const r = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - clamped);
  const stroke = overtime ? AMBER : theme.accent;

  return (
    <View style={styles.wrap}>
      <View style={styles.ring}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          {/* Track */}
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(11,18,38,0.08)'}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          {/* Progress arc */}
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={stroke}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${half} ${half})`}
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={styles.ringInner}>
            <Text
              style={[styles.clock, { color: overtime ? AMBER : theme.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatClock(Math.abs(remainingMs))}
            </Text>
            {overtime ? (
              <Text style={[styles.overLabel, { color: AMBER }]}>
                +{overMin} min over
              </Text>
            ) : (
              <Text style={[styles.caption, { color: theme.textSecondary }]}>
                ends {formatMinutes(minutesOfDay(new Date(plannedEndAt)) % (24 * 60))}
              </Text>
            )}
          </View>
        </View>
      </View>

      <Text style={[styles.elapsed, { color: theme.textTertiary }]}>
        Started {formatMinutes(minutesOfDay(new Date(startedAt)) % (24 * 60))}
        {' · '}
        {elapsedMin < 1 ? 'just now' : `${formatDuration(elapsedMin)} elapsed`}
        {overtime
          ? `  ·  planned end ${formatMinutes(minutesOfDay(new Date(plannedEndAt)) % (24 * 60))}`
          : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20 },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  ringInner: { alignItems: 'center', gap: 6, paddingHorizontal: 34 },
  clock: {
    fontSize: 66,
    fontWeight: '800',
    letterSpacing: -1.6,
    fontVariant: ['tabular-nums'],
  },
  overLabel: { fontSize: 16, fontWeight: '700' },
  caption: { fontSize: 14, fontWeight: '600' },
  elapsed: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 24,
    fontVariant: ['tabular-nums'],
  },
});
