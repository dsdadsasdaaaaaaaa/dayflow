// Pure analytics computations for the Stats screen.
// Everything here is deterministic on its inputs so the screen can wrap
// each call in useMemo and stay cheap on re-renders.

import {
  addDays,
  formatDayShort,
  formatMinutes,
  monthShort,
  toDayKey,
  todayKey,
  weekdayOf,
} from '../../lib/dates';
import { earningsForDays, formatMoney, occurrenceAmount } from '../../lib/meetings';
import type { MeetingOccurrence } from '../../lib/meetings';
import { isInstanceCompleted, taskOccursOn } from '../../lib/recurrence';
import { minutesFocusedOn } from '../../store/focus';
import { habitActiveOn, habitStreak } from '../../store/habits';
import { instancesForDay } from '../../store/tasks';
import { taskColor } from '../../theme';
import type {
  DayKey,
  FocusSession,
  Habit,
  MeetingKind,
  MeetingLogEntry,
  Task,
} from '../../types';
import { fmtClockCompact } from './format';

// ---------------------------------------------------------------- completion

export interface DayCompletion {
  day: DayKey;
  planned: number;
  completed: number;
}

/** Planned vs completed occurrence counts for each day, oldest first. */
export function completionByDay(
  tasks: Record<string, Task>,
  days: DayKey[]
): DayCompletion[] {
  return days.map((day) => {
    const instances = instancesForDay(tasks, day);
    return {
      day,
      planned: instances.length,
      completed: instances.filter((i) => i.completed).length,
    };
  });
}

export interface PeriodStats {
  done: number;
  planned: number;
  /** 0..1 completion rate (0 when nothing was planned). */
  rate: number;
  focusMinutes: number;
}

/** Aggregate hero-tile stats for a set of days. */
export function periodStats(
  tasks: Record<string, Task>,
  sessions: FocusSession[],
  days: DayKey[]
): PeriodStats {
  let done = 0;
  let planned = 0;
  for (const day of days) {
    const instances = instancesForDay(tasks, day);
    planned += instances.length;
    for (const i of instances) if (i.completed) done += 1;
  }
  const focusMinutes = days.reduce((sum, d) => sum + minutesFocusedOn(sessions, d), 0);
  return { done, planned, rate: planned > 0 ? done / planned : 0, focusMinutes };
}

// ------------------------------------------------------------- busiest hours

/** Scheduled task minutes falling into each hour bucket (24 entries). */
export function hourLoad(tasks: Record<string, Task>, days: DayKey[]): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const day of days) {
    for (const inst of instancesForDay(tasks, day)) {
      const t = inst.task;
      if (t.allDay || t.startMinutes == null) continue;
      const start = t.startMinutes;
      // True duration (no inflation); the post-midnight tail of a task is
      // clamped into the 11 PM bucket rather than dropped.
      const end = Math.min(24 * 60, start + t.durationMinutes);
      if (end <= start) continue;
      const firstHour = Math.floor(start / 60);
      const lastHour = Math.min(23, Math.floor((end - 1) / 60));
      for (let h = firstHour; h <= lastHour; h++) {
        const overlap = Math.min(end, (h + 1) * 60) - Math.max(start, h * 60);
        if (overlap > 0) buckets[h] += overlap;
      }
    }
  }
  return buckets;
}

// ------------------------------------------------------------- time by color

export interface ColorSlice {
  key: string;
  /** Most common tag in the group, falling back to the palette label. */
  label: string;
  color: string;
  minutes: number;
}

