import type { DayKey, Recurrence, Task } from '../types';
import { daysBetween, fromDayKey, weekdayOf } from './dates';

/**
 * Week-start used for weekly-interval math. Defaults to Monday; the settings
 * store updates it on rehydration/changes so "every 2 weeks" aligns with the
 * user's calendar weeks (matters for weekday sets spanning Sun/Mon).
 */
let intervalWeekStart: 0 | 1 = 1;

export function setRecurrenceWeekStart(weekStartsOn: 0 | 1): void {
  intervalWeekStart = weekStartsOn;
}

/**
 * Does a recurring rule anchored at `anchor` produce an occurrence on `day`?
 * The anchor date itself is always an occurrence (when it matches the rule's
 * weekday set for weekly rules).
 */
export function ruleOccursOn(rule: Recurrence, anchor: DayKey, day: DayKey): boolean {
  const diff = daysBetween(anchor, day);
  if (diff < 0) return false;
  if (rule.until && daysBetween(rule.until, day) > 0) return false;
  const interval = Math.max(1, rule.interval || 1);

  switch (rule.freq) {
    case 'daily':
      return diff % interval === 0;
    case 'weekly': {
      const weekdays =
        rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekdayOf(anchor)];
      if (!weekdays.includes(weekdayOf(day))) return false;
      // Interval counts weeks from the anchor's week (week starts Monday).
      const anchorWeekStart = diff0ToWeekStart(anchor);
      const dayWeekStart = diff0ToWeekStart(day);
      const weeks = Math.round(daysBetween(anchorWeekStart, dayWeekStart) / 7);
      return weeks % interval === 0;
    }
    case 'monthly': {
      const a = fromDayKey(anchor);
      const d = fromDayKey(day);
      if (d.getDate() !== a.getDate()) return false;
      const months =
        (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
      return months >= 0 && months % interval === 0;
    }
    case 'yearly': {
      const a = fromDayKey(anchor);
      const d = fromDayKey(day);
      const years = d.getFullYear() - a.getFullYear();
      if (years < 0 || years % interval !== 0) return false;
      if (d.getDate() === a.getDate() && d.getMonth() === a.getMonth()) return true;
      // Feb 29 anchors fall back to Feb 28 in non-leap years.
      if (a.getMonth() === 1 && a.getDate() === 29 && d.getMonth() === 1 && d.getDate() === 28) {
        return new Date(d.getFullYear(), 1, 29).getDate() !== 29;
      }
      return false;
    }
  }
}

function diff0ToWeekStart(key: DayKey): DayKey {
  const wd = weekdayOf(key); // 0=Sun..6=Sat
  const offset = (wd - intervalWeekStart + 7) % 7;
  const d = fromDayKey(key);
  d.setDate(d.getDate() - offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Does this task (one-off or recurring) occur on `day`? Skips respected. */
export function taskOccursOn(task: Task, day: DayKey): boolean {
  if (!task.date) return false;
  if (task.skips.includes(day)) return false;
  if (!task.recurrence) return task.date === day;
  return ruleOccursOn(task.recurrence, task.date, day);
}

/**
 * The next day (today or later, within a year) this task occurs, or its
 * anchor date as a fallback. Use when opening a recurring task without a
 * specific occurrence in hand (e.g. from search) so per-occurrence actions
 * target the day the user actually means.
 */
export function nextOccurrence(task: Task, from: DayKey): DayKey | null {
  if (!task.date) return null;
  if (!task.recurrence) return task.date;
  let day = from < task.date ? task.date : from;
  for (let i = 0; i < 366; i++) {
    if (taskOccursOn(task, day)) return day;
    day = addDaysLocal(day, 1);
  }
  return task.date;
}

function addDaysLocal(key: DayKey, days: number): DayKey {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Is the given occurrence of this task completed? */
export function isInstanceCompleted(task: Task, day: DayKey): boolean {
  if (task.recurrence) return !!task.completions[day];
  return task.completed;
}

/** Human description of a recurrence rule, e.g. "Every week on Mon, Wed". */
export function describeRecurrence(rule: Recurrence | null): string {
  if (!rule) return 'Never';
  const interval = Math.max(1, rule.interval || 1);
  const every = (unit: string) =>
    interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  switch (rule.freq) {
    case 'daily':
      return every('day');
    case 'weekly': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (rule.weekdays ?? []).map((w) => names[w]).join(', ');
      const base = every('week');
      return days ? `${base} on ${days}` : base;
    }
    case 'monthly':
      return every('month');
    case 'yearly':
      return every('year');
  }
}
