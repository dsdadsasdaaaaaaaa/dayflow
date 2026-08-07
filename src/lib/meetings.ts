import type { DayKey, MeetingKind, MeetingLogEntry, Task } from '../types';
import { addDays, formatMinutes, todayKey } from './dates';
import { isInstanceCompleted, taskOccursOn } from './recurrence';

/** Display metadata for meeting kinds. */
export const MEETING_KINDS: { key: MeetingKind; label: string; icon: string }[] = [
  { key: 'incall', label: 'In-call', icon: 'home-outline' },
  { key: 'outcall', label: 'Out-call', icon: 'car-outline' },
  { key: 'public', label: 'Public spot', icon: 'cafe-outline' },
];

export function meetingKindMeta(kind: MeetingKind) {
  return MEETING_KINDS.find((k) => k.key === kind) ?? MEETING_KINDS[0];
}

/** "$150" / "$1,250" / "$99.50" — trims trailing .00. */
export function formatMoney(amount: number, symbol = '$'): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasCents = Math.abs(rounded % 1) > 0.004;
  const str = rounded.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
  return `${symbol}${str}`;
}

export function isPaidOn(task: Task, day: DayKey): boolean {
  return !!task.meeting?.paidDates.includes(day);
}

/**
 * Effective amount for one occurrence: the settled per-day override when one
 * was recorded (absolute, immune to later rate edits), else the base rate.
 */
export function occurrenceAmount(task: Task, day: DayKey): number {
  if (!task.meeting) return 0;
  return task.meeting.extras?.[day] ?? task.meeting.rate;
}

/** Deposit received up-front for one occurrence (0 when none). */
export function occurrenceDeposit(task: Task, day: DayKey): number {
  return task.meeting?.deposits?.[day] ?? 0;
}

/**
 * What's still owed for one occurrence: full amount when unpaid minus any
 * deposit, zero once marked paid. Never negative.
 */
export function occurrenceOwed(task: Task, day: DayKey): number {
  if (!task.meeting || isPaidOn(task, day)) return 0;
  return Math.max(0, occurrenceAmount(task, day) - occurrenceDeposit(task, day));
}

export interface MeetingOccurrence {
  task: Task;
  dateKey: DayKey;
  completed: boolean;
  paid: boolean;
  rate: number;
  client: string;
  kind: MeetingKind;
}

/** All meeting occurrences across the given days (any completion state). */
export function meetingOccurrences(
  tasks: Record<string, Task>,
  days: DayKey[]
): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const task of Object.values(tasks)) {
    if (!task.meeting) continue;
    for (const day of days) {
      if (!taskOccursOn(task, day)) continue;
      out.push({
        task,
        dateKey: day,
        completed: isInstanceCompleted(task, day),
        paid: isPaidOn(task, day),
        rate: occurrenceAmount(task, day),
        client: task.meeting.client,
        kind: task.meeting.kind,
      });
    }
  }
  return out;
}

export interface EarningsSummary {
  /** Sum of rates for completed meeting occurrences. */
  earned: number;
  /** Sum of rates for every scheduled occurrence (completed or not). */
  expected: number;
  /** Completed but not yet marked paid. */
  outstanding: number;
  /** Collected (completed and paid). */
  collected: number;
  meetingsDone: number;
  meetingsPlanned: number;
}

export function earningsForDays(tasks: Record<string, Task>, days: DayKey[]): EarningsSummary {
  const occ = meetingOccurrences(tasks, days);
  let earned = 0;
  let expected = 0;
  let outstanding = 0;
  let collected = 0;
  let meetingsDone = 0;
  for (const m of occ) {
    expected += m.rate;
    if (m.completed) {
      earned += m.rate;
      meetingsDone += 1;
      if (m.paid) {
        collected += m.rate;
      } else {
        // A deposit paid up-front counts as collected; only the rest is owed.
        const deposit = Math.min(m.rate, occurrenceDeposit(m.task, m.dateKey));
        collected += deposit;
        outstanding += m.rate - deposit;
      }
    }
  }
  return {
    earned,
    expected,
    outstanding,
    collected,
    meetingsDone,
    meetingsPlanned: occ.length,
  };
}