/** Scheduled minutes grouped by task color, largest first. */
export function minutesByColor(
  tasks: Record<string, Task>,
  days: DayKey[]
): ColorSlice[] {
  const groups = new Map<string, { minutes: number; tagCounts: Map<string, number> }>();
  for (const day of days) {
    for (const inst of instancesForDay(tasks, day)) {
      const t = inst.task;
      if (t.allDay || t.startMinutes == null || t.durationMinutes <= 0) continue;
      const g = groups.get(t.color) ?? { minutes: 0, tagCounts: new Map() };
      g.minutes += t.durationMinutes;
      for (const tag of t.tags) {
        const trimmed = tag.trim();
        if (trimmed) g.tagCounts.set(trimmed, (g.tagCounts.get(trimmed) ?? 0) + 1);
      }
      groups.set(t.color, g);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const meta = taskColor(key);
      let topTag: string | null = null;
      let topCount = 0;
      for (const [tag, n] of g.tagCounts) {
        if (n > topCount) {
          topTag = tag;
          topCount = n;
        }
      }
      return { key, label: topTag ?? meta.label, color: meta.solid, minutes: g.minutes };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

// -------------------------------------------------------------------- focus

export interface FocusStats {
  sessions: number;
  minutes: number;
  /** Minutes focused per day, aligned with `days`. */
  perDay: number[];
  bestDay: DayKey | null;
  bestMinutes: number;
}

export function focusStats(sessions: FocusSession[], days: DayKey[]): FocusStats {
  const byDay = new Map<DayKey, number>();
  const inRange = new Set(days);
  let count = 0;
  for (const s of sessions) {
    if (!inRange.has(s.dateKey)) continue;
    count += 1;
    byDay.set(s.dateKey, (byDay.get(s.dateKey) ?? 0) + s.minutes);
  }
  const perDay = days.map((d) => byDay.get(d) ?? 0);
  let bestIdx = -1;
  let best = 0;
  perDay.forEach((m, i) => {
    if (m > best) {
      best = m;
      bestIdx = i;
    }
  });
  return {
    sessions: count,
    minutes: perDay.reduce((a, b) => a + b, 0),
    perDay,
    bestDay: bestIdx >= 0 ? days[bestIdx] : null,
    bestMinutes: best,
  };
}

// ------------------------------------------------------------------- habits

export interface HabitRow {
  habit: Habit;
  streak: number;
  /** One entry per day: -1 = inactive weekday, else completion ratio 0..1. */
  cells: number[];
}

export function habitRowsFor(habits: Habit[], days: DayKey[]): HabitRow[] {
  return habits.map((habit) => {
    // Days before the habit existed don't count against it.
    const createdDay = toDayKey(new Date(habit.createdAt));
    return {
      habit,
      streak: habitStreak(habit),
      cells: days.map((day) =>
        day >= createdDay && habitActiveOn(habit, day)
          ? Math.min(1, (habit.completions[day] ?? 0) / Math.max(1, habit.timesPerDay))
          : -1
      ),
    };
  });
}

/** Share of active habit-days fully completed across the period, 0..1. */
export function habitOverallRate(rows: HabitRow[]): number {
  let active = 0;
  let done = 0;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell < 0) continue;
      active += 1;
      if (cell >= 1) done += 1;
    }
  }
  return active > 0 ? done / active : 0;
}

// ----------------------------------------------------------------- earnings

export interface ClientStat {
  client: string;
  meetings: number;
  /** Live-session minutes from the log (0 when the timer was never used). */
  loggedMinutes: number;
  /** Planned durations of completed occurrences — fallback when no log. */
  plannedMinutes: number;
  earned: number;
  /** earned / meetings (0 when no completed meetings). */
  avgPerMeeting: number;
}

/** Per-client earnings for completed meeting occurrences, biggest earner first. */
export function clientStats(
  occurrences: MeetingOccurrence[],
  log: MeetingLogEntry[],
  days: DayKey[]
): ClientStat[] {
  const map = new Map<string, ClientStat>();
  for (const m of occurrences) {
    if (!m.completed) continue;
    const name = m.client.trim() || 'Client';
    const entry =
      map.get(name.toLowerCase()) ??
      { client: name, meetings: 0, loggedMinutes: 0, plannedMinutes: 0, earned: 0, avgPerMeeting: 0 };
    entry.meetings += 1;
    entry.earned += m.rate;
    entry.plannedMinutes += m.task.durationMinutes;
    map.set(name.toLowerCase(), entry);
  }
  const inRange = new Set(days);
  for (const e of log) {
    if (!inRange.has(e.dateKey)) continue;
    const name = e.client.trim() || 'Client';
    let entry = map.get(name.toLowerCase());
    if (!entry) {
      // Client had a live session in range but no completed occurrence
      // (e.g. session logged, task later unchecked) — still show the hours.
      entry = { client: name, meetings: 0, loggedMinutes: 0, plannedMinutes: 0, earned: 0, avgPerMeeting: 0 };
      map.set(name.toLowerCase(), entry);
    }
    entry.loggedMinutes += e.actualMinutes;
  }
  for (const entry of map.values()) {
    entry.avgPerMeeting = entry.meetings > 0 ? entry.earned / entry.meetings : 0;
  }
  return [...map.values()].sort((a, b) => b.earned - a.earned);
}

export interface KindStat {
  kind: MeetingKind;
  meetings: number;
  earned: number;
}

/** Completed meetings split by kind (only kinds that occurred). */
export function kindStats(occurrences: MeetingOccurrence[]): KindStat[] {
  const order: MeetingKind[] = ['incall', 'outcall', 'public'];
  const map = new Map<MeetingKind, KindStat>();
  for (const m of occurrences) {
    if (!m.completed) continue;
    const entry = map.get(m.kind) ?? { kind: m.kind, meetings: 0, earned: 0 };
    entry.meetings += 1;
    entry.earned += m.rate;
    map.set(m.kind, entry);
  }
  return order.map((k) => map.get(k)).filter((k): k is KindStat => !!k);
}

