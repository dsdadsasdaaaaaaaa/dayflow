import { clientMetaKey, effectiveStatus, type ClientMeta } from '../store/clientMeta';
import type { DayKey, MeetingLogEntry, Task } from '../types';
import { addDays, daysBetween, lastNDays, todayKey } from './dates';
import { meetingOccurrences } from './meetings';

/** Minimum completed occurrences before a client counts as a "regular". */
const MIN_MEETINGS = 3;
/** Overdue once the current gap exceeds this multiple of the median gap. */
const OVERDUE_RATIO = 1.25;
/** Gaps beyond this are a lapse, not a rhythm — excluded entirely. */
const MAX_GAP_DAYS = 90;
/** How far back to read history and forward to look for bookings. */
const WINDOW_DAYS = 365;

/** A regular client who is past their usual rebooking rhythm. */
export interface OverdueRegular {
  /** Display name (most recently updated task's casing). */
  client: string;
  /** Most recent completed meeting day. */
  lastSeen: DayKey;
  /** Median gap in days between their consecutive meeting days. */
  medianDays: number;
  /** Whole days past the usual rhythm (days since last seen − median). */
  overdueDays: number;
  /** Linked phone from client meta, when saved. */
  phone?: string;
}

/** Median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface ClientAcc {
  name: string;
  nameUpdatedAt: number;
  /** Completed meeting occurrences (the "regular" threshold). */
  doneCount: number;
  /** Distinct completed meeting days (rhythm math; log days merge in). */
  doneDays: Set<DayKey>;
  /** Any booking still ahead (today's unfinished meeting counts). */
  hasUpcoming: boolean;
}

/**
 * Rebook radar: regulars who are overdue relative to their own rhythm.
 * A client qualifies with ≥3 completed meeting occurrences; their rhythm is
 * the median gap between consecutive meeting days (gaps over 90 days are
 * breaks, not rhythm, and drop out). Overdue = no upcoming booking AND days
 * since the last meeting > 1.25 × median. Blocked clients and lapsed ones
 * (last seen over 90 days ago) never surface. Sorted most-overdue-relative
 * (days since ÷ median) first.
 */
export function overdueRegulars(
  tasks: Record<string, Task>,
  log: MeetingLogEntry[],
  meta: Record<string, ClientMeta>
): OverdueRegular[] {
  const today = todayKey();
  const days = [
    ...lastNDays(WINDOW_DAYS + 1),
    ...Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i + 1)),
  ];

  const byKey = new Map<string, ClientAcc>();
  for (const o of meetingOccurrences(tasks, days)) {
    const name = o.client.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        name,
        nameUpdatedAt: o.task.updatedAt,
        doneCount: 0,
        doneDays: new Set(),
        hasUpcoming: false,
      };
      byKey.set(key, acc);
    }
    if (o.task.updatedAt > acc.nameUpdatedAt) {
      acc.name = name;
      acc.nameUpdatedAt = o.task.updatedAt;
    }
    if (o.dateKey <= today && o.completed) {
      acc.doneCount += 1;
      acc.doneDays.add(o.dateKey);
    } else if (!o.completed && o.dateKey >= today) {
      acc.hasUpcoming = true;
    }
  }

  // Live-session log days refine the rhythm (covers since-deleted tasks).
  for (const e of log) {
    const acc = byKey.get(e.client.trim().toLowerCase());
    if (acc && e.dateKey <= today) acc.doneDays.add(e.dateKey);
  }

  const out: (OverdueRegular & { relative: number })[] = [];
  for (const acc of byKey.values()) {
    if (acc.doneCount < MIN_MEETINGS || acc.hasUpcoming) continue;
    if (effectiveStatus(meta, acc.name, true) === 'blocked') continue;

    const doneDays = [...acc.doneDays].sort();
    const lastSeen = doneDays[doneDays.length - 1];
    const sinceLast = daysBetween(lastSeen, today);
    if (sinceLast > MAX_GAP_DAYS) continue; // lapsed, not "regular"

    const gaps: number[] = [];
    for (let i = 1; i < doneDays.length; i++) {
      const gap = daysBetween(doneDays[i - 1], doneDays[i]);
      if (gap > 0 && gap <= MAX_GAP_DAYS) gaps.push(gap);
    }
    if (gaps.length === 0) continue;

    const medianDays = median(gaps);
    if (sinceLast <= medianDays * OVERDUE_RATIO) continue;

    out.push({
      client: acc.name,
      lastSeen,
      medianDays,
      overdueDays: Math.round(sinceLast - medianDays),
      phone: meta[clientMetaKey(acc.name)]?.phone,
      relative: sinceLast / medianDays,
    });
  }

  return out
    .sort((a, b) => b.relative - a.relative)
    .map(({ relative: _relative, ...r }) => r);
}
