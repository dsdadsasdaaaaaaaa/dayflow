import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { uid } from '../lib/id';
import { isInstanceCompleted, taskOccursOn } from '../lib/recurrence';
import type { DayKey, Task, TaskInstance } from '../types';

export interface NewTaskInput {
  title: string;
  icon?: string;
  color?: string;
  notes?: string;
  date?: DayKey | null;
  allDay?: boolean;
  startMinutes?: number | null;
  durationMinutes?: number;
  subtasks?: Task['subtasks'];
  alerts?: number[];
  recurrence?: Task['recurrence'];
  priority?: Task['priority'];
  tags?: string[];
  meeting?: Task['meeting'];
}

interface TaskState {
  tasks: Record<string, Task>;
  addTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  /** Delete just one occurrence of a recurring task. */
  skipOccurrence: (id: string, day: DayKey) => void;
  /**
   * Detach one occurrence of a recurring task into a standalone one-off task
   * (carrying over that day's completion / paid / amount adjustment), and skip
   * the occurrence in the original series. Returns the detached task.
   * Used when moving/shifting a single day of a series so the series anchor
   * and its per-day history stay intact.
   */
  detachOccurrence: (id: string, day: DayKey) => Task | null;
  /** Toggle completion of a task occurrence (handles recurring vs one-off). */
  toggleComplete: (id: string, day: DayKey) => void;
  /** Toggle whether a meeting occurrence's payment has been collected. */
  togglePaid: (id: string, day: DayKey) => void;
  /**
   * Record the settled final amount for one meeting occurrence
   * (tip/overtime/discount). Stored as an ABSOLUTE per-day override so later
   * rate edits never change already-settled days.
   */
  setOccurrenceAmount: (id: string, day: DayKey, amount: number) => void;
  /** Record a booking deposit received up-front for one occurrence (0 clears). */
  setOccurrenceDeposit: (id: string, day: DayKey, amount: number) => void;
  /** Move a task to a date/time (drag-reschedule, inbox scheduling). */
  scheduleTask: (
    id: string,
    date: DayKey | null,
    startMinutes: number | null,
    allDay?: boolean
  ) => void;
  duplicateTask: (id: string) => Task | null;
  clearCompletedInbox: () => void;
  importTasks: (tasks: Task[]) => void;
}

/**
 * When a ONE-OFF meeting moves to a different date, its per-day paid mark and
 * amount override must follow it (they're keyed by DayKey).
 */
function remapMeetingDay(task: Task, oldDate: DayKey | null, newDate: DayKey | null): Task {
  if (!task.meeting || task.recurrence || !oldDate || oldDate === newDate) return task;
  const meeting = { ...task.meeting };
  let changed = false;
  if (newDate && meeting.paidDates.includes(oldDate)) {
    meeting.paidDates = meeting.paidDates.map((d) => (d === oldDate ? newDate : d));
    changed = true;
  }
  if (meeting.extras && meeting.extras[oldDate] != null) {
    const extras = { ...meeting.extras };
    if (newDate) extras[newDate] = extras[oldDate];
    delete extras[oldDate];
    meeting.extras = extras;
    changed = true;
  }
  if (meeting.deposits && meeting.deposits[oldDate] != null) {
    const deposits = { ...meeting.deposits };
    if (newDate) deposits[newDate] = deposits[oldDate];
    delete deposits[oldDate];
    meeting.deposits = deposits;
    changed = true;
  }
  return changed ? { ...task, meeting } : task;
}

const RECUR_FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const MEETING_KINDS_VALID = ['incall', 'outcall', 'public'] as const;

/**
 * Coerce an imported (untrusted JSON) task into a valid Task, or null if it
 * can't be salvaged. Prevents malformed backups from creating tasks that are
 * silently invisible or crash render paths.
 */