/** Earned amount per day (completed occurrences), aligned with `days`. */
export function earningsPerDay(occurrences: MeetingOccurrence[], days: DayKey[]): number[] {
  const byDay = new Map<DayKey, number>();
  for (const m of occurrences) {
    if (!m.completed) continue;
    byDay.set(m.dateKey, (byDay.get(m.dateKey) ?? 0) + m.rate);
  }
  return days.map((d) => byDay.get(d) ?? 0);
}

export interface MonthEarning {
  /** Short month label, e.g. "Feb". */
  label: string;
  earned: number;
}

/**
 * Earned totals for the last `monthsBack` calendar months (oldest first,
 * ending with the current month bounded at today). Deterministic per calendar
 * day, so wrap it in useMemo keyed on `tasks`.
 */
export function monthlyEarnings(
  tasks: Record<string, Task>,
  monthsBack = 6
): MonthEarning[] {
  const now = new Date();
  const out: MonthEarning[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    // Current month is bounded at today — future days can't have earnings.
    const end = i === 0 ? now : lastOfMonth;
    const days: DayKey[] = [];
    const cursor = new Date(first);
    while (cursor <= end) {
      days.push(toDayKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    out.push({
      label: monthShort(first.getMonth()),
      earned: earningsForDays(tasks, days).earned,
    });
  }
  return out;
}

// ------------------------------------------------------------ lifetime money

export interface LifetimeClient {
  client: string;
  /** Lifetime earnings across all completed occurrences. */
  earned: number;
  /** Lifetime completed meeting count. */
  meetings: number;
}

export interface MoneyStats {
  /** Lifetime earned across every completed occurrence (occurrenceAmount). */
  earned: number;
  /** Lifetime completed meeting count. */
  meetings: number;
  /** All-time live-session minutes from the meeting log. */
  loggedMinutes: number;
  /** Every client with a completed meeting, biggest lifetime earner first. */
  clients: LifetimeClient[];
  /** Lifetime earnings split by kind (only kinds that occurred). */
  kinds: KindStat[];
  /** This calendar month to date — same summary as monthlyEarnings' last bar. */
  monthEarned: number;
  /** Live-session minutes logged this calendar month. */
  monthLoggedMinutes: number;
}

/**
 * Lifetime money rollup. Walks every completed meeting occurrence from each
 * task's anchor date through today (clientProfiles-style — clientProfiles
 * itself is already all-time, but it drops blank client names and does extra
 * forward-horizon work we don't need here), so totals are all-time rather
 * than windowed. Uses occurrenceAmount so per-day settled overrides agree
 * with earningsForDays everywhere on the screen. Deterministic per calendar
 * day — wrap in useMemo keyed on `tasks` + `log`.
 */
export function moneyStats(
  tasks: Record<string, Task>,
  log: MeetingLogEntry[]
): MoneyStats {
  const today = todayKey();
  const clientMap = new Map<string, LifetimeClient>();
  const kindMap = new Map<MeetingKind, KindStat>();
  let earned = 0;
  let meetings = 0;

  for (const task of Object.values(tasks)) {
    if (!task.meeting || !task.date) continue;
    const end = task.recurrence ? today : task.date;
    for (let day = task.date; day <= end; day = addDays(day, 1)) {
      if (!taskOccursOn(task, day)) {
        if (!task.recurrence) break;
        continue;
      }
      if (day <= today && isInstanceCompleted(task, day)) {
        const amount = occurrenceAmount(task, day);
        earned += amount;
        meetings += 1;
        const name = task.meeting.client.trim() || 'Client';
        const key = name.toLowerCase();
        const c = clientMap.get(key) ?? { client: name, earned: 0, meetings: 0 };
        c.earned += amount;
        c.meetings += 1;
        clientMap.set(key, c);
        const k =
          kindMap.get(task.meeting.kind) ??
          { kind: task.meeting.kind, meetings: 0, earned: 0 };
        k.meetings += 1;
        k.earned += amount;
        kindMap.set(task.meeting.kind, k);
      }
      if (!task.recurrence) break;
    }
  }

  // This calendar month, via the exact summary the rest of the screen uses.
  const now = new Date();
  const monthDays: DayKey[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  while (cursor <= now) {
    monthDays.push(toDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const monthEarned = earningsForDays(tasks, monthDays).earned;
  const monthStart = monthDays[0];

  let loggedMinutes = 0;
  let monthLoggedMinutes = 0;
  for (const e of log) {
    loggedMinutes += e.actualMinutes;
    if (e.dateKey >= monthStart && e.dateKey <= today) {
      monthLoggedMinutes += e.actualMinutes;
    }
  }

  const order: MeetingKind[] = ['incall', 'outcall', 'public'];
  return {
    earned,
    meetings,
    loggedMinutes,
    clients: [...clientMap.values()].sort(
      (a, b) => b.earned - a.earned || b.meetings - a.meetings
    ),
    kinds: order.map((k) => kindMap.get(k)).filter((k): k is KindStat => !!k),
    monthEarned,
    monthLoggedMinutes,
  };
}

export interface SessionStats {
  count: number;
  avgMinutes: number;
  overtimeMinutes: number;
}

/** Live-session log stats for the given days. */
export function sessionStats(log: MeetingLogEntry[], days: DayKey[]): SessionStats {
  const inRange = new Set(days);
  const entries = log.filter((e) => inRange.has(e.dateKey));
  const total = entries.reduce((sum, e) => sum + e.actualMinutes, 0);
  const overtime = entries.reduce((sum, e) => sum + e.overtimeMinutes, 0);
  return {
    count: entries.length,
    avgMinutes: entries.length > 0 ? total / entries.length : 0,
    overtimeMinutes: overtime,
  };
}

// ----------------------------------------------------------------- insights

export interface Insight {
  icon: string;
  text: string;
}

const WEEKDAYS_LONG = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

/** 2-3 friendly, computed observations. Empty array = hide the card. */
export function buildInsights(input: {
  perDay: DayCompletion[];
  clients: ClientStat[];
  habits: HabitRow[];
  hours: number[];
  focus: FocusStats;
  currency: string;
  rangeLabel: string;
}): Insight[] {
  const { perDay, clients, habits, hours, focus, currency, rangeLabel } = input;
  const out: Insight[] = [];

  // Top client by earnings.
  const topClient = clients[0];
  if (topClient && topClient.earned > 0) {
    out.push({
      icon: 'ribbon-outline',
      text: `${topClient.client} is your top client this ${rangeLabel} — ${formatMoney(
        topClient.earned,
        currency
      )} across ${topClient.meetings} ${topClient.meetings === 1 ? 'meeting' : 'meetings'}.`,
    });
  }

  // Best weekday by completion rate (needs a little signal to be meaningful).
  const byWeekday = new Map<number, { planned: number; completed: number }>();
  for (const d of perDay) {
    const wd = weekdayOf(d.day);
    const entry = byWeekday.get(wd) ?? { planned: 0, completed: 0 };
    entry.planned += d.planned;
    entry.completed += d.completed;
    byWeekday.set(wd, entry);
  }
  let bestWd = -1;
  let bestRate = 0;
  for (const [wd, e] of byWeekday) {
    if (e.planned < 2) continue;
    const rate = e.completed / e.planned;
    if (rate > bestRate) {
      bestRate = rate;
      bestWd = wd;
    }
  }
  if (bestWd >= 0 && bestRate > 0) {
    out.push({
      icon: 'trophy-outline',
      text: `${WEEKDAYS_LONG[bestWd]} are your strongest days — ${Math.round(
        bestRate * 100
      )}% of planned tasks done.`,
    });
  }

  // Longest current habit streak.
  let bestStreakRow: HabitRow | null = null;
  for (const row of habits) {
    if (row.streak >= 3 && (!bestStreakRow || row.streak > bestStreakRow.streak)) {
      bestStreakRow = row;
    }
  }
  if (bestStreakRow) {
    out.push({
      icon: 'flame-outline',
      text: `“${bestStreakRow.habit.title}” is on a ${bestStreakRow.streak}-day streak. Keep it rolling.`,
    });
  }

  // Busiest hour of the day.
  let peakHour = -1;
  let peakLoad = 0;
  hours.forEach((v, h) => {
    if (v > peakLoad) {
      peakLoad = v;
      peakHour = h;
    }
  });
  if (out.length < 3 && peakHour >= 0 && peakLoad > 0) {
    out.push({
      icon: 'time-outline',
      text: `Your schedule peaks around ${formatMinutes(peakHour * 60)}.`,
    });
  }

  // Deepest focus day.
  if (out.length < 3 && focus.bestDay && focus.bestMinutes > 0) {
    out.push({
      icon: 'telescope-outline',
      text: `Deepest focus on ${formatDayShort(focus.bestDay)} — ${fmtClockCompact(
        focus.bestMinutes
      )} in the zone.`,
    });
  }

  return out.slice(0, 3);
}
