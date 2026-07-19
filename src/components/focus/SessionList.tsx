import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes, minutesOfDay } from '../../lib/dates';
import { SPACING, useTheme } from '../../theme';
import type { FocusSession } from '../../types';
import { GlassCard } from '../glass/GlassCard';

const MAX_ROWS = 12;

interface Props {
  /** Today's sessions, most recent first. */
  sessions: FocusSession[];
}

/** Plain card listing today's completed focus sessions. */
export function SessionList({ sessions }: Props) {
  const theme = useTheme();
  const shown = sessions.slice(0, MAX_ROWS);
  const hidden = sessions.length - shown.length;

  return (
    <GlassCard padding={SPACING.lg}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>
        Today&apos;s sessions
      </Text>

      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyCircle, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="hourglass-outline" size={18} color={theme.accent} />
          </View>
          <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
            Nothing logged yet — even ten quiet minutes count.
          </Text>
        </View>
      ) : (
        <>
          {shown.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
          {hidden > 0 ? (
            <Text style={[styles.more, { color: theme.textTertiary }]}>
              +{hidden} earlier {hidden === 1 ? 'session' : 'sessions'}
            </Text>
          ) : null}
        </>
      )}
    </GlassCard>
  );
}

function SessionRow({ session }: { session: FocusSession }) {
  const theme = useTheme();
  const started = formatMinutes(minutesOfDay(new Date(session.startedAt)));
  const modeLabel = session.mode === 'pomodoro' ? 'Pomodoro' : 'Stopwatch';

  return (
    <View style={styles.row}>
      <View style={[styles.iconCircle, { backgroundColor: theme.accentSoft }]}>
        <Ionicons
          name={session.mode === 'pomodoro' ? 'timer-outline' : 'stopwatch-outline'}
          size={15}
          color={theme.accent}
        />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text }]}>
          {session.taskTitle ?? 'Focus session'}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textTertiary }]}>
          {started} · {modeLabel}
        </Text>
      </View>
      <Text style={[styles.minutes, { color: theme.textSecondary }]}>
        {formatDuration(session.minutes)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  iconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, fontWeight: '500', marginTop: 1, fontVariant: ['tabular-nums'] },
  minutes: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  more: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
  empty: { alignItems: 'center', paddingVertical: 18, gap: 8 },
  emptyCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 260,
  },
});
