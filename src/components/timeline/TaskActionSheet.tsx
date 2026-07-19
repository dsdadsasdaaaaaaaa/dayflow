import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration, formatMinutes } from '../../lib/dates';
import { selectionHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { taskColor, useTheme, RADIUS } from '../../theme';
import type { TaskInstance } from '../../types';
import { SheetModal } from './SheetModal';

export type ShiftDelta = 15 | 30 | 60;

interface Props {
  instance: TaskInstance | null;
  onClose: () => void;
  onEdit: (instance: TaskInstance) => void;
  onDuplicate: (instance: TaskInstance) => void;
  onMoveToInbox: (instance: TaskInstance) => void;
  /** Shift this task and every later incomplete timed task by `delta` minutes. */
  onShiftRestOfDay: (instance: TaskInstance, delta: ShiftDelta) => void;
  onSkipOccurrence: (instance: TaskInstance) => void;
  onDelete: (instance: TaskInstance, mode: 'occurrence' | 'series') => void;
  /** Offered for meeting tasks: open the live session timer. */
  onStartMeeting?: (instance: TaskInstance) => void;
}

function ActionRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surface : 'transparent',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon as never} size={20} color={color} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Long-press contextual menu for a task occurrence. */
export function TaskActionSheet({
  instance,
  onClose,
  onEdit,
  onDuplicate,
  onMoveToInbox,
  onShiftRestOfDay,
  onSkipOccurrence,
  onDelete,
  onStartMeeting,
}: Props) {
  const theme = useTheme();
  // Keep the last instance around so content stays visible during the
  // close animation.
  const [shown, setShown] = useState<TaskInstance | null>(instance);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (instance) {
      setShown(instance);
      setConfirmDelete(false);
    }
  }, [instance]);

  if (!shown) return null;

  const task = shown.task;
  const c = taskColor(task.color);
  const isTimed = !task.allDay && task.startMinutes != null;
  const timeLabel = task.allDay
    ? 'All day'
    : task.startMinutes != null
      ? `${formatMinutes(task.startMinutes)}${task.durationMinutes > 0 ? ` · ${formatDuration(task.durationMinutes)}` : ''}`
      : '';

  const run = (fn: () => void) => {
    tapHaptic();
    onClose();
    fn();
  };

  return (
    <SheetModal visible={instance != null} onClose={onClose}>
      <View style={styles.header}>
        <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
          <Ionicons name={task.icon as never} size={18} color="#fff" />
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
            {task.title}
          </Text>
          {timeLabel ? (
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{timeLabel}</Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />

      {!confirmDelete ? (
        <>
          {task.meeting && onStartMeeting ? (
            <ActionRow
              icon="play-circle"
              label="Start meeting"
              color={theme.accent}
              onPress={() => run(() => onStartMeeting(shown))}
            />
          ) : null}
          <ActionRow
            icon="create-outline"
            label="Edit"
            color={theme.text}
            onPress={() => run(() => onEdit(shown))}
          />
          <ActionRow
            icon="copy-outline"
            label="Duplicate"
            color={theme.text}
            onPress={() => run(() => onDuplicate(shown))}
          />
          <ActionRow
            icon="file-tray-outline"
            label="Move to Inbox"
            color={theme.text}
            onPress={() => run(() => onMoveToInbox(shown))}
          />
          {isTimed ? (
            <View style={styles.shiftRow}>
              <View style={styles.shiftLabelWrap}>
                <Ionicons name="chevron-forward-circle-outline" size={20} color={theme.text} />
                <Text style={[styles.rowLabel, { color: theme.text }]}>Shift rest of day</Text>
              </View>
              <View style={styles.shiftButtons}>
                {([15, 30, 60] as ShiftDelta[]).map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => {
                      selectionHaptic();
                      onClose();
                      onShiftRestOfDay(shown, d);
                    }}
                    style={({ pressed }) => [
                      styles.shiftBtn,
                      { backgroundColor: theme.accentSoft, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.shiftBtnText, { color: theme.accent }]}>+{d}m</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {task.recurrence ? (
            <ActionRow
              icon="play-skip-forward-outline"
              label="Skip this occurrence"
              color={theme.text}
              onPress={() => run(() => onSkipOccurrence(shown))}
            />
          ) : null}
          <ActionRow
            icon="trash-outline"
            label="Delete"
            color={theme.danger}
            onPress={() => {
              warningHaptic();
              if (task.recurrence) {
                setConfirmDelete(true);
              } else {
                onClose();
                onDelete(shown, 'series');
              }
            }}
          />
        </>
      ) : (
        <>
          <Text style={[styles.confirmTitle, { color: theme.textSecondary }]}>
            This task repeats. Delete…
          </Text>
          <ActionRow
            icon="remove-circle-outline"
            label="Just this occurrence"
            color={theme.danger}
            onPress={() => {
              warningHaptic();
              onClose();
              onDelete(shown, 'occurrence');
            }}
          />
          <ActionRow
            icon="trash-outline"
            label="The entire series"
            color={theme.danger}
            onPress={() => {
              warningHaptic();
              onClose();
              onDelete(shown, 'series');
            }}
          />
          <ActionRow
            icon="arrow-back-outline"
            label="Back"
            color={theme.textSecondary}
            onPress={() => setConfirmDelete(false)}
          />
        </>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: RADIUS.sm,
  },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  shiftLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shiftButtons: { flexDirection: 'row', gap: 6 },
  shiftBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  shiftBtnText: { fontSize: 13, fontWeight: '700' },
  confirmTitle: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
});
