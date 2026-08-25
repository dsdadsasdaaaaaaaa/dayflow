import type { ClientMeta } from '../store/clientMeta';
import type { DayKey, MeetingLogEntry, Settings, Task } from '../types';
import { computeFreeSlots, formatSlotRange } from './availability';
import { formatMinutes, minutesOfDay, todayKey } from './dates';
import { buildFollowUps, type FollowUpThread } from './followUps';
import { clientProfiles, meetingOccurrences } from './meetings';
import { overdueRegulars } from './rebook';

/**
 * The morning briefing: one deterministic, on-device read of the day ahead.
 *
 * Every fact here is already local (tasks, the session log, the message
 * cache, client meta), so the briefing is computed straight from the stores —
 * no model, no network, no API key, no privacy surface. It is instant, free,
 * and it works on a plane.
 *
 * A quiet day is a RESULT, not a failure: `empty` simply tells the caller
 * there is nothing worth interrupting the user with, and the card renders
 * nothing rather than inventing filler.
 */

/** A gap counts as "this evening" when it reaches past this hour. */
export const BRIEFING_EVENING_HOUR = 17;

/** Open windows are useful, not exhaustive — three is plenty for a card. */
const MAX_GAPS = 3;

export interface BriefingMeetings {
  /** Meeting occurrences on the day (any completion state). */
  count: number;
  /** How many of them are already done. */
  done: number;
  /** Start of the day's first timed meeting, null when none/all-day. */
  firstStartMinutes: number | null;
  /** Start of the next timed meeting still ahead of `now`, else null. */
  nextStartMinutes: number | null;
  /** Money the day is worth if every booking happens (deposits included). */
  expected: number;
}

/** One open window on the day, ready to offer or fill. */
export interface BriefingGap {
  startMinutes: number;
  endMinutes: number;
  /** "3–6 PM" / "after 7 PM" / "anytime". */
  label: string;
  /** Reaches past BRIEFING_EVENING_HOUR. */
  evening: boolean;
}

/** Threads where our last message went unanswered. */
export interface BriefingWaiting {
  count: number;
  /** Longest silence in the set (ms, 0 when none). */
  longestQuietMs: number;
  /** Client name of the longest-waiting thread; null when unlinked. */
  topName: string | null;
}

/** Regulars past their own rebooking rhythm. */
export interface BriefingOverdue {
  count: number;
  topClient: string | null;
  topOverdueDays: number;
}

/** Money earned but not yet collected, all time. */
export interface BriefingOutstanding {
  amount: number;
  clientCount: number;
  /** Largest single debt, for a one-line summary. */
  topClient: string | null;
}

export interface Briefing {
  day: DayKey;
  /** One plain sentence: the shape of the day. Always populated. */
  headline: string;
  meetings: BriefingMeetings;
  /** Today's open windows, soonest first (capped). */
  gaps: BriefingGap[];
  /** The subset of `gaps` reaching into the evening. */
  eveningGaps: BriefingGap[];
  waiting: BriefingWaiting;
  overdue: BriefingOverdue;
  outstanding: BriefingOutstanding;
  /**
   * Nothing worth saying — no meetings, nobody waiting, nobody overdue,
   * nothing owed. Callers render nothing (the timeline's own empty state
   * already says the day is open).
   */
  empty: boolean;
}

