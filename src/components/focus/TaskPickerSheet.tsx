import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatMinutes, todayKey } from '../../lib/dates';
import { selectionHaptic } from '../../lib/haptics';
import { inboxTasks, instancesForDay } from '../../store/tasks';
import { RADIUS, taskColor, useTheme, type Theme } from '../../theme';
import type { Task } from '../../types';
import { SheetModal } from '../timeline/SheetModal';

interface Props {
  visible: boolean;
  onClose: () => void;
  tasks: Record<string, Task>;
  selectedId: string | null;
  onSelect: (task: Task | null) => void;
}

/** Bottom sheet listing today's incomplete tasks + inbox tasks to link a focus session to. */
export function TaskPickerSheet({ visible, onClose, tasks, selectedId, onSelect }: Props) {
  const theme = useTheme();
  const today = todayKey();

  const todayItems = useMemo(
    () => instancesForDay(tasks, today).filter((i) => !i.completed),
    [tasks, today]
  );
  const inboxItems = useMemo(
    () => inboxTasks(tasks).filter((t) => !t.completed),
    [tasks]
  );

  const pick = (task: Task | null) => {
    selectionHaptic();
    onSelect(task);
    onClose();
  };

  const empty = todayItems.length === 0 && inboxItems.length === 0;

  return (
    <SheetModal visible={visible} onClose={onClose}>
      <Text style={[styles.title, { color: theme.text }]}>Link a task</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        Focused time will be attributed to it.
      </Text>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {selectedId ? (
          <Pressable
            onPress={() => pick(null)}
            style={({ pressed }) => [
              styles.row,
              styles.rowWrap,
              {
                backgroundColor: theme.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            accessibilityLabel="Remove linked task"
          >
            <View style={[styles.iconCircle, { backgroundColor: theme.card }]}>
              <Ionicons name="close" size={15} color={theme.textSecondary} />
            </View>
            <Text style={[styles.rowTitle, { color: theme.textSecondary }]}>
              Just focus — no task
            </Text>
          </Pressable>
        ) : null}

        {todayItems.length > 0 ? (
          <>
            <SectionLabel text="Today" theme={theme} />
            {todayItems.map(({ task }) => (
              <TaskRow
                key={task.id}
                task={task}
                meta={
                  task.allDay || task.startMinutes == null
                    ? 'Any time'
                    : formatMinutes(task.startMinutes)
                }
                selected={task.id === selectedId}
                onPress={() => pick(task)}
                theme={theme}
              />
            ))}
          </>
        ) : null}

        {inboxItems.length > 0 ? (
          <>
            <SectionLabel text="Inbox" theme={theme} />
            {inboxItems.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                meta="Inbox"
                selected={task.id === selectedId}
                onPress={() => pick(task)}
                theme={theme}
              />
            ))}
          </>
        ) : null}

        {empty ? (
          <View style={styles.empty}>
            <View style={[styles.emptyCircle, { backgroundColor: theme.accentSoft }]}>
              <Ionicons name="sparkles-outline" size={18} color={theme.accent} />
            </View>
            <Text style={[styles.emptyText, { color: theme.textTertiary }]}>
              Nothing to link right now — your list is clear. You can still focus freely.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SheetModal>
  );
}

function SectionLabel({ text, theme }: { text: string; theme: Theme }) {
  return (
    <Text style={[styles.section, { color: theme.textSecondary }]}>{text}</Text>
  );
}

function TaskRow({
  task,
  meta,
  selected,
  onPress,
  theme,
}: {
  task: Task;
  meta: string;
  selected: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  const c = taskColor(task.color);

  const inner = (titleColor: string, metaColor: string, checkColor: string | null) => (
    <>
      <View style={[styles.iconCircle, { backgroundColor: c.solid }]}>
        <Ionicons name={task.icon as never} size={15} color="#fff" />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: titleColor }]}>
          {task.title}
        </Text>
        <Text style={[styles.rowMeta, { color: metaColor }]}>{meta}</Text>
      </View>
      {checkColor ? <Ionicons name="checkmark-circle" size={20} color={checkColor} /> : null}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowWrap,
        { transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Link ${task.title}`}
      accessibilityState={{ selected }}
    >
      {selected ? (
        <View style={[styles.row, { backgroundColor: theme.accent }]}>
          {inner('#fff', 'rgba(255,255,255,0.8)', '#fff')}
        </View>
      ) : (
        <View
          style={[
            styles.row,
            {
              backgroundColor: theme.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.border,
            },
          ]}
        >
          {inner(theme.text, theme.textTertiary, null)}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontWeight: '500', marginTop: 2, marginBottom: 8 },
  scroll: { maxHeight: 440 },
  section: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 8,
    marginLeft: 2,
  },
  rowWrap: {
    borderRadius: RADIUS.md,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
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
  rowMeta: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 10 },
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