/** Distinct client names seen across all meetings, most recent first. */
export function knownClients(tasks: Record<string, Task>): string[] {
  const byClient = new Map<string, number>();
  for (const t of Object.values(tasks)) {
    if (!t.meeting || !t.meeting.client.trim()) continue;
    const name = t.meeting.client.trim();
    const prev = byClient.get(name) ?? 0;
    if (t.updatedAt > prev) byClient.set(name, t.updatedAt);
  }
  return [...byClient.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** Aggregated everything-about-one-client, for the client book. */
export interface ClientProfile {
  name: string;
  kind: MeetingKind;
  rate: number;
  location: string;
  /** Completed meetings, all time. */
  meetingsDone: number;
  earned: number;
  collected: number;
  outstanding: number;
  /** Actual minutes from live-session logs (all time). */
  loggedMinutes: number;
  /** Most recent completed occurrence day. */
  lastSeen: DayKey | null;
  /** Next scheduled occurrence from today, if any. */
  nextMeeting: DayKey | null;
  /** Unpaid completed occurrences, for settling up. */
  unpaid: { task: Task; dateKey: DayKey; amount: number }[];
}

/**
 * Build the client book from tasks + session log. Clients are keyed by
 * case-insensitive trimmed name; display name/rate/kind come from the most
 * recently updated task.
 */
export function clientProfiles(
  tasks: Record<string, Task>,
  log: MeetingLogEntry[]
): ClientProfile[] {
  const today = todayKey();
  const horizon = addDays(today, 365);
  const byKey = new Map<string, ClientProfile & { _updatedAt: number }>();

  for (const task of Object.values(tasks)) {
    if (!task.meeting || !task.meeting.client.trim() || !task.date) continue;
    const name = task.meeting.client.trim();
    const key = name.toLowerCase();
    let p = byKey.get(key);
    if (!p) {
      p = {
        name,
        kind: task.meeting.kind,
        rate: task.meeting.rate,
        location: task.meeting.location,
        meetingsDone: 0,
        earned: 0,
        collected: 0,
        outstanding: 0,
        loggedMinutes: 0,
        lastSeen: null,
        nextMeeting: null,
        unpaid: [],
        _updatedAt: task.updatedAt,
      };
      byKey.set(key, p);
    }
    if (task.updatedAt > p._updatedAt) {
      p.name = name;
      p.kind = task.meeting.kind;
      p.rate = task.meeting.rate;
      p.location = task.meeting.location;
      p._updatedAt = task.updatedAt;
    }

    // Walk this task's occurrences: past year back through anchor for
    // completed history, forward to the horizon for the next booking.
    const start = task.date;
    const end = task.recurrence ? horizon : task.date;
    for (let day = start; day <= end; day = addDays(day, 1)) {
      if (!taskOccursOn(task, day)) {
        if (!task.recurrence) break;
        continue;
      }
      if (day <= today && isInstanceCompleted(task, day)) {
        const amount = occurrenceAmount(task, day);
        p.meetingsDone += 1;
        p.earned += amount;
        if (isPaidOn(task, day)) {
          p.collected += amount;
        } else {
          const deposit = Math.min(amount, occurrenceDeposit(task, day));
          p.collected += deposit;
          const owed = amount - deposit;
          if (owed > 0) {
            p.outstanding += owed;
            p.unpaid.push({ task, dateKey: day, amount: owed });
          }
        }
        if (!p.lastSeen || day > p.lastSeen) p.lastSeen = day;
      }
      if (day > today && !isInstanceCompleted(task, day)) {
        if (!p.nextMeeting || day < p.nextMeeting) p.nextMeeting = day;
      }
      if (!task.recurrence) break;
    }
  }

  for (const e of log) {
    const p = byKey.get(e.client.trim().toLowerCase());
    if (p) p.loggedMinutes += e.actualMinutes;
  }

  return [...byKey.values()]
    .map(({ _updatedAt, ...p }) => p)
    .sort((a, b) => b.earned - a.earned);
}

/** CSV of all completed meeting occurrences (for bookkeeping/export). */
export function meetingsCsv(
  tasks: Record<string, Task>,
  log: MeetingLogEntry[],
  symbol = '$'
): string {
  const today = todayKey();
  const logByTaskDay = new Map<string, MeetingLogEntry>();
  for (const e of log) logByTaskDay.set(`${e.taskId}|${e.dateKey}`, e);

  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows: string[][] = [];
  for (const task of Object.values(tasks)) {
    if (!task.meeting || !task.date) continue;
    const end = task.recurrence ? today : task.date;
    for (let day = task.date; day <= end; day = addDays(day, 1)) {
      if (!taskOccursOn(task, day)) {
        if (!task.recurrence) break;
        continue;
      }
      if (day <= today && isInstanceCompleted(task, day)) {
        const session = logByTaskDay.get(`${task.id}|${day}`);
        rows.push([
          day,
          task.meeting.client,
          meetingKindMeta(task.meeting.kind).label,
          task.title,
          task.startMinutes != null ? formatMinutes(task.startMinutes) : '',
          String(task.durationMinutes),
          session ? String(session.actualMinutes) : '',
          occurrenceAmount(task, day).toFixed(2),
          isPaidOn(task, day) ? 'yes' : 'no',
        ]);
      }
      if (!task.recurrence) break;
    }
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const header = [
    'date',
    'client',
    'type',
    'title',
    'start',
    'planned_min',
    'actual_min',
    `amount_${symbol === '$' ? 'usd' : symbol}`,
    'paid',
  ];
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

/** Most recent meeting settings for a client — used to prefill rate/kind. */
export function lastMeetingFor(
  tasks: Record<string, Task>,
  client: string
): { rate: number; kind: MeetingKind; location: string } | null {
  const name = client.trim().toLowerCase();
  if (!name) return null;
  let best: Task | null = null;
  for (const t of Object.values(tasks)) {
    if (!t.meeting || t.meeting.client.trim().toLowerCase() !== name) continue;
    if (!best || t.updatedAt > best.updatedAt) best = t;
  }
  if (!best?.meeting) return null;
  return { rate: best.meeting.rate, kind: best.meeting.kind, location: best.meeting.location };
}
