/**
 * The local functions the secretary may call.
 *
 * Every tool reads the LIVE stores on device and returns ONLY structural,
 * pseudonymized data: labels instead of names, counts, day keys, minutes and
 * amounts. No real name, phone number, address, note or message body is ever
 * put in a tool result — that is the whole point of the feature.
 *
 * Nothing here mutates anything. The secretary observes and suggests; the
 * user does the booking and the texting.
 */

import { moneyStats } from '../components/stats/compute';
import {
  clientNameForPhone,
  clientNameForTelegram,
  effectiveStatus,
  isPhoneBlocked,
  isTelegramBlocked,
  useClientMeta,
  type ClientStatus,
} from '../store/clientMeta';
import { useMeetingSession } from '../store/meetingSession';
import { buildThreads, useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { instancesForDay, useTasks } from '../store/tasks';
import { buildTelegramThreads, useTelegram } from '../store/telegramAccount';
import type { DayKey } from '../types';
import { computeFreeSlotsWithCalendar, formatSlotRange } from './availability';
import { addDays, daysBetween, lastNDays, todayKey } from './dates';
import {
  bookedClientKeys,
  needsFollowUp,
  type FollowUpChannel,
  type FollowUpOptions,
} from './followUps';
import type { ToolRunner, ToolSpec } from './gemini';
import { clientProfiles, knownClients, meetingOccurrences } from './meetings';
import { overdueRegulars } from './rebook';
import { assertNoPii, type PseudonymMap } from './secretaryPrivacy';

/** History window for rhythm math (matches src/lib/rebook.ts). */
const RHYTHM_WINDOW_DAYS = 365;
/** Gaps beyond this are a lapse, not a rhythm (matches src/lib/rebook.ts). */
const MAX_GAP_DAYS = 90;
/** Cap on rows in any one tool result — keeps requests small and cheap. */
const MAX_ROWS = 40;

/** ISO day key shape, for validating a model-supplied date. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------- declarations

/**
 * What the model is told it can call. Descriptions double as the model's
 * only documentation, so they say plainly that names are labels.
 */
export const SECRETARY_TOOLS: ToolSpec[] = [
  {
    name: 'list_clients',
    description:
      'List every client with their booking rhythm and money position. Clients are identified by pseudonymous labels only. Returns meetings completed, days since last seen, median gap between meetings, typical rate, outstanding balance and pipeline status.',
  },
  {
    name: 'find_rebook_candidates',
    description:
      'Regular clients who are overdue against their own booking rhythm and have nothing on the books. Use this to answer "who should I reach out to". Returns the label, days since last meeting, their median gap and how many days overdue they are.',
    parameters: {
      type: 'object',
      properties: {
        forDate: {
          type: 'string',
          description:
            'Optional day of interest as YYYY-MM-DD. Rhythm is always measured from today; this is echoed back for context only.',
        },
      },
    },
  },
  {
    name: 'get_availability',
    description:
      'Free bookable windows over the next N days, already excluding meetings, tasks and calendar events. Times are minutes from midnight.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'How many days ahead to look, 1 to 14. Defaults to 7.',
        },
      },
    },
  },
  {
    name: 'get_unanswered',
    description:
      'Loose ends in the inbox. "waitingOnYou" = the client sent the last message and is owed a reply. "goneQuiet" = the user sent the last message over a day ago and got nothing back, and the client has nothing booked. Each row has a label, the channel and hours waiting. Message contents are never available.',
  },
  {
    name: 'get_money_summary',
    description:
      'Money position: earned this calendar month, lifetime earnings, total outstanding (completed meetings not yet paid) and the top clients by lifetime value.',
  },
  {
    name: 'get_schedule',
    description:
      'The meetings booked on one day. Times are minutes from midnight (540 = 9:00 AM).',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'The day as YYYY-MM-DD. Defaults to today.',
        },
      },
      required: ['date'],
    },
  },
];

// ----------------------------------------------------------------- helpers

/** Median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Round to one decimal — tool results never need more precision than this. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Every client name the app knows: meeting history first (most recently
 * used), then contacts that only exist in the CRM (leads with no bookings
 * yet). Used to seed the session pseudonym map so redaction covers all of
 * them, not just the ones with tasks.
 */
export function collectClientNames(): string[] {
  const tasks = useTasks.getState().tasks;
  const meta = useClientMeta.getState().meta;
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    names.push(trimmed);
  };
  for (const name of knownClients(tasks)) push(name);
  for (const [key, m] of Object.entries(meta)) push(m.displayName ?? key);
  return names;
}

/**
 * Median gap in days between consecutive completed meeting days, per client
 * (keyed lowercase). Same shape of math as the rebook radar, computed here
 * for every client rather than only the overdue ones.
 */
