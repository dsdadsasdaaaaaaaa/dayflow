import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes } from '../lib/dates';
import { formatMoney, isPaidOn, occurrenceAmount } from '../lib/meetings';
import { useSettings } from '../store/settings';
import { PRIORITY_META, taskColor, useTheme, RADIUS } from '../theme';
import type { DayKey, Task } from '../types';
import { AnimatedCheck } from './AnimatedCheck';

/**
 * Timeline blocks left-align their icon circles to this x (from card left),
 * so the icons sit on the timeline's connector rail. index.tsx draws the rail
 * at the same offset — keep the two in sync via RAIL_CENTER_X.
 */
export const RAIL_CENTER_X = 23;

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
  const timeline = height != null;
  const short = timeline && height < 52;
  const meeting = task.meeting;
  const occDay = dateKey ?? task.date ?? '';
  const paid = meeting ? isPaidOn(task, occDay) : false;

  const timeCaption =
    task.startMinutes != null && !task.allDay
      ? task.durationMinutes > 0
        ? `${formatMinutes(task.startMinutes)} – ${formatMinutes(
            task.startMinutes + task.durationMinutes
          )} · ${formatDuration(task.durationMinutes)}`
        : formatMinutes(task.startMinutes)
      : null;

  // ── Timeline block, Structured-style ──────────────────────────────────────
  if (timeline) {
    const iconSize = short ? 22 : 30;
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          styles.block,
          {
            height,
            backgroundColor: theme.dark ? `${c.solid}24` : bg,
            borderRadius: short ? height / 2 : RADIUS.md,
            opacity: pressed ? 0.85 : completed ? 0.45 : 1,
          },
        ]}
      >
        <View style={[styles.rail, !short && styles.railTop]}>
          <View
            style={[
              styles.iconCircle,
              {
                width: iconSize,
                height: iconSize,
                borderRadius: iconSize / 2,
                backgroundColor: c.solid,
              },
            ]}
          >
            <Ionicons name={task.icon as never} size={short ? 12 : 16} color="#fff" />
          </View>
        </View>

        {short ? (
          <View style={styles.shortBody}>
            <Text
              numberOfLines={1}
              style={[styles.title, styles.titleShort, { color: theme.text }, completed && styles.titleDone]}
            >
              {task.title}
            </Text>
            {task.startMinutes != null ? (
              <Text style={[styles.captionInline, { color: theme.textTertiary }]} numberOfLines={1}>
                {formatMinutes(task.startMinutes)}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.body}>
            {timeCaption ? (
              <Text style={[styles.caption, { color: theme.textTertiary }]} numberOfLines={1}>
                {timeCaption}
              </Text>
            ) : null}
            <Text
              numberOfLines={height >= 84 ? 2 : 1}
              style={[styles.title, { color: theme.text }, completed && styles.titleDone]}
            >
              {task.title}
            </Text>
            {height >= 62 ? (
              <View style={styles.metaRow}>
                {meeting ? (
                  <View style={styles.metaChip}>
                    <Ionicons
                      name={paid ? 'checkmark-circle' : 'cash-outline'}
                      size={12}
                      color={theme.success}
                    />
                    <Text style={[styles.metaStrong, { color: theme.success }]} numberOfLines={1}>
                      {formatMoney(occurrenceAmount(task, occDay), currency)}
                      {paid ? ' paid' : ''}
                      {meeting.client ? ` · ${meeting.client}` : ''}
                    </Text>
                  </View>
                ) : null}
                {task.subtasks.length > 0 ? (
                  <View style={styles.metaChip}>
                    <Ionicons name="git-branch-outline" size={11} color={fg} />
                    <Text style={[styles.meta, { color: fg }]}>
                      {subtasksDone}/{task.subtasks.length}
                    </Text>
                  </View>
                ) : null}
                {task.recurrence ? <Ionicons name="repeat" size={12} color={fg} /> : null}
                {task.alerts.length > 0 ? (
                  <Ionicons name="notifications-outline" size={12} color={fg} />
                ) : null}
                {task.priority > 0 ? <Ionicons name="flag" size={11} color={prio.color} /> : null}
              </View>
            ) : null}
          </View>
        )}

        <View style={short ? styles.checkShort : styles.check}>
          <AnimatedCheck
            checked={completed}
            color={c.solid}
            onToggle={onToggle}
            borderColor={theme.dark ? c.fgDark : c.solid}
            size={short ? 20 : 24}
          />
        </View>
      </Pressable>
    );
  }

  // ── Compact list row (inbox / search) ─────────────────────────────────────
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.dark ? `${c.solid}24` : bg,
          borderRadius: RADIUS.md,
          opacity: pressed ? 0.85 : completed ? 0.5 : 1,
        },
      ]}
    >
      <View style={[styles.iconCircle, styles.iconCompact, { backgroundColor: c.solid }]}>
        <Ionicons name={task.icon as never} size={16} color="#fff" />
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[styles.title, { color: theme.text }, completed && styles.titleDone]}
        >
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          {meeting ? (
            <View style={styles.metaChip}>
              <Ionicons
                name={paid ? 'checkmark-circle' : 'cash-outline'}
                size={12}
                color={theme.success}
              />
              <Text style={[styles.metaStrong, { color: theme.success }]} numberOfLines={1}>
                {formatMoney(occurrenceAmount(task, occDay), currency)}
                {paid ? ' paid' : ''}
                {meeting.client ? ` · ${meeting.client}` : ''}
              </Text>
            </View>
          ) : null}
          {compact && task.durationMinutes > 0 ? (
            <Text style={[styles.meta, { color: fg }]}>{formatDuration(task.durationMinutes)}</Text>
          ) : null}
          {!compact && timeCaption ? (
            <Text style={[styles.meta, { color: fg }]}>{timeCaption}</Text>
          ) : null}
          {task.subtasks.length > 0 ? (
            <View style={styles.metaChip}>
              <Ionicons name="git-branch-outline" size={11} color={fg} />
              <Text style={[styles.meta, { color: fg }]}>
                {subtasksDone}/{task.subtasks.length}
              </Text>
            </View>
          ) : null}
          {task.recurrence ? <Ionicons name="repeat" size={12} color={fg} /> : null}
          {task.alerts.length > 0 ? (
            <Ionicons name="notifications-outline" size={12} color={fg} />
          ) : null}
          {task.notes ? <Ionicons name="document-text-outline" size={12} color={fg} /> : null}
          {task.priority > 0 ? <Ionicons name="flag" size={11} color={prio.color} /> : null}
        </View>
      </View>
      <AnimatedCheck
        checked={completed}
        color={c.solid}
        onToggle={onToggle}
        borderColor={theme.dark ? c.fgDark : c.solid}
        size={26}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Timeline block
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    paddingRight: 10,
  },
  rail: {
    width: RAIL_CENTER_X * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railTop: {
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    paddingTop: 9,
  },
  shortBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  body: { flex: 1, gap: 1, justifyContent: 'center', minWidth: 0 },
  caption: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  captionInline: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  check: { marginLeft: 8, alignSelf: 'flex-start', marginTop: 10 },
  checkShort: { marginLeft: 8 },

  // Compact row
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    minHeight: 56,
    overflow: 'hidden',
  },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCompact: { width: 32, height: 32, borderRadius: 16 },

  title: { fontSize: 15, fontWeight: '700' },
  titleShort: { fontSize: 13, flexShrink: 1 },
  titleDone: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, fontWeight: '500' },
  metaStrong: { fontSize: 12, fontWeight: '700' },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 0 },
});