function sanitizeImportedTask(raw: unknown): Task | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id || typeof t.title !== 'string' || !t.title.trim()) {
    return null;
  }
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const dayKey = (v: unknown): DayKey | null =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

  let recurrence: Task['recurrence'] = null;
  const r = t.recurrence as Record<string, unknown> | null | undefined;
  if (r && typeof r === 'object' && RECUR_FREQS.includes(r.freq as never)) {
    recurrence = {
      freq: r.freq as NonNullable<Task['recurrence']>['freq'],
      interval: Math.max(1, Math.round(num(r.interval, 1))),
      weekdays: Array.isArray(r.weekdays)
        ? r.weekdays.filter((w): w is number => typeof w === 'number' && w >= 0 && w <= 6)
        : undefined,
      until: dayKey(r.until),
    };
  }

  let meeting: Task['meeting'] = null;
  const m = t.meeting as Record<string, unknown> | null | undefined;
  if (m && typeof m === 'object') {
    meeting = {
      kind: MEETING_KINDS_VALID.includes(m.kind as never)
        ? (m.kind as NonNullable<Task['meeting']>['kind'])
        : 'incall',
      client: typeof m.client === 'string' ? m.client : '',
      rate: Math.max(0, num(m.rate, 0)),
      paidDates: Array.isArray(m.paidDates)
        ? m.paidDates.filter((d): d is DayKey => dayKey(d) != null)
        : [],
      location: typeof m.location === 'string' ? m.location : '',
      extras:
        m.extras && typeof m.extras === 'object'
          ? Object.fromEntries(
              Object.entries(m.extras as Record<string, unknown>)
                .filter(([k, v]) => dayKey(k) != null && typeof v === 'number')
                .map(([k, v]) => [k, v as number])
            )
          : {},
      deposits:
        m.deposits && typeof m.deposits === 'object'
          ? Object.fromEntries(
              Object.entries(m.deposits as Record<string, unknown>)
                .filter(([k, v]) => dayKey(k) != null && typeof v === 'number' && v >= 0)
                .map(([k, v]) => [k, v as number])
            )
          : {},
    };
  }

  return {
    id: t.id,
    title: t.title.trim(),
    icon: typeof t.icon === 'string' && t.icon ? t.icon : 'ellipse-outline',
    color: typeof t.color === 'string' && t.color ? t.color : 'indigo',
    notes: typeof t.notes === 'string' ? t.notes : '',
    date: dayKey(t.date),
    allDay: t.allDay === true,
    startMinutes:
      typeof t.startMinutes === 'number' && t.startMinutes >= 0 && t.startMinutes < 1440
        ? Math.round(t.startMinutes)
        : null,
    durationMinutes: Math.max(0, Math.round(num(t.durationMinutes, 60))),
    subtasks: Array.isArray(t.subtasks)
      ? t.subtasks
          .filter(
            (st): st is { id: string; title: string; done?: unknown } =>
              !!st && typeof st === 'object' && typeof (st as { title?: unknown }).title === 'string'
          )
          .map((st, i) => ({
            id: typeof st.id === 'string' && st.id ? st.id : `${t.id}-st${i}`,
            title: st.title,
            done: st.done === true,
          }))
      : [],
    alerts: Array.isArray(t.alerts)
      ? t.alerts.filter((a): a is number => typeof a === 'number' && a >= 0)
      : [],
    recurrence,
    priority: [0, 1, 2, 3].includes(t.priority as number) ? (t.priority as Task['priority']) : 0,
    tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : [],
    meeting,
    completed: t.completed === true,
    completedAt: typeof t.completedAt === 'number' ? t.completedAt : null,
    completions:
      t.completions && typeof t.completions === 'object'
        ? Object.fromEntries(
            Object.entries(t.completions as Record<string, unknown>)
              .filter(([k, v]) => dayKey(k) != null && typeof v === 'boolean')
              .map(([k, v]) => [k, v as boolean])
          )
        : {},
    skips: Array.isArray(t.skips) ? t.skips.filter((d): d is DayKey => dayKey(d) != null) : [],
    createdAt: num(t.createdAt, Date.now()),
    updatedAt: num(t.updatedAt, Date.now()),
  };
}

function makeTask(input: NewTaskInput): Task {
  const now = Date.now();
  return {
    id: uid(),
    title: input.title.trim(),
    icon: input.icon ?? 'ellipse-outline',
    color: input.color ?? 'indigo',
    notes: input.notes ?? '',
    date: input.date ?? null,
    allDay: input.allDay ?? false,
    startMinutes: input.startMinutes ?? null,
    durationMinutes: input.durationMinutes ?? 60,
    subtasks: input.subtasks ?? [],
    alerts: input.alerts ?? [],
    recurrence: input.recurrence ?? null,
    priority: input.priority ?? 0,
    tags: input.tags ?? [],
    meeting: input.meeting ?? null,
    completed: false,
    completedAt: null,
    completions: {},
    skips: [],
    createdAt: now,
    updatedAt: now,
  };
}