function rhythmByClient(): Map<string, number> {
  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const today = todayKey();
  const days = lastNDays(RHYTHM_WINDOW_DAYS + 1);

  const daysByClient = new Map<string, Set<DayKey>>();
  const add = (client: string, day: DayKey) => {
    const key = client.trim().toLowerCase();
    if (!key || day > today) return;
    const set = daysByClient.get(key) ?? new Set<DayKey>();
    set.add(day);
    daysByClient.set(key, set);
  };
  for (const o of meetingOccurrences(tasks, days)) {
    if (o.completed) add(o.client, o.dateKey);
  }
  for (const e of log) add(e.client, e.dateKey);

  const out = new Map<string, number>();
  for (const [key, set] of daysByClient) {
    const sorted = [...set].sort();
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1], sorted[i]);
      if (gap > 0 && gap <= MAX_GAP_DAYS) gaps.push(gap);
    }
    if (gaps.length > 0) out.set(key, Math.round(median(gaps)));
  }
  return out;
}

/** Total outstanding across every client (completed but unpaid, less deposits). */
function outstandingByClient(): Map<string, number> {
  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const out = new Map<string, number>();
  for (const p of clientProfiles(tasks, log)) {
    out.set(p.name.trim().toLowerCase(), p.outstanding);
  }
  return out;
}

/** A day key the model supplied, or today when it sent something unusable. */
function coerceDay(value: unknown): DayKey {
  if (typeof value !== 'string') return todayKey();
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'today') return todayKey();
  if (trimmed === 'tomorrow') return addDays(todayKey(), 1);
  if (trimmed === 'yesterday') return addDays(todayKey(), -1);
  return DAY_KEY_RE.test(trimmed) ? (trimmed as DayKey) : todayKey();
}

