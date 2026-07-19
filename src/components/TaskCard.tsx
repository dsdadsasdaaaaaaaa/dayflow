import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes } from '../lib/dates';
import { formatMoney, isPaidOn, meetingKindMeta } from '../lib/meetings';
import { useSettings } from '../store/settings';
import { PRIORITY_META, taskColor, useTheme, RADIUS } from '../theme';
import type { DayKey, Task } from '../types';
import { AnimatedCheck } from './AnimatedCheck';

interface Props {
  task: Task;
  completed: boolean;
  /** Occurrence day — needed for the meeting paid badge. Defaults to task.date. */
  dateKey?: DayKey;
  onToggle: () => void;
  onPress: () => void;
  onLongPress?: () => void;
  /** Compact = inbox/list row; full = timeline card with time labels. */
  compact?: boolean;
  /** Fixed height (timeline positioning). Omit for natural height. */
  height?: number;
}

export function TaskCard({
  task,
  completed,
  dateKey,
  onToggle,
  onPress,
  onLongPress,
  compact = false,
  height,
}: Props) {
  const theme = useTheme();
  const currency = useSettings((s) => s.settings.currencySymbol);
  const c = taskColor(task.color);
  const bg = theme.dark ? c.bgDark : c.bgLight;
  const fg = theme.dark ? c.fgDark : c.fgLight;
  const subtasksDone = task.subtasks.filter((s) => s.done).length;
  const prio = PRIORITY_META[task.priority];
  const short = height != null && height < 56;
  const meeting = task.meeting;
  const paid = meeting ? isPaidOn(task, dateKey ?? task.date ?? '') : false;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.dark ? `${c.solid}2E` : bg,
          borderRadius: RADIUS.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.dark ? `${c.solid}66` : `${c.solid}40`,
          opacity: pressed ? 0.85 : completed ? 0.5 : 1,
        },
        height != null ? { height, minHeight: 0 } : null,
        short ? styles.cardShort : null,
      ]}
    >
      <View
        style={[styles.iconCircle, { backgroundColor: c.solid }, short && styles.iconCircleShort]}
      >
        <Ionicons name={task.icon as never} size={short ? 13 : 17} color="#fff" />
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={short ? 1 : 2}
          style={[
            styles.title,
            { color: theme.text },
            completed && styles.titleDone,
            short && styles.titleShort,
          ]}
        >
          {task.title}
        </Text>
        {meeting && !short ? (
          <View style={styles.metaRow}>
            <View
              style={[
                styles.moneyBadge,
                { backgroundColor: paid ? theme.success : c.solid },
              ]}
            >
              <Ionicons
                name={paid ? 'checkmark-circle' : (meetingKindMeta(meeting.kind).icon as never)}
                size={11}
                color="#fff"
              />
              <Text style={styles.moneyText}>
                {formatMoney(meeting.rate, currency)}
                {paid ? ' paid' : ''}
              </Text>
            </View>
            {meeting.client ? (
              <Text style={[styles.meta, { color: fg }]} numberOfLines={1}>
                {meeting.client}
              </Text>
            ) : null}
          </View>
        ) : null}
        {!short && (
          <View style={styles.metaRow}>
            {!compact && task.startMinutes != null && !task.allDay ? (
              <Text style={[styles.meta, { color: fg }]}>
                {formatMinutes(task.startMinutes)}
                {task.durationMinutes > 0
                  ? ` · ${formatDuration(task.durationMinutes)}`
                  : ''}
              </Text>
            ) : null}
            {compact && task.durationMinutes > 0 ? (
              <Text style={[styles.meta, { color: fg }]}>
                {formatDuration(task.durationMinutes)}
              </Text>
            ) : null}
            {task.subtasks.length > 0 ? (
              <View style={styles.metaChip}>
                <Ionicons name="git-branch-outline" size={11} color={fg} />
                <Text style={[styles.meta, { color: fg }]}>
                  {subtasksDone}/{task.subtasks.length}
                </Text>
              </View>
            ) : null}
            {task.recurrence ? (
              <Ionicons name="repeat" size={12} color={fg} />
            ) : null}
            {task.alerts.length > 0 ? (
              <Ionicons name="notifications-outline" size={12} color={fg} />
            ) : null}
            {task.notes ? <Ionicons name="document-text-outline" size={12} color={fg} /> : null}
            {task.priority > 0 ? (
              <View style={styles.metaChip}>
                <Ionicons name="flag" size={11} color={prio.color} />
              </View>
            ) : null}
          </View>
        )}
      </View>
      <AnimatedCheck
        checked={completed}
        color={c.solid}
        onToggle={onToggle}
        borderColor={theme.dark ? c.fgDark : c.solid}
        size={short ? 22 : 26}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    minHeight: 56,
    overflow: 'hidden',
  },
  cardShort: {
    paddingVertical: 2,
    gap: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleShort: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  titleShort: { fontSize: 13 },
  titleDone: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, fontWeight: '500' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  moneyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  moneyText: { fontSize: 11, fontWeight: '700', color: '#fff' },
});