export const useTasks = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: {},

      addTask: (input) => {
        const task = makeTask(input);
        set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }));
        return task;
      },

      updateTask: (id, patch) =>
        set((s) => {
          const existing = s.tasks[id];
          if (!existing) return s;
          let next: Task = { ...existing, ...patch, id, updatedAt: Date.now() };
          if ('date' in patch) next = remapMeetingDay(next, existing.date, next.date);
          return { tasks: { ...s.tasks, [id]: next } };
        }),

      deleteTask: (id) =>
        set((s) => {
          const { [id]: _removed, ...rest } = s.tasks;
          return { tasks: rest };
        }),

      skipOccurrence: (id, day) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t) return s;
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...t, skips: [...t.skips, day], updatedAt: Date.now() },
            },
          };
        }),

      toggleComplete: (id, day) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t) return s;
          let next: Task;
          if (t.recurrence) {
            const done = !t.completions[day];
            next = {
              ...t,
              completions: { ...t.completions, [day]: done },
              updatedAt: Date.now(),
            };
          } else {
            const done = !t.completed;
            next = {
              ...t,
              completed: done,
              completedAt: done ? Date.now() : null,
              updatedAt: Date.now(),
            };
          }
          return { tasks: { ...s.tasks, [id]: next } };
        }),

      detachOccurrence: (id, day) => {
        const t = get().tasks[id];
        if (!t || !t.recurrence) return null;
        const completedToday = !!t.completions[day];
        const copy: Task = {
          ...t,
          id: uid(),
          date: day,
          recurrence: null,
          completed: completedToday,
          completedAt: completedToday ? Date.now() : null,
          completions: {},
          skips: [],
          subtasks: t.subtasks.map((st) => ({ ...st, id: uid() })),
          meeting: t.meeting
            ? {
                ...t.meeting,
                paidDates: t.meeting.paidDates.includes(day) ? [day] : [],
                extras:
                  t.meeting.extras && t.meeting.extras[day] != null
                    ? { [day]: t.meeting.extras[day] }
                    : {},
                deposits:
                  t.meeting.deposits && t.meeting.deposits[day] != null
                    ? { [day]: t.meeting.deposits[day] }
                    : {},
              }
            : null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => {
          const orig = s.tasks[id];
          if (!orig) return s;
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...orig, skips: [...orig.skips, day], updatedAt: Date.now() },
              [copy.id]: copy,
            },
          };
        });
        return copy;
      },

      togglePaid: (id, day) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t || !t.meeting) return s;
          const paid = t.meeting.paidDates.includes(day);
          const paidDates = paid
            ? t.meeting.paidDates.filter((d) => d !== day)
            : [...t.meeting.paidDates, day];
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...t, meeting: { ...t.meeting, paidDates }, updatedAt: Date.now() },
            },
          };
        }),

      setOccurrenceAmount: (id, day, amount) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t || !t.meeting) return s;
          const extras = { ...(t.meeting.extras ?? {}), [day]: amount };
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...t, meeting: { ...t.meeting, extras }, updatedAt: Date.now() },
            },
          };
        }),

      setOccurrenceDeposit: (id, day, amount) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t || !t.meeting) return s;
          const deposits = { ...(t.meeting.deposits ?? {}) };
          if (amount > 0) deposits[day] = amount;
          else delete deposits[day];
          return {
            tasks: {
              ...s.tasks,
              [id]: { ...t, meeting: { ...t.meeting, deposits }, updatedAt: Date.now() },
            },
          };
        }),

      scheduleTask: (id, date, startMinutes, allDay = false) =>
        set((s) => {
          const t = s.tasks[id];
          if (!t) return s;
          let next: Task = { ...t, date, startMinutes, allDay, updatedAt: Date.now() };
          next = remapMeetingDay(next, t.date, date);
          return { tasks: { ...s.tasks, [id]: next } };
        }),

      duplicateTask: (id) => {
        const t = get().tasks[id];
        if (!t) return null;
        const copy: Task = {
          ...t,
          id: uid(),
          title: t.title,
          completed: false,
          completedAt: null,
          completions: {},
          skips: [],
          subtasks: t.subtasks.map((st) => ({ ...st, id: uid(), done: false })),
          meeting: t.meeting
            ? { ...t.meeting, paidDates: [], extras: {}, deposits: {} }
            : null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ tasks: { ...s.tasks, [copy.id]: copy } }));
        return copy;
      },

      clearCompletedInbox: () =>
        set((s) => {
          const tasks = { ...s.tasks };
          for (const [id, t] of Object.entries(tasks)) {
            if (t.date === null && t.completed) delete tasks[id];
          }
          return { tasks };
        }),

      importTasks: (list) =>
        set((s) => {
          const tasks = { ...s.tasks };
          for (const raw of list) {
            const t = sanitizeImportedTask(raw);
            if (t) tasks[t.id] = t;
          }
          return { tasks };
        }),
    }),
    {
      name: 'dayflow-tasks',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/** All occurrences for a day, sorted: all-day first, then by start time. */
export function instancesForDay(tasks: Record<string, Task>, day: DayKey): TaskInstance[] {
  const out: TaskInstance[] = [];
  for (const t of Object.values(tasks)) {
    if (taskOccursOn(t, day)) {
      out.push({ task: t, dateKey: day, completed: isInstanceCompleted(t, day) });
    }
  }
  out.sort((a, b) => {
    const aAll = a.task.allDay || a.task.startMinutes == null;
    const bAll = b.task.allDay || b.task.startMinutes == null;
    if (aAll !== bAll) return aAll ? -1 : 1;
    return (a.task.startMinutes ?? 0) - (b.task.startMinutes ?? 0);
  });
  return out;
}

/** Inbox = unscheduled tasks, incomplete first, newest first within groups. */
export function inboxTasks(tasks: Record<string, Task>): Task[] {
  return Object.values(tasks)
    .filter((t) => t.date === null)
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.createdAt - a.createdAt;
    });
}
