import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayRelative, formatMinutes } from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { RADIUS, SPACING, taskColor, useTheme } from '../../theme';
import type { Task } from '../../types';
import { EmptyGlow } from './EmptyGlow';

/**
 * Universal search — the feature Structured never shipped.
 * Matches every task (inbox, scheduled, recurring, completed) against
 * title, notes, subtasks, tags, and meeting client names, case-insensitively.
 */

interface SearchGroups {
  inbox: Task[];
  scheduled: Task[];
  completed: Task[];
  total: number;
}

function matches(task: Task, q: string): boolean {
  if (task.title.toLowerCase().includes(q)) return true;
  if (task.notes.toLowerCase().includes(q)) return true;
  if (task.tags.some((t) => t.toLowerCase().includes(q))) return true;
  if (task.meeting?.client.toLowerCase().includes(q)) return true;
  return task.subtasks.some((s) => s.title.toLowerCase().includes(q));
}

export function searchTasks(tasks: Record<string, Task>, query: string): SearchGroups {
  const q = query.trim().toLowerCase();
  const inbox: Task[] = [];
  const scheduled: Task[] = [];
  const completed: Task[] = [];
  if (q) {
    for (const t of Object.values(tasks)) {
      if (!matches(t, q)) continue;
      if (!t.recurrence && t.completed) completed.push(t);
      else if (t.date === null) inbox.push(t);
      else scheduled.push(t);
    }
  }
  inbox.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
  scheduled.sort(
    (a, b) =>
      (a.date ?? '').localeCompare(b.date ?? '') ||
      (a.startMinutes ?? 0) - (b.startMinutes ?? 0)
  );
  completed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return { inbox, scheduled, completed, total: inbox.length + scheduled.length + completed.length };
}

/** Where did the query hit, when it wasn't the title? */
function matchContext(task: Task, q: string): string | null {
  if (task.title.toLowerCase().includes(q)) return null;
  const sub = task.subtasks.find((s) => s.title.toLowerCase().includes(q));
  if (sub) return `Subtask: ${sub.title}`;
  const tag = task.tags.find((t) => t.toLowerCase().includes(q));
  if (tag) return `#${tag}`;
  if (task.meeting && task.meeting.client.toLowerCase().includes(q)) {
    return `Client: ${task.meeting.client}`;
  }
  if (task.notes.toLowerCase().includes(q)) {
    const lower = task.notes.toLowerCase();
    const idx = lower.indexOf(q);
    const start = Math.max(0, idx - 18);
    const snippet = task.notes.slice(start, idx + q.length + 24).replace(/\s+/g, ' ').trim();
    return `“${start > 0 ? '…' : ''}${snippet}…”`;
  }
  return null;
}

function Highlight({
  text,
  query,
  color,
  highlightColor,
  strike,
}: {
  text: string;
  query: string;
  color: string;
  highlightColor: string;
  strike?: boolean;
}) {
  const idx = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const base = [
    styles.rowTitle,
    { color },
    strike ? styles.rowTitleDone : null,
  ];
  if (idx === -1) {
    return (
      <Text numberOfLines={1} style={base}>
        {text}
      </Text>
    );
  }
  return (
    <Text numberOfLines={1} style={base}>
      {text.slice(0, idx)}
      <Text style={{ color: highlightColor, fontWeight: '800' }}>
        {text.slice(idx, idx + query.length)}
      </Text>
      {text.slice(idx + query.length)}
    </Text>
  );
}

function scheduledMeta(task: Task): string {
  if (task.recurrence) {
    const rule = describeRecurrence(task.recurrence);
    return task.startMinutes != null && !task.allDay
      ? `${rule} · ${formatMinutes(task.startMinutes)}`
      : rule;
  }
  if (!task.date) return 'Inbox';
  const when = formatDayRelative(task.date);
  return task.startMinutes != null && !task.allDay
    ? `${when} · ${formatMinutes(task.startMinutes)}`
    : task.allDay
      ? `${when} · All day`
      : when;
}

interface Props {
  tasks: Record<string, Task>;
  query: string;
  onOpen: (task: Task) => void;
}

export function SearchResults({ tasks, query, onOpen }: Props) {
  const theme = useTheme();
  const q = query.trim();
  const groups = useMemo(() => searchTasks(tasks, q), [tasks, q]);

  if (!q) {
    return (
      <EmptyGlow
        icon="search-outline"
        title="Search everything"
        subtitle="Find any task by title, notes, subtasks, tags, or client — across your inbox, schedule, and history."
      />
    );
  }

  if (groups.total === 0) {
    return (
      <EmptyGlow
        icon="planet-outline"
        title="No results"
        subtitle={`Nothing matches “${q}”. Try a shorter or different word.`}
      />
    );
  }

  const section = (title: string, list: Task[], keyPrefix: string, dim = false) => {
    if (list.length === 0) return null;
    return (
      <View key={keyPrefix} style={styles.section}>
        <Text style={[styles.sectionHeader, { color: theme.textSecondary }]}>
          {title} · {list.length}
        </Text>
        {list.map((task) => {
          const c = taskColor(task.color);
          const context = matchContext(task, q.toLowerCase());
          const done = !task.recurrence && task.completed;
          return (
            <Pressable
              key={task.id}
              onPress={() => onOpen(task)}
              accessibilityLabel={`Open ${task.title}`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  opacity: pressed ? 0.8 : dim ? 0.65 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                },
              ]}
            >
              <View style={[styles.rowIcon, { backgroundColor: c.solid }]}>
                <Ionicons name={task.icon as never} size={15} color="#fff" />
              </View>
              <View style={styles.rowBody}>
                <Highlight
                  text={task.title}
                  query={q}
                  color={theme.text}
                  highlightColor={theme.accent}
                  strike={done}
                />
                <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.textSecondary }]}>
                  {keyPrefix === 'inbox' ? 'Inbox' : scheduledMeta(task)}
                </Text>
                {context ? (
                  <Text
                    numberOfLines={1}
                    style={[styles.rowContext, { color: theme.textTertiary }]}
                  >
                    {context}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={15} color={theme.textTertiary} />
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.count, { color: theme.textSecondary }]}>
        {groups.total} result{groups.total === 1 ? '' : 's'} for “{q}”
      </Text>
      {section('Inbox', groups.inbox, 'inbox')}
      {section('Scheduled', groups.scheduled, 'scheduled')}
      {section('Completed', groups.completed, 'completed', true)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SPACING.lg },
  count: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  section: { gap: SPACING.sm },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
    overflow: 'hidden',
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowTitleDone: { textDecorationLine: 'line-through' },
  rowMeta: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },
  rowContext: { fontSize: 12, fontStyle: 'italic' },
});
