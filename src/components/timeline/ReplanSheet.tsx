import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDayShort, formatMinutes } from '../../lib/dates';
import { selectionHaptic, tapHaptic, warningHaptic } from '../../lib/haptics';
import { taskColor, useTheme, RADIUS } from '../../theme';
import type { Task } from '../../types';
import { SheetModal } from './SheetModal';

export type ReplanAction = 'today' | 'tomorrow' | 'inbox' | 'done' | 'delete';

const AMBER = '#F59E0B';

/** Soft amber-tinted pill inviting the user to re-plan tasks left behind. */
export function ReplanChip({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.chipWrap}>
      <Pressable
        onPress={() => {
          tapHaptic();
          onPress();
        }}
        style={({ pressed }) => [
          styles.chip,
          {
            borderColor: theme.dark ? 'rgba(245, 185, 62, 0.35)' : 'rgba(245, 158, 11, 0.30)',
            backgroundColor: theme.dark
              ? 'rgba(245, 185, 62, 0.16)'
              : 'rgba(245, 185, 62, 0.22)',
            opacity: pressed ? 0.8 : 1,
          },
        ]}
        accessibilityLabel={`Replan ${count} unfinished ${count === 1 ? 'task' : 'tasks'} from earlier days`}
      >
        <Ionicons name="sparkles" size={13} color={AMBER} />
        <Text style={[styles.chipText, { color: theme.dark ? '#FCD98B' : '#A16207' }]}>
          {count} from earlier {count === 1 ? 'day' : 'days'} — replan?
        </Text>
        <Ionicons name="chevron-forward" size={13} color={AMBER} />
      </Pressable>
    </View>
  );
}

function ActionPill({
  icon,
  label,
  color,
  bg,
  onPress,
}: {
  icon: string;
  label: string;
  color: string;
  bg: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}
      accessibilityLabel={label}
    >
      <Ionicons name={icon as never} size={13} color={color} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </Pressable>
  );
}

interface Props {
  visible: boolean;
  tasks: Task[];
  onClose: () => void;
  onAction: (task: Task, action: ReplanAction) => void;
}

/**
 * Bottom sheet listing incomplete, non-recurring tasks scheduled before today
 * so the user can gently catch up: move to today/tomorrow, send to inbox,
 * mark done, or delete. No shame — just options.
 */
export function ReplanSheet({ visible, tasks, onClose, onAction }: Props) {
  const theme = useTheme();

  const run = (task: Task, action: ReplanAction) => {
    if (action === 'delete') warningHaptic();
    else selectionHaptic();
    onAction(task, action);
  };

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: theme.text }]}>Catch up</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        {tasks.length === 1
          ? 'One task from an earlier day is still open.'
          : `${tasks.length} tasks from earlier days are still open.`}{' '}
        Where should they go?
      </Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {tasks.map((task) => {
          const c = taskColor(task.color);
          const when =
            task.date != null
              ? `${formatDayShort(task.date)}${
                  !task.allDay && task.startMinutes != null
                    ? ` · ${formatMinutes(task.startMinutes)}`
                    : ''
                }`
              : '';
          return (
            <View
              key={task.id}
              style={[styles.row, { backgroundColor: theme.dark ? c.bgDark : c.bgLight }]}
            >
              <View style={styles.rowTop}>
                <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
                  <Ionicons name={task.icon as never} size={14} color="#fff" />
                </View>
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.text }]}>
                    {task.title}
                  </Text>
                  {when ? (
                    <Text style={[styles.rowWhen, { color: theme.dark ? c.fgDark : c.fgLight }]}>
                      {when}
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.actions}>
                <ActionPill
                  icon="today-outline"
                  label="Today"
                  color={theme.accent}
                  bg={theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}
                  onPress={() => run(task, 'today')}
                />
                <ActionPill
                  icon="arrow-redo-outline"
                  label="Tomorrow"
                  color={theme.accent}
                  bg={theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}
                  onPress={() => run(task, 'tomorrow')}
                />
                <ActionPill
                  icon="file-tray-outline"
                  label="Inbox"
                  color={theme.textSecondary}
                  bg={theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}
                  onPress={() => run(task, 'inbox')}
                />
                <ActionPill
                  icon="checkmark-circle-outline"
                  label="Done"
                  color={theme.success}
                  bg={theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}
                  onPress={() => run(task, 'done')}
                />
                <ActionPill
                  icon="trash-outline"
                  label="Delete"
                  color={theme.danger}
                  bg={theme.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)'}
                  onPress={() => run(task, 'delete')}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 999,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '800', paddingHorizontal: 4 },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 3,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  list: { flexGrow: 0 },
  row: {
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowWhen: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  actions: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
});