export interface BriefingInput {
  tasks: Record<string, Task>;
  settings: Pick<Settings, 'dayStartHour' | 'dayEndHour'>;
  /** Live-session log (refines client history). */
  log: MeetingLogEntry[];
  meta: Record<string, ClientMeta>;
  /** SMS + Telegram threads, merged by the caller. */
  threads: FollowUpThread[];
  followUpSnoozedUntil: Record<string, number>;
  followUpDismissed: Record<string, true>;
  /** Clock injection — defaults to Date.now(). */
  now?: number;
  /** Day to brief — defaults to today. */
  day?: DayKey;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Today's meeting shape: how many, when, and what it is worth. */
function summarizeMeetings(
  tasks: Record<string, Task>,
  day: DayKey,
  nowMinutes: number
): BriefingMeetings {
  const occ = meetingOccurrences(tasks, [day]);
  let done = 0;
  let expected = 0;
  let first: number | null = null;
  let next: number | null = null;
  for (const o of occ) {
    expected += o.rate;
    if (o.completed) done += 1;
    const start = o.task.allDay ? null : o.task.startMinutes;
    if (start == null) continue;
    if (first == null || start < first) first = start;
    if (!o.completed && start >= nowMinutes && (next == null || start < next)) next = start;
  }
  return { count: occ.length, done, firstStartMinutes: first, nextStartMinutes: next, expected };
}

/** Today's open windows (tasks only — instant, no calendar round-trip). */
function summarizeGaps(
  tasks: Record<string, Task>,
  settings: Pick<Settings, 'dayStartHour' | 'dayEndHour'>,
  day: DayKey
): BriefingGap[] {
  // computeFreeSlots rolls to tomorrow once today has no bookable hours left,
  // so match on the day key rather than trusting the first entry.
  const today = computeFreeSlots(tasks, settings, 1).find((d) => d.day === day);
  if (!today) return [];
  const eveningMinute = BRIEFING_EVENING_HOUR * 60;
  return today.slots.slice(0, MAX_GAPS).map((slot) => ({
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
    label: formatSlotRange(slot),
    evening: slot.endMinutes > eveningMinute,
  }));
}

function summarizeWaiting(input: BriefingInput, now: number): BriefingWaiting {
  const followUps = buildFollowUps({
    threads: input.threads,
    tasks: input.tasks,
    meta: input.meta,
    snoozedUntil: input.followUpSnoozedUntil,
    dismissed: input.followUpDismissed,
    now,
  });
  const top = followUps[0]; // buildFollowUps sorts longest-quiet first
  return {
    count: followUps.length,
    longestQuietMs: top?.quietMs ?? 0,
    topName: top?.clientName ?? null,
  };
}

function summarizeOverdue(input: BriefingInput): BriefingOverdue {
  const regulars = overdueRegulars(input.tasks, input.log, input.meta);
  const top = regulars[0]; // most overdue relative to their own rhythm
  return {
    count: regulars.length,
    topClient: top?.client ?? null,
    topOverdueDays: top?.overdueDays ?? 0,
  };
}

function summarizeOutstanding(input: BriefingInput): BriefingOutstanding {
  const owing = clientProfiles(input.tasks, input.log).filter((p) => p.outstanding > 0);
  let amount = 0;
  let topClient: string | null = null;
  let topAmount = 0;
  for (const p of owing) {
    amount += p.outstanding;
    if (p.outstanding > topAmount) {
      topAmount = p.outstanding;
      topClient = p.name;
    }
  }
  return { amount, clientCount: owing.length, topClient };
}

/** One sentence naming the day's shape — never scolding, never empty. */
function buildHeadline(meetings: BriefingMeetings, quiet: boolean): string {
  if (meetings.count === 0) {
    return quiet ? 'A clear day.' : 'No meetings booked today.';
  }
  const base = plural(meetings.count, 'meeting');
  if (meetings.nextStartMinutes != null) {
    return `${base} today, next at ${formatMinutes(meetings.nextStartMinutes)}.`;
  }
  if (meetings.done === meetings.count) return `${base} today, all wrapped.`;
  return `${base} today.`;
}

/**
 * Build the whole briefing from already-loaded store state. Pure and
 * synchronous: pass the slices in, get the summary out. Cheap enough for a
 * memo on the Today screen, but keep it memoized — the client-book and
 * rebook passes walk a year of occurrences.
 */
export function buildBriefing(input: BriefingInput): Briefing {
  const now = input.now ?? Date.now();
  const day = input.day ?? todayKey();
  const nowMinutes = minutesOfDay(new Date(now));

  const meetings = summarizeMeetings(input.tasks, day, nowMinutes);
  const gaps = summarizeGaps(input.tasks, input.settings, day);
  const waiting = summarizeWaiting(input, now);
  const overdue = summarizeOverdue(input);
  const outstanding = summarizeOutstanding(input);

  // Open windows alone never justify the card: on a genuinely free day the
  // timeline's own empty state already says so, and repeating it is noise.
  const empty =
    meetings.count === 0 &&
    waiting.count === 0 &&
    overdue.count === 0 &&
    outstanding.amount === 0;

  return {
    day,
    headline: buildHeadline(meetings, empty),
    meetings,
    gaps,
    eveningGaps: gaps.filter((g) => g.evening),
    waiting,
    overdue,
    outstanding,
    empty,
  };
}
