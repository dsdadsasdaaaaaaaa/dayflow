import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapHaptic } from '../../lib/haptics';
import { formatMoney, occurrenceAmount } from '../../lib/meetings';
import { useMeetingSession } from '../../store/meetingSession';
import { useSettings } from '../../store/settings';
import { useTasks } from '../../store/tasks';
import { useTheme, RADIUS } from '../../theme';
import { GlassCard } from '../glass/GlassCard';

/** Warm amber for overtime — never alarming. */
const AMBER = '#D97706';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "12:34" / "1:02:34" clock from milliseconds. */
function clock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/**
 * Pinned banner shown while a meeting session is live: plain card with an
 * accent left border, static status dot, client, elapsed + remaining time
 * (derived from timestamps every second), and the amount due. Goes amber
 * once the session runs past its planned end. Tapping opens the full
 * live-session screen.
 */
export function LiveMeetingBanner() {
  const theme = useTheme();
  const router = useRouter();
  const active = useMeetingSession((s) => s.active);
  const tasks = useTasks((s) => s.tasks);
  const currency = useSettings((s) => s.settings.currencySymbol);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const task = tasks[active.taskId];
  const name = task?.meeting?.client || task?.title || 'Meeting';
  const amount = task ? occurrenceAmount(task, active.dateKey) : 0;

  const elapsedMs = Math.max(0, now - active.startedAt);
  const remainingMs = active.plannedEndAt - now;
  const overtime = remainingMs < 0;
  const overMinutes = Math.max(1, Math.ceil(-remainingMs / 60000));

  const liveColor = overtime ? AMBER : theme.success;
  const railColor = overtime ? AMBER : theme.accent;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          tapHaptic();
          router.push('/meeting-live');
        }}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        accessibilityLabel={`Meeting with ${name} in progress. Open live session.`}
      >
        <GlassCard radius={RADIUS.lg} padding={0}>
          <View style={styles.inner}>
            <View style={[styles.rail, { backgroundColor: railColor }]} />
            <View style={[styles.dot, { backgroundColor: liveColor }]} />
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
                  {name}
                </Text>
                <Text style={[styles.liveTag, { color: liveColor }]}>
                  {overtime ? 'Overtime' : 'Live'}
                </Text>
              </View>
              <Text numberOfLines={1} style={[styles.times, { color: theme.textSecondary }]}>
                {clock(elapsedMs)} elapsed
                <Text style={{ color: theme.textTertiary }}>{'  ·  '}</Text>
                {overtime ? (
                  <Text style={[styles.over, { color: AMBER }]}>+{overMinutes}m over</Text>
                ) : (
                  `${clock(remainingMs)} left`
                )}
              </Text>
            </View>
            {amount > 0 ? (
              <View style={[styles.amountChip, { backgroundColor: theme.success }]}>
                <Text style={styles.amount}>{formatMoney(amount, currency)}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </View>
        </GlassCard>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingLeft: 14,
    paddingRight: 10,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3.5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  liveTag: {
    fontSize: 11,
    fontWeight: '700',
  },
  times: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  over: { fontWeight: '800' },
  amountChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  amount: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
    fontVariant: ['tabular-nums'],
  },
});