/** A bounded day count the model supplied. */
function coerceDays(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

// ------------------------------------------------------------------- tools

interface ClientRow {
  label: string;
  meetingsDone: number;
  /** Whole days since their last completed meeting; null when never seen. */
  lastSeenDaysAgo: number | null;
  /** Their own rhythm; null when there isn't enough history to have one. */
  medianGapDays: number | null;
  typicalRate: number;
  outstanding: number;
  status: ClientStatus;
}

function toolListClients(map: PseudonymMap): { clients: ClientRow[] } {
  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const meta = useClientMeta.getState().meta;
  const today = todayKey();
  const rhythm = rhythmByClient();

  const clients = clientProfiles(tasks, log)
    .slice(0, MAX_ROWS)
    .map((p) => ({
      label: map.toPseudo(p.name),
      meetingsDone: p.meetingsDone,
      lastSeenDaysAgo: p.lastSeen ? daysBetween(p.lastSeen, today) : null,
      medianGapDays: rhythm.get(p.name.trim().toLowerCase()) ?? null,
      typicalRate: p.rate,
      outstanding: p.outstanding,
      status: effectiveStatus(meta, p.name, p.meetingsDone > 0),
    }));
  return { clients };
}

interface RebookRow {
  label: string;
  lastSeenDaysAgo: number;
  medianGapDays: number;
  overdueDays: number;
}

function toolFindRebookCandidates(
  map: PseudonymMap,
  args: Record<string, unknown>
): { forDate: DayKey; candidates: RebookRow[] } {
  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const meta = useClientMeta.getState().meta;
  const today = todayKey();

  const candidates = overdueRegulars(tasks, log, meta)
    .slice(0, MAX_ROWS)
    .map((r) => ({
      label: map.toPseudo(r.client),
      lastSeenDaysAgo: daysBetween(r.lastSeen, today),
      medianGapDays: round1(r.medianDays),
      overdueDays: r.overdueDays,
    }));
  return { forDate: coerceDay(args.forDate), candidates };
}

interface AvailabilityDay {
  day: DayKey;
  slots: { startMinutes: number; endMinutes: number; label: string }[];
}

async function toolGetAvailability(
  args: Record<string, unknown>
): Promise<{ days: AvailabilityDay[] }> {
  const tasks = useTasks.getState().tasks;
  const settings = useSettings.getState().settings;
  const days = coerceDays(args.days, 7, 14);
  const perDay = await computeFreeSlotsWithCalendar(tasks, settings, days);
  return {
    days: perDay.map((d) => ({
      day: d.day,
      slots: d.slots.map((s) => ({
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        label: formatSlotRange(s),
      })),
    })),
  };
}

interface UnansweredRow {
  label: string;
  channel: FollowUpChannel;
  hoursWaiting: number;
  /** Pipeline stage when the thread is linked to a contact. */
  status: ClientStatus | 'unknown';
}

interface UnansweredResult {
  /** They spoke last — the user owes a reply. */
  waitingOnYou: UnansweredRow[];
  /** The user spoke last and it has gone quiet — a nudge may be due. */
  goneQuiet: UnansweredRow[];
}

/**
 * Both halves of "who is hanging": threads where the client spoke last (the
 * user owes a reply) and threads where the user's own message went quiet.
 * The quiet side reuses the pure predicate from src/lib/followUps.ts, minus
 * its snooze/dismiss state — those live in a screen-owned store, and the
 * secretary reports the raw picture rather than the user's triage of it.
 * Message contents are never read: only direction and timestamp.
 */
function toolGetUnanswered(map: PseudonymMap): UnansweredResult {
  const tasks = useTasks.getState().tasks;
  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(tasks);
  const now = Date.now();
  const opts: FollowUpOptions = {
    meta,
    tasks,
    now,
    clientNames: displayNames,
    bookedClients: bookedClientKeys(tasks),
  };
  const waitingOnYou: UnansweredRow[] = [];
  const goneQuiet: UnansweredRow[] = [];

  const consider = (
    counterparty: string,
    channel: FollowUpChannel,
    lastMessage: { direction: 'in' | 'out'; sentAt: number },
    client: string | null,
    blocked: boolean
  ) => {
    const row: UnansweredRow = {
      // Unlinked numbers get a label of their own so the model can still
      // talk about them; restoreText puts the number back on device.
      label: map.toPseudo(client ?? counterparty),
      channel,
      hoursWaiting: round1((now - lastMessage.sentAt) / 3_600_000),
      status: client ? effectiveStatus(meta, client, true) : 'unknown',
    };
    if (lastMessage.direction === 'in') {
      if (!blocked) waitingOnYou.push(row);
      return;
    }
    if (needsFollowUp({ counterparty, channel, lastMessage }, opts)) goneQuiet.push(row);
  };

  const messages = useMessages.getState();
  for (const t of buildThreads(messages.messages, messages.lastReadAt)) {
    consider(
      t.counterparty,
      'sms',
      t.lastMessage,
      clientNameForPhone(meta, t.counterparty, displayNames),
      isPhoneBlocked(meta, t.counterparty)
    );
  }

  const telegram = useTelegram.getState();
  for (const t of buildTelegramThreads(telegram)) {
    consider(
      t.counterparty,
      'telegram',
      t.lastMessage,
      clientNameForTelegram(meta, t.counterparty, displayNames),
      isTelegramBlocked(meta, t.counterparty)
    );
  }

  const byWait = (a: UnansweredRow, b: UnansweredRow) => b.hoursWaiting - a.hoursWaiting;
  return {
    waitingOnYou: waitingOnYou.sort(byWait).slice(0, MAX_ROWS),
    goneQuiet: goneQuiet.sort(byWait).slice(0, MAX_ROWS),
  };
}

interface MoneySummary {
  currency: string;
  earnedThisMonth: number;
  earnedLifetime: number;
  meetingsLifetime: number;
  outstandingTotal: number;
  topClients: { label: string; earned: number; meetings: number }[];
}

function toolGetMoneySummary(map: PseudonymMap): MoneySummary {
  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const settings = useSettings.getState().settings;
  const stats = moneyStats(tasks, log);
  let outstandingTotal = 0;
  for (const amount of outstandingByClient().values()) outstandingTotal += amount;

  return {
    currency: settings.currencySymbol,
    earnedThisMonth: stats.monthEarned,
    earnedLifetime: stats.earned,
    meetingsLifetime: stats.meetings,
    outstandingTotal,
    topClients: stats.clients.slice(0, 8).map((c) => ({
      label: map.toPseudo(c.client),
      earned: c.earned,
      meetings: c.meetings,
    })),
  };
}

interface ScheduleRow {
  label: string;
  startMinutes: number;
  durationMinutes: number;
}

function toolGetSchedule(
  map: PseudonymMap,
  args: Record<string, unknown>
): { date: DayKey; meetings: ScheduleRow[] } {
  const tasks = useTasks.getState().tasks;
  const date = coerceDay(args.date);
  const meetings = instancesForDay(tasks, date)
    .filter((i) => !!i.task.meeting)
    .map((i) => ({
      label: map.toPseudo(i.task.meeting?.client ?? ''),
      startMinutes: i.task.allDay ? 0 : (i.task.startMinutes ?? 0),
      durationMinutes: i.task.allDay ? 24 * 60 : i.task.durationMinutes,
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
  return { date, meetings };
}

// ------------------------------------------------------------------ runner

/**
 * Bind the tools to one session's pseudonym map. Every result is checked
 * with assertNoPii before it goes back to the model — in __DEV__ a leak is a
 * loud crash rather than a quiet privacy bug.
 */
export function buildToolRunner(map: PseudonymMap): ToolRunner {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    let result: unknown;
    switch (name) {
      case 'list_clients':
        result = toolListClients(map);
        break;
      case 'find_rebook_candidates':
        result = toolFindRebookCandidates(map, args);
        break;
      case 'get_availability':
        result = await toolGetAvailability(args);
        break;
      case 'get_unanswered':
        result = toolGetUnanswered(map);
        break;
      case 'get_money_summary':
        result = toolGetMoneySummary(map);
        break;
      case 'get_schedule':
        result = toolGetSchedule(map, args);
        break;
      default:
        return { error: `Unknown tool "${name}".` };
    }
    assertNoPii(result, map);
    return result;
  };
}
