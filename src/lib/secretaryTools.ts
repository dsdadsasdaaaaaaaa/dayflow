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
import { buildCallRows, useCalls } from '../store/calls';
import {
  clientMetaKey,
  clientNameForPhone,
  clientNameForTelegram,
  effectiveStatus,
  isPhoneBlocked,
  isTelegramBlocked,
  useClientMeta,
  type ClientStatus,
} from '../store/clientMeta';
import { useMeetingSession } from '../store/meetingSession';
import { buildThreads, threadMessages, useMessages } from '../store/messages';
import { useSettings } from '../store/settings';
import { instancesForDay, useTasks } from '../store/tasks';
import { buildTelegramThreads, useTelegram } from '../store/telegramAccount';
import type { DayKey } from '../types';
import { computeFreeSlotsWithCalendar, formatSlotRange } from './availability';
import { addDays, daysBetween, fromDayKey, lastNDays, toDayKey, todayKey } from './dates';
import {
  bookedClientKeys,
  needsFollowUp,
  type FollowUpChannel,
  type FollowUpOptions,
} from './followUps';
import type { ToolRunner, ToolSpec } from './secretaryPrompt';
import { clientProfiles, knownClients, meetingOccurrences } from './meetings';
import { overdueRegulars } from './rebook';
import { assertNoPii, redactText, type PseudonymMap } from './secretaryPrivacy';

/** History window for rhythm math (matches src/lib/rebook.ts). */
const RHYTHM_WINDOW_DAYS = 365;
/** Gaps beyond this are a lapse, not a rhythm (matches src/lib/rebook.ts). */
const MAX_GAP_DAYS = 90;
/** Cap on rows in any one tool result — keeps requests small and cheap. */
const MAX_ROWS = 40;

/** ISO day key shape, for validating a model-supplied date. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Longest message body a proposed draft may carry. */
const MAX_DRAFT_CHARS = 600;
/** Longest note text handed back for one client. */
const MAX_NOTE_CHARS = 1200;
/** Per-message cap when the assistant is allowed to read conversations. */
const MAX_BODY_CHARS = 400;

/** One message as the assistant sees it: who, how long ago, what it said. */
interface ConversationRow {
  /**
   * Who wrote this one: the client's label, or "you" for the user. Spelled
   * out rather than a direction flag, because a flag is easy to lose while
   * summarizing and the result is the user's own words quoted back at them
   * as though the client had said them.
   */
  speaker: string;
  hoursAgo: number;
  text: string;
}
/** Messages returned per get_conversation call. */
const DEFAULT_CONVERSATION_LIMIT = 20;
const MAX_CONVERSATION_LIMIT = 50;

// -------------------------------------------------------------- proposals

/**
 * Something the secretary wants done that only the USER may actually do.
 *
 * The model never sends a message and never books anything. The write tools
 * push one of these into a per-request sink; the store maps the label back to
 * a real name and the chat shows it as a card with a button. Nothing happens
 * until the user taps it.
 */
export interface SecretaryAction {
  kind: 'draft' | 'booking';
  /** Pseudonymous label as the model gave it ("Client 3"). */
  label: string;
  /** Real name, filled in on-device by the store before display. */
  client?: string;
  /** kind 'draft': the suggested message body. */
  text?: string;
  /** kind 'booking': YYYY-MM-DD. */
  date?: string;
  /** kind 'booking': minutes from midnight, and length in minutes. */
  startMinutes?: number;
  durationMinutes?: number;
}

// ------------------------------------------------------------- declarations

/**
 * What the model is told it can call. Descriptions double as the model's
 * only documentation, so they say plainly that names are labels.
 */
const READ_TOOLS: ToolSpec[] = [
  {
    name: 'list_clients',
    description:
      'List every client with their booking rhythm and money position. Clients are identified by pseudonymous labels only. Returns meetings completed, days since last seen, median gap between meetings, typical rate, outstanding balance, and status. Status is one of: "client" (an established regular), "lead" (enquired, never booked), or "blocked" (the user deliberately cut this person off). NEVER suggest contacting, drafting to, or booking anyone whose status is "blocked", and do not include them in lists of people to reach out to. If the user asks about them directly, answer, but say plainly that they are blocked.',
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
      'Loose ends in the inbox. "waitingOnYou" = the client sent the last message and is owed a reply. "goneQuiet" = the user sent the last message over a day ago and got nothing back, and the client has nothing booked. Each row has a label, the channel, hours waiting, and status ("client", "lead", or "blocked" — never suggest contacting a blocked person). When the user allows message reading, each row also carries "lastText" (what that last message said) and "lastFrom" (who wrote it: the client label, or "you"). Check lastFrom before describing a message — attributing the user\'s own words to the client makes the suggestion nonsense.',
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
  {
    name: 'get_call_history',
    description:
      'Recent phone calls and voicemails, newest first. Each row is one call: the client label (a number that belongs to nobody in the book still gets its own label), whether it came in or went out, whether it was missed, the local time it happened, and whether a voicemail was left. Recordings and transcripts are never available.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'How far back to look, 1 to 90. Defaults to 14.',
        },
      },
    },
  },
  {
    name: 'get_no_shows',
    description:
      'Clients who have failed to turn up for a booked meeting: their label, how many times it has happened and the most recent date. Only clients with at least one no-show appear, so an empty list means nobody has ever missed one. Worth checking before you suggest giving someone a prime slot.',
  },
  {
    name: 'get_client_detail',
    description:
      'Everything the app knows about ONE client, by label: meetings completed, their own median gap between meetings, when they were last seen, their usual rate, lifetime earnings, what they still owe, no-shows, their next booking, their status, whether they are currently waiting on a reply, and a "patterns" block describing how this person actually behaves: the weekday they usually book, their usual start time and length, the kind of meeting they choose, whether their rate is rising or falling, whether they are booking closer together or drifting apart, and what share of their bookings they actually keep. Any of those is null when their history is too thin to support it, and null means unknown, never zero or "no preference". Status is \"client\", \"lead\", or \"blocked\"; a blocked person was cut off deliberately, so never draft to them or suggest booking them. Use it before drafting a message so what you write actually fits them.',
    parameters: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description: 'The client label exactly as another tool gave it, e.g. "Client 3".',
        },
      },
      required: ['client'],
    },
  },
];

/**
 * Only offered when the user has switched notes on in Settings. A tool the
 * model cannot see is a promise it cannot break — much stronger than a tool
 * that is present and refuses.
 */
const NOTES_TOOL: ToolSpec = {
  name: 'get_client_notes',
  description:
    "The user's own private notes about one client, by label. The user has explicitly allowed you to read these. Any name, phone number or email inside a note is still replaced with a label or hidden. Notes are personal and often blunt: use them to answer the question at hand, never quote them back wholesale.",
  parameters: {
    type: 'object',
    properties: {
      client: {
        type: 'string',
        description: 'The client label exactly as another tool gave it, e.g. "Client 3".',
      },
    },
    required: ['client'],
  },
};

/**
 * Only offered when the user has switched message reading on. Same principle
 * as the notes tool: a tool the model cannot see is a promise it cannot
 * break, which is stronger than a tool that is present and refuses.
 */
const CONVERSATION_TOOL: ToolSpec = {
  name: 'get_conversation',
  description:
    "The actual back-and-forth with one client, newest last, by label. The user has explicitly allowed you to read their messages. Names, phone numbers and emails inside the text are still replaced with labels or hidden. Every row names its speaker: the client label for their messages, or the word you for the ones the user sent. Check it on every row. Half of any thread was written by the user, so crediting the client with what the user wrote, or the reverse, produces confident nonsense. Use this to understand what was actually said — what they asked for, what they agreed to, why they went quiet — instead of guessing from timing alone. Quote at most a short phrase back; summarize rather than reciting.",
  parameters: {
    type: 'object',
    properties: {
      client: {
        type: 'string',
        description: 'The client label exactly as another tool gave it, e.g. "Client 3".',
      },
      limit: {
        type: 'integer',
        description: `How many recent messages to read (default ${DEFAULT_CONVERSATION_LIMIT}, max ${MAX_CONVERSATION_LIMIT}).`,
      },
    },
    required: ['client'],
  },
};

/**
 * The whole-inbox pair, offered alongside get_conversation whenever message
 * reading is on. get_conversation answers about one person; these answer
 * across everyone, which is the difference between "why did Client 3 go
 * quiet" and "who is asking about this weekend".
 */
const INBOX_TOOLS: ToolSpec[] = [
  {
    name: 'search_messages',
    description:
      'Search every conversation on the phone for a word or phrase, across SMS and Telegram, both directions. Returns the matching messages newest first, each with the client label, their status (a blocked person can still appear in results, so check before suggesting anything), the speaker (the client label, or the word you for messages the user sent) and how long ago it was. Use this for questions about who said something rather than about one person: who asked about a particular day, who mentioned a price, who never got an answer to a question. Much cheaper and sharper than reading whole threads.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Word or phrase to look for. Case insensitive, matched as a substring.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'scan_conversations',
    description:
      'Recent messages from EVERY conversation at once, newest threads first, each row naming its speaker. Use it to build a picture across all clients at the same time: who is mid-negotiation, who is waiting on something, what people are asking for lately, which enquiries were never closed. Prefer search_messages when you already know the phrase you are looking for. The result reports how many conversations it had to leave out; if it left any out, say so rather than implying you saw everything.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'How far back to look, in days. Defaults to 30, maximum 365.',
        },
      },
    },
  },
];

/**
 * The two tools that produce something rather than report something. Both
 * only PREPARE: the user reviews and confirms on device. The descriptions say
 * so plainly, because the model's own wording is what the user reads.
 */
const WRITE_TOOLS: ToolSpec[] = [
  {
    name: 'draft_message',
    description:
      'Prepare a message to a client FOR THE USER TO REVIEW. This does NOT send anything: it puts a draft on screen with a send button the user has to tap, and they can edit or discard it. Write the whole body yourself in the user\'s voice: short, warm, plain sentences, no emoji, no dashes for punctuation. Refer to the person by their label only. Never say the message was sent, only that a draft is waiting for them.',
    parameters: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description: 'The client label exactly as another tool gave it, e.g. "Client 3".',
        },
        text: {
          type: 'string',
          description: 'The message body to propose, at most a few sentences.',
        },
      },
      required: ['client', 'text'],
    },
  },
  {
    name: 'propose_booking',
    description:
      'Prepare a booking FOR THE USER TO CONFIRM. This does NOT put anything in the calendar: it offers a card the user has to tap to accept. Call get_availability first so the slot you name is genuinely free. Never say a meeting is booked or confirmed, only that you have suggested it.',
    parameters: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          description: 'The client label exactly as another tool gave it, e.g. "Client 3".',
        },
        date: {
          type: 'string',
          description: 'The day as YYYY-MM-DD.',
        },
        start_minutes: {
          type: 'integer',
          description: 'Start time as minutes from midnight (540 = 9:00 AM).',
        },
        duration_minutes: {
          type: 'integer',
          description: 'Length in minutes. Defaults to 60 when unsure.',
        },
      },
      required: ['client', 'date', 'start_minutes', 'duration_minutes'],
    },
  },
];

/**
 * The tool list for one request. Both extras are ABSENT rather than refusing
 * when their setting is off — the model cannot call what it was never shown.
 */
export function secretaryTools(
  usesNotes: boolean,
  readsMessages = false
): ToolSpec[] {
  return [
    ...READ_TOOLS,
    ...(usesNotes ? [NOTES_TOOL] : []),
    ...(readsMessages ? [CONVERSATION_TOOL, ...INBOX_TOOLS] : []),
    ...WRITE_TOOLS,
  ];
}

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

  // Named clients first, sorted, so their labels do not renumber every time
  // a new conversation arrives. The map is rebuilt on every request and the
  // whole history is re-redacted through it, so an unstable order would mean
  // "Client 3" quietly becoming a different person mid-conversation.
  for (const name of [...knownClients(tasks)].sort()) push(name);
  for (const key of Object.keys(meta).sort()) push(meta[key].displayName ?? key);

  // Then every counterparty we have ever exchanged messages with, including
  // people with no client record at all. Without these, a prospect who is
  // only a phone number has no label: the redactor falls back to blanking
  // anything phone-shaped, so on the next turn the assistant sees its own
  // earlier answer with "(number hidden)" where the person used to be, and
  // loses track of exactly the people it was asked to suggest.
  const sms = useMessages.getState();
  for (const t of buildThreads(sms.messages, sms.lastReadAt)
    .map((t) => t.counterparty)
    .sort()) {
    push(t);
  }
  const tg = useTelegram.getState();
  for (const t of buildTelegramThreads(tg)
    .map((t) => t.counterparty)
    .sort()) {
    push(t);
  }
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
  /**
   * What the last message actually said, when the user allows message
   * reading. Carried here rather than left to a follow-up get_conversation
   * call: knowing someone went quiet is not useful on its own, and a model
   * handed only labels and hours will answer from labels and hours.
   */
  lastText?: string;
  /**
   * Who wrote lastText — the client's label, or "you". Without this the model
   * has a quote and no author, and attributing the user's own words to the
   * client turns a follow-up suggestion into nonsense.
   */
  lastFrom?: string;
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
 * Message text rides along as `lastText` when the user allows reading;
 * otherwise only direction and timestamp are used.
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

  const readsMessages = useSettings.getState().settings.secretaryReadsMessages;

  const consider = (
    counterparty: string,
    channel: FollowUpChannel,
    lastMessage: { direction: 'in' | 'out'; sentAt: number; body?: string },
    client: string | null,
    blocked: boolean
  ) => {
    const body = readsMessages ? (lastMessage.body ?? '').trim() : '';
    const row: UnansweredRow = {
      // Unlinked numbers get a label of their own so the model can still
      // talk about them; restoreText puts the number back on device.
      label: map.toPseudo(client ?? counterparty),
      channel,
      hoursWaiting: round1((now - lastMessage.sentAt) / 3_600_000),
      status: client ? effectiveStatus(meta, client, true) : 'unknown',
      ...(body
        ? {
            lastText: redactText(body, map).slice(0, MAX_BODY_CHARS),
            lastFrom:
              lastMessage.direction === 'in' ? map.toPseudo(client ?? counterparty) : 'you',
          }
        : {}),
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

// -------------------------------------------------- calls, no-shows, detail

/** Local wall-clock stamp, "YYYY-MM-DDTHH:mm" — the model has no timezone. */
function localStamp(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${toDayKey(d)}T${hh}:${mm}`;
}

/** The client behind a phone number, or null when nothing is linked. */
function clientForNumber(number: string): string | null {
  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(useTasks.getState().tasks);
  return clientNameForPhone(meta, number, displayNames);
}

interface CallHistoryRow {
  label: string;
  direction: 'in' | 'out';
  missed: boolean;
  /** Local time, "YYYY-MM-DDTHH:mm". */
  atISO: string;
  hadVoicemail: boolean;
}

/**
 * The call log, pseudonymized. Unlinked numbers get a label of their own
 * rather than being dropped — "someone called three times and never booked"
 * is exactly the kind of thing worth surfacing. The number itself never
 * leaves: only its label does.
 */
function toolGetCallHistory(
  map: PseudonymMap,
  args: Record<string, unknown>
): { days: number; calls: CallHistoryRow[] } {
  const days = coerceDays(args.days, 14, 90);
  const since = Date.now() - days * 24 * 60 * 60_000;
  const calls = buildCallRows(useCalls.getState())
    .filter((c) => c.startedAt >= since)
    .slice(0, MAX_ROWS)
    .map((c) => ({
      label: map.toPseudo(clientForNumber(c.counterparty) ?? c.counterparty),
      direction: c.direction,
      missed: c.missed,
      atISO: localStamp(c.startedAt),
      hadVoicemail: !!c.voicemail,
    }));
  return { days, calls };
}

interface NoShowTally {
  name: string;
  count: number;
  last: DayKey;
}

/**
 * No-shows per client (keyed lowercase). Days are de-duplicated across tasks,
 * so a client with two series that both missed the same day counts once.
 */
function noShowsByClient(): Map<string, NoShowTally> {
  const tasks = useTasks.getState().tasks;
  const collected = new Map<string, { name: string; days: Set<DayKey> }>();
  for (const task of Object.values(tasks)) {
    const meeting = task.meeting;
    if (!meeting || !meeting.client.trim() || !meeting.noShows?.length) continue;
    const name = meeting.client.trim();
    const key = name.toLowerCase();
    const entry = collected.get(key) ?? { name, days: new Set<DayKey>() };
    for (const day of meeting.noShows) entry.days.add(day);
    collected.set(key, entry);
  }

  const out = new Map<string, NoShowTally>();
  for (const [key, entry] of collected) {
    const sorted = [...entry.days].sort();
    if (sorted.length === 0) continue;
    out.set(key, { name: entry.name, count: sorted.length, last: sorted[sorted.length - 1] });
  }
  return out;
}

interface NoShowRow {
  label: string;
  noShows: number;
  lastNoShowDate: DayKey;
}

function toolGetNoShows(map: PseudonymMap): { clients: NoShowRow[] } {
  const clients = [...noShowsByClient().values()]
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : -1))
    .slice(0, MAX_ROWS)
    .map((t) => ({
      label: map.toPseudo(t.name),
      noShows: t.count,
      lastNoShowDate: t.last,
    }));
  return { clients };
}

/** An unanswered inbound message on either channel, longest wait first. */
function unansweredForClient(
  real: string
): { channel: FollowUpChannel; hoursWaiting: number } | null {
  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(useTasks.getState().tasks);
  const key = clientMetaKey(real);
  const now = Date.now();
  const hits: { channel: FollowUpChannel; hoursWaiting: number }[] = [];

  const consider = (
    channel: FollowUpChannel,
    client: string | null,
    lastMessage: { direction: 'in' | 'out'; sentAt: number }
  ) => {
    if (!client || clientMetaKey(client) !== key) return;
    if (lastMessage.direction !== 'in') return;
    hits.push({ channel, hoursWaiting: round1((now - lastMessage.sentAt) / 3_600_000) });
  };

  const messages = useMessages.getState();
  for (const t of buildThreads(messages.messages, messages.lastReadAt)) {
    consider('sms', clientNameForPhone(meta, t.counterparty, displayNames), t.lastMessage);
  }
  const telegram = useTelegram.getState();
  for (const t of buildTelegramThreads(telegram)) {
    consider(
      'telegram',
      clientNameForTelegram(meta, t.counterparty, displayNames),
      t.lastMessage
    );
  }

  hits.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
  return hits[0] ?? null;
}

interface ClientDetail {
  label: string;
  status: ClientStatus;
  meetingsDone: number;
  /** Their own rhythm; null when there isn't enough history to have one. */
  medianGapDays: number | null;
  lastSeen: DayKey | null;
  lastSeenDaysAgo: number | null;
  typicalRate: number;
  earnedLifetime: number;
  outstanding: number;
  noShows: number;
  lastNoShowDate: DayKey | null;
  nextBooking: DayKey | null;
  /** Set when they sent the last message and are owed a reply. */
  unanswered: { channel: FollowUpChannel; hoursWaiting: number } | null;
  /**
   * How this particular client actually behaves, rather than what the book
   * says about them. Counts and totals describe a client; these describe the
   * person, which is what a suggestion has to fit — proposing Tuesday
   * mornings to someone who has only ever come on Friday evenings is
   * technically informed and practically useless.
   */
  patterns: ClientPatterns | null;
}

interface ClientPatterns {
  /** Weekday they book most often, when there is a clear favourite. */
  usualDay: string | null;
  /** Their typical start, as minutes from midnight. */
  usualStartMinutes: number | null;
  usualDurationMinutes: number | null;
  /** in-call, out-call or public — whichever they choose most. */
  usualKind: string | null;
  /** How the agreed amount has moved: 'rising', 'falling' or 'steady'. */
  rateTrend: 'rising' | 'falling' | 'steady' | null;
  /** Whether they are booking closer together or drifting apart. */
  cadenceTrend: 'quickening' | 'steady' | 'slowing' | null;
  /** Completed against booked, as a percentage. */
  showRate: number | null;
}


/** How far back a client's habits are read from. */
const PATTERN_WINDOW_DAYS = 365;

/** Most common value, when one is clearly ahead of the rest. */
function modeOf<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestN = 0;
  let tied = false;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  // A tie is not a habit; reporting one as a preference invents a pattern.
  return tied && counts.size > 1 ? null : best;
}

/** Direction of travel between the older half and the recent half. */
function trendOf(values: number[], tolerance = 0.12): 'rising' | 'falling' | 'steady' | null {
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const older = values.slice(0, half);
  const recent = values.slice(half);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = mean(older);
  const b = mean(recent);
  if (a === 0) return null;
  const change = (b - a) / a;
  if (change > tolerance) return 'rising';
  if (change < -tolerance) return 'falling';
  return 'steady';
}

/**
 * What this client actually does, from their own completed meetings.
 *
 * Everything here is derived rather than remembered: there is nothing to
 * keep up to date and nothing to go stale. Each field returns null rather
 * than a guess when the history is too thin to support it — a "usual day"
 * drawn from two meetings is noise wearing the costume of insight.
 */
function patternsFor(client: string): ClientPatterns | null {
  const tasks = useTasks.getState().tasks;
  // A year is enough to see a habit without letting one ancient booking
  // define a client who has since changed how they book.
  const all = meetingOccurrences(tasks, lastNDays(PATTERN_WINDOW_DAYS))
    .filter((o) => o.client === client)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const done = all.filter((o) => o.completed);
  if (done.length < 3) return null;

  const days = done
    .map((o) => fromDayKey(o.dateKey).toLocaleDateString('en-US', { weekday: 'long' }))
    .filter(Boolean);
  const starts = done
    .map((o) => o.task.startMinutes)
    .filter((m): m is number => typeof m === 'number');
  const durations = done
    .map((o) => o.task.durationMinutes)
    .filter((m): m is number => typeof m === 'number' && m > 0);
  const rates = done.map((o) => o.rate).filter((r) => r > 0);

  // Gaps between consecutive meetings, oldest first, so the trend reads in
  // the direction time runs.
  const gaps: number[] = [];
  for (let i = 1; i < done.length; i++) {
    gaps.push(daysBetween(done[i - 1].dateKey, done[i].dateKey));
  }
  const gapTrend = trendOf(gaps, 0.2);

  const booked = all.filter((o) => o.dateKey <= todayKey()).length;

  return {
    usualDay: modeOf(days),
    usualStartMinutes: starts.length >= 3 ? Math.round(median(starts)) : null,
    usualDurationMinutes: durations.length >= 3 ? Math.round(median(durations)) : null,
    usualKind: modeOf(done.map((o) => String(o.kind))),
    rateTrend: trendOf(rates),
    // A widening gap means they are cooling off, which is the opposite sense
    // to the number rising, so this is deliberately inverted.
    cadenceTrend:
      gapTrend == null
        ? null
        : gapTrend === 'rising'
          ? 'slowing'
          : gapTrend === 'falling'
            ? 'quickening'
            : 'steady',
    showRate: booked > 0 ? Math.round((done.length / booked) * 100) : null,
  };
}

/**
 * One client's whole picture, by label. A label the map doesn't know is a
 * hallucination — say so rather than guessing at a neighbour.
 */
function toolGetClientDetail(
  map: PseudonymMap,
  args: Record<string, unknown>
): ClientDetail | { error: string } {
  const asked = typeof args.client === 'string' ? args.client.trim() : '';
  const real = asked ? map.toReal(asked) : null;
  if (!real) {
    return {
      error:
        'That is not one of the client labels from the other tools. Call list_clients and use a label exactly as it appears there.',
    };
  }

  const tasks = useTasks.getState().tasks;
  const log = useMeetingSession.getState().log;
  const meta = useClientMeta.getState().meta;
  const today = todayKey();
  const key = real.trim().toLowerCase();

  const profile = clientProfiles(tasks, log).find((p) => p.name.trim().toLowerCase() === key);
  const noShow = noShowsByClient().get(key) ?? null;
  const meetingsDone = profile?.meetingsDone ?? 0;

  return {
    label: map.toPseudo(real),
    status: effectiveStatus(meta, real, meetingsDone > 0),
    meetingsDone,
    medianGapDays: rhythmByClient().get(key) ?? null,
    lastSeen: profile?.lastSeen ?? null,
    lastSeenDaysAgo: profile?.lastSeen ? daysBetween(profile.lastSeen, today) : null,
    typicalRate: profile?.rate ?? 0,
    earnedLifetime: profile?.earned ?? 0,
    outstanding: profile?.outstanding ?? 0,
    noShows: noShow?.count ?? 0,
    lastNoShowDate: noShow?.last ?? null,
    nextBooking: profile?.nextMeeting ?? null,
    unanswered: unansweredForClient(real),
    patterns: patternsFor(real),
  };
}

/**
 * The user's private notes on one client — only reachable when they switched
 * it on (the tool isn't even declared otherwise, and the runner checks the
 * setting again). The note is scrubbed on the way out: any real name in the
 * session map becomes its label, numbers and emails are blanked.
 */
function toolGetClientNotes(
  map: PseudonymMap,
  args: Record<string, unknown>
): { label: string; notes: string } | { error: string } {
  if (!useSettings.getState().settings.secretaryUsesNotes) {
    return { error: 'The user has not allowed notes to be read.' };
  }
  const asked = typeof args.client === 'string' ? args.client.trim() : '';
  const real = asked ? map.toReal(asked) : null;
  if (!real) {
    return {
      error:
        'That is not one of the client labels from the other tools. Call list_clients and use a label exactly as it appears there.',
    };
  }
  const notes = useClientMeta.getState().meta[clientMetaKey(real)]?.notes ?? '';
  return {
    label: map.toPseudo(real),
    notes: redactText(notes.trim(), map).slice(0, MAX_NOTE_CHARS),
  };
}

/**
 * The real conversation with one client, scrubbed on the way out.
 *
 * Only reachable when the user switched message reading on: the tool is not
 * declared otherwise, and this checks the setting again so a stale tool
 * definition in an in-flight request cannot slip through.
 *
 * A label may stand for a named client OR for a bare counterparty we never
 * linked, so both are resolved. Bodies keep their real wording — that is the
 * point of the feature — but every name in the session map becomes its label
 * and phone numbers and emails are blanked, so the model reads what was said
 * without learning who said it.
 */
function toolGetConversation(
  map: PseudonymMap,
  args: Record<string, unknown>
):
  | { label: string; channel: FollowUpChannel; messages: ConversationRow[] }
  | { error: string } {
  if (!useSettings.getState().settings.secretaryReadsMessages) {
    return { error: 'The user has not allowed messages to be read.' };
  }
  const asked = typeof args.client === 'string' ? args.client.trim() : '';
  const real = asked ? map.toReal(asked) : null;
  if (!real) {
    return {
      error:
        'That is not one of the client labels from the other tools. Call list_clients or get_unanswered and use a label exactly as it appears there.',
    };
  }
  const rawLimit = typeof args.limit === 'number' ? args.limit : DEFAULT_CONVERSATION_LIMIT;
  const limit = Math.min(Math.max(Math.floor(rawLimit) || DEFAULT_CONVERSATION_LIMIT, 1), MAX_CONVERSATION_LIMIT);

  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(useTasks.getState().tasks);
  const now = Date.now();

  const label = map.toPseudo(real);
  const row = (direction: 'in' | 'out', sentAt: number, body: string): ConversationRow => ({
    speaker: direction === 'in' ? label : 'you',
    hoursAgo: round1((now - sentAt) / 3_600_000),
    text: redactText(body.trim(), map).slice(0, MAX_BODY_CHARS),
  });

  // SMS first: match the thread whose counterparty resolves to this client,
  // or whose bare number IS the label when they were never linked.
  const messagesState = useMessages.getState();
  for (const t of buildThreads(messagesState.messages, messagesState.lastReadAt)) {
    const named = clientNameForPhone(meta, t.counterparty, displayNames);
    if (named !== real && t.counterparty !== real) continue;
    const rows = threadMessages(messagesState.messages, t.counterparty, messagesState.hiddenSids)
      .slice(-limit)
      .map((m) => row(m.direction, m.sentAt, m.body ?? ''))
      .filter((r) => r.text.length > 0);
    return { label, channel: 'sms', messages: rows };
  }

  // Then Telegram, keyed by chat id rather than a number.
  const tg = useTelegram.getState();
  for (const t of buildTelegramThreads(tg)) {
    const named = clientNameForTelegram(meta, t.counterparty, displayNames);
    if (named !== real && t.counterparty !== real) continue;
    const rows = Object.values(tg.messages)
      .filter((m) => m.counterparty === t.counterparty)
      .sort((a, b) => a.sentAt - b.sentAt)
      .slice(-limit)
      .map((m) => row(m.direction, m.sentAt, m.body ?? ''))
      .filter((r) => r.text.length > 0);
    return { label, channel: 'telegram', messages: rows };
  }

  return { error: 'No conversation on this phone for that label.' };
}

/** Caps for the whole-inbox tools. Bulk reading is useful; unbounded is not. */
const MAX_SCAN_THREADS = 40;
const MAX_SCAN_PER_THREAD = 8;
const MAX_SEARCH_HITS = 40;
const SCAN_DEFAULT_DAYS = 30;

/** One conversation, flattened, with everything the tools need to describe it. */
interface WalkedThread {
  counterparty: string;
  label: string;
  channel: FollowUpChannel;
  status: ClientStatus | 'unknown';
  /** Oldest first. */
  messages: { direction: 'in' | 'out'; sentAt: number; body: string }[];
}

/**
 * Every conversation on the phone, both channels, in one shape.
 *
 * Threads are keyed by counterparty — a phone number for SMS, a chat id for
 * Telegram — so a conversation with nobody in the client book is walked the
 * same as an established regular. The label is the client's when we know it
 * and a minted label over the raw number when we do not, which is what lets
 * the model talk about a stranger without ever being handed the number.
 */
function walkAllThreads(map: PseudonymMap): WalkedThread[] {
  const meta = useClientMeta.getState().meta;
  const displayNames = knownClients(useTasks.getState().tasks);
  const out: WalkedThread[] = [];

  const sms = useMessages.getState();
  for (const t of buildThreads(sms.messages, sms.lastReadAt)) {
    const client = clientNameForPhone(meta, t.counterparty, displayNames);
    out.push({
      counterparty: t.counterparty,
      label: map.toPseudo(client ?? t.counterparty),
      channel: 'sms',
      status: client ? effectiveStatus(meta, client, true) : 'unknown',
      messages: threadMessages(sms.messages, t.counterparty, sms.hiddenSids).map((m) => ({
        direction: m.direction,
        sentAt: m.sentAt,
        body: m.body ?? '',
      })),
    });
  }

  const tg = useTelegram.getState();
  const tgByThread = new Map<string, { direction: 'in' | 'out'; sentAt: number; body: string }[]>();
  for (const m of Object.values(tg.messages)) {
    const list = tgByThread.get(m.counterparty);
    const row = { direction: m.direction, sentAt: m.sentAt, body: m.body ?? '' };
    if (list) list.push(row);
    else tgByThread.set(m.counterparty, [row]);
  }
  for (const t of buildTelegramThreads(tg)) {
    const client = clientNameForTelegram(meta, t.counterparty, displayNames);
    out.push({
      counterparty: t.counterparty,
      label: map.toPseudo(client ?? t.counterparty),
      channel: 'telegram',
      status: client ? effectiveStatus(meta, client, true) : 'unknown',
      messages: (tgByThread.get(t.counterparty) ?? []).sort((a, b) => a.sentAt - b.sentAt),
    });
  }

  // Busiest-recent first, so a hard cap keeps the conversations that matter.
  return out.sort((a, b) => {
    const aLast = a.messages[a.messages.length - 1]?.sentAt ?? 0;
    const bLast = b.messages[b.messages.length - 1]?.sentAt ?? 0;
    return bLast - aLast;
  });
}

/**
 * Recent traffic across EVERY conversation at once, so the model can answer
 * questions that span clients ("who is asking about this weekend", "is anyone
 * still waiting on a price") instead of only ones aimed at a single thread.
 *
 * Deliberately capped on three axes — age, threads, messages per thread —
 * and it reports what it dropped. A tool that silently truncates reads as
 * "this is everything" and produces confidently incomplete answers.
 */
function toolScanConversations(
  map: PseudonymMap,
  args: Record<string, unknown>
):
  | {
      threads: {
        label: string;
        channel: FollowUpChannel;
        status: ClientStatus | 'unknown';
        messages: ConversationRow[];
      }[];
      threadsShown: number;
      threadsTotal: number;
      note?: string;
    }
  | { error: string } {
  if (!useSettings.getState().settings.secretaryReadsMessages) {
    return { error: 'The user has not allowed messages to be read.' };
  }
  const days =
    typeof args.days === 'number' && args.days > 0
      ? Math.min(Math.floor(args.days), 365)
      : SCAN_DEFAULT_DAYS;
  const now = Date.now();
  const floor = now - days * 24 * 3_600_000;

  const all = walkAllThreads(map);
  const threads = [];
  for (const t of all) {
    const recent = t.messages.filter((m) => m.sentAt >= floor);
    if (recent.length === 0) continue;
    threads.push({
      label: t.label,
      channel: t.channel,
      status: t.status,
      messages: recent.slice(-MAX_SCAN_PER_THREAD).map((m) => ({
        speaker: m.direction === 'in' ? t.label : 'you',
        hoursAgo: round1((now - m.sentAt) / 3_600_000),
        text: redactText(m.body.trim(), map).slice(0, MAX_BODY_CHARS),
      })),
    });
    if (threads.length >= MAX_SCAN_THREADS) break;
  }

  const total = all.filter((t) => t.messages.some((m) => m.sentAt >= floor)).length;
  return {
    threads,
    threadsShown: threads.length,
    threadsTotal: total,
    ...(total > threads.length
      ? {
          note: `Only the ${threads.length} most recently active of ${total} conversations are shown, and at most ${MAX_SCAN_PER_THREAD} messages each. Say so if the answer might depend on the rest.`,
        }
      : {}),
  };
}

/**
 * Find a phrase across every conversation. Cheaper and sharper than scanning
 * when the question is "who mentioned X" — the model gets only the matching
 * lines, with enough around them to know who said it and when.
 */
function toolSearchMessages(
  map: PseudonymMap,
  args: Record<string, unknown>
):
  | {
      query: string;
      hits: (ConversationRow & { label: string; status: ClientStatus | 'unknown' })[];
      note?: string;
    }
  | { error: string } {
  if (!useSettings.getState().settings.secretaryReadsMessages) {
    return { error: 'The user has not allowed messages to be read.' };
  }
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (query.length < 2) {
    return { error: 'Give a word or phrase of at least two characters to search for.' };
  }
  const needle = query.toLowerCase();
  const now = Date.now();

  // Collect everything first, THEN rank and cut. Capping during the walk let
  // whichever thread came first spend the whole budget, so a search across
  // the inbox could return one chatty client and silently omit the rest —
  // the opposite of what searching every conversation is for.
  const found: (ConversationRow & {
    label: string;
    status: ClientStatus | 'unknown';
    at: number;
  })[] = [];
  for (const t of walkAllThreads(map)) {
    for (const m of t.messages) {
      if (!m.body.toLowerCase().includes(needle)) continue;
      found.push({
        label: t.label,
        // Carried so a hit on someone blocked cannot be read as a lead to
        // chase: search answers "who said this", including people the user
        // has cut off, and the model has to be able to tell them apart.
        status: t.status,
        speaker: m.direction === 'in' ? t.label : 'you',
        hoursAgo: round1((now - m.sentAt) / 3_600_000),
        text: redactText(m.body.trim(), map).slice(0, MAX_BODY_CHARS),
        at: m.sentAt,
      });
    }
  }
  found.sort((a, b) => b.at - a.at);
  const more = Math.max(0, found.length - MAX_SEARCH_HITS);
  const hits = found.slice(0, MAX_SEARCH_HITS).map(({ at: _at, ...row }) => row);

  return {
    query,
    hits,
    ...(more > 0
      ? { note: `${more} further matches were not returned. Narrow the search if that matters.` }
      : {}),
  };
}

/**
 * Bounds for the always-on inbox digest.
 *
 * Depth follows recency rather than being flat. A conversation from this
 * morning is worth reading; one from six weeks ago is worth KNOWING ABOUT,
 * and quoting four of its messages spends the budget that would otherwise
 * have covered ten other people. Tiering this way roughly triples how many
 * clients fit in the same space.
 */
const DIGEST_TIERS = [
  { withinDays: 3, messages: 5, label: 'active' },
  { withinDays: 14, messages: 3, label: 'recent' },
  { withinDays: 30, messages: 1, label: 'cooling' },
] as const;

/** Beyond the last tier: named and summarized, but never quoted. */
const DIGEST_DORMANT_DAYS = 240;
const DIGEST_MAX_THREADS = 60;
const DIGEST_BODY_CHARS = 170;

const DAY_MS = 24 * 3_600_000;

/**
 * Automated traffic: carrier notices, shortcodes, one-way robotexts.
 *
 * A number that is not dialable and that the user has never once replied to
 * is not a conversation. Importing a phone's history drags in a lot of it,
 * and every line spent quoting "Welcome to Lucky Mobile" is a line not spent
 * on a client. Any reply at all disqualifies a thread from this, since
 * replying is the clearest possible signal that a human is on the far end.
 */
function looksAutomated(t: WalkedThread): boolean {
  const digits = t.counterparty.replace(/\D/g, '');
  const dialable = t.counterparty.startsWith('+') && digits.length >= 10;
  if (dialable) return false;
  return !t.messages.some((m) => m.direction === 'out');
}

/** "3 hours" / "6 days" / "7 weeks" — a length, not a timestamp. */
function quietFor(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hours`;
  const days = Math.round(hours / 24);
  if (days < 21) return `${days} days`;
  return `${Math.round(days / 7)} weeks`;
}

/**
 * Where today stands, in one line.
 *
 * Almost every question is really about now — who to fit in, whether there
 * is room, what is already booked — and answering that used to cost a tool
 * call before the assistant could even orient itself. It is two lines of
 * text and it removes a round trip from the common case.
 */
function todayLine(map: PseudonymMap): string {
  const today = todayKey();
  const tasks = useTasks.getState().tasks;
  const meetings = instancesForDay(tasks, today)
    .filter((i) => i.task.meeting?.client)
    .sort((a, b) => (a.task.startMinutes ?? 0) - (b.task.startMinutes ?? 0));

  const done = meetings.filter((m) => m.completed).length;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const next = meetings.find(
    (m) => !m.completed && (m.task.startMinutes ?? 0) >= nowMinutes
  );

  const parts = [`TODAY is ${today}.`];
  if (meetings.length === 0) {
    parts.push('Nothing booked today.');
  } else {
    parts.push(
      `${meetings.length} meeting${meetings.length === 1 ? '' : 's'} booked, ${done} done.`
    );
    if (next?.task.meeting?.client) {
      const label = map.toPseudo(next.task.meeting!.client);
      parts.push(
        `Next is ${label} at ${next.task.startMinutes ?? 0} minutes past midnight.`
      );
    }
  }
  return parts.join(' ');
}

/**
 * A compact picture of the whole inbox, handed over before the user has
 * asked anything.
 *
 * The tools can already reach every conversation, but a model only calls a
 * tool when it realizes it should, so "who should I chase" got answered from
 * whatever the first tool returned. This puts a baseline in front of it every
 * time, so it starts from what is actually going on rather than from nothing.
 *
 * Deliberately shallower than scan_conversations: this rides along with every
 * question, so it is a map to reason from and a prompt to go read properly,
 * never a replacement for reading.
 */
export function buildInboxDigest(map: PseudonymMap): string | null {
  if (!useSettings.getState().settings.secretaryReadsMessages) return null;
  const now = Date.now();

  const quoted: string[] = [];
  const dormant: string[] = [];
  let shown = 0;
  let omitted = 0;

  let filtered = 0;
  for (const t of walkAllThreads(map)) {
    const last = t.messages[t.messages.length - 1];
    if (!last) continue;
    const age = now - last.sentAt;
    if (age > DIGEST_DORMANT_DAYS * DAY_MS) continue;
    // Blocked people are excluded outright: the assistant must not act on
    // them, so spending the standing budget on them buys nothing.
    if (t.status === 'blocked' || looksAutomated(t)) {
      filtered++;
      continue;
    }

    if (shown >= DIGEST_MAX_THREADS) {
      omitted++;
      continue;
    }
    shown++;

    const tier = DIGEST_TIERS.find((x) => age <= x.withinDays * DAY_MS);
    const head = `${t.label} (${t.status}, ${t.channel})`;

    if (!tier) {
      // Dormant: who they are and where it was left, in one line. Enough to
      // notice they exist and go looking; not enough to spend a budget on.
      const who = last.direction === 'in' ? 'they' : 'you';
      dormant.push(`${head}: quiet ${quietFor(age)}, ${who} spoke last`);
      continue;
    }

    quoted.push(`${head} — ${tier.label}:`);
    for (const m of t.messages.slice(-tier.messages)) {
      const speaker = m.direction === 'in' ? t.label : 'you';
      const text = redactText(m.body.trim(), map).slice(0, DIGEST_BODY_CHARS);
      if (text) {
        quoted.push(`  ${speaker} (${quietFor(now - m.sentAt)} ago): ${text}`);
      }
    }
  }

  if (quoted.length === 0 && dormant.length === 0) return null;

  const lines = [...quoted];
  if (dormant.length > 0) {
    lines.push('', 'Quiet for over a month, not quoted:');
    lines.push(...dormant.map((d) => `  ${d}`));
  }

  return [
    todayLine(map),
    'CURRENT INBOX (loaded automatically, not something the user typed).',
    `Recent conversations in more detail, older ones in less: up to ${DIGEST_TIERS[0].messages} messages for anything from the last ${DIGEST_TIERS[0].withinDays} days, fewer as they get older, and a single summary line past a month. Each quoted line names who wrote it: a client label, or "you" for the user.`,
    omitted > 0
      ? `${omitted} further conversations did not fit — use scan_conversations or search_messages if the answer may involve them.`
      : 'This covers every conversation with any activity in the past few months.',
    filtered > 0
      ? `${filtered} more were left out as blocked contacts or automated senders. They are still reachable through search_messages if a question genuinely needs them.`
      : '',
    'Use it as your starting picture. Before asserting anything, or drafting, read the actual thread with get_conversation — especially for anyone summarized without quotes.',
    '',
    ...lines,
  ].join('\n');
}

// ------------------------------------------------------------- proposals

/** What a write tool tells the model: prepared, never done. */
interface ProposalResult {
  proposed: boolean;
  error?: string;
}

/** Minutes from midnight the model supplied, or null when unusable. */
function coerceStartMinutes(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 0 && rounded <= 1439 ? rounded : null;
}

/** A sane meeting length from whatever the model sent. */
function coerceDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 60;
  return Math.min(24 * 60, Math.max(5, Math.round(n)));
}

/**
 * Queue a message for the user to read, edit and send. Nothing is sent here
 * and nothing can be: this file has no messaging import at all.
 */
function toolDraftMessage(
  sink: SecretaryAction[],
  args: Record<string, unknown>
): ProposalResult {
  const label = typeof args.client === 'string' ? args.client.trim() : '';
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!label || !text) {
    return { proposed: false, error: 'A draft needs both a client label and the message text.' };
  }
  sink.push({ kind: 'draft', label, text: text.slice(0, MAX_DRAFT_CHARS) });
  return { proposed: true };
}

/** Queue a booking for the user to confirm. Nothing reaches the calendar. */
function toolProposeBooking(
  sink: SecretaryAction[],
  args: Record<string, unknown>
): ProposalResult {
  const label = typeof args.client === 'string' ? args.client.trim() : '';
  if (!label) {
    return { proposed: false, error: 'A booking needs a client label.' };
  }
  const startMinutes = coerceStartMinutes(args.start_minutes ?? args.startMinutes);
  if (startMinutes == null) {
    return {
      proposed: false,
      error: 'start_minutes must be minutes from midnight, 0 to 1439 (540 = 9:00 AM).',
    };
  }
  sink.push({
    kind: 'booking',
    label,
    date: coerceDay(args.date),
    startMinutes,
    durationMinutes: coerceDuration(args.duration_minutes ?? args.durationMinutes),
  });
  return { proposed: true };
}

// ------------------------------------------------------------------ runner

/**
 * Bind the tools to one session's pseudonym map and one request's proposal
 * sink. Every result is checked with assertNoPii before it goes back to the
 * model — in __DEV__ a leak is a loud crash rather than a quiet privacy bug.
 *
 * `sink` is a fresh array per request: the write tools push proposals into it
 * and the store attaches them to the assistant's turn. The model only ever
 * learns that something was prepared.
 */
export function buildToolRunner(map: PseudonymMap, sink: SecretaryAction[]): ToolRunner {
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
      case 'get_call_history':
        result = toolGetCallHistory(map, args);
        break;
      case 'get_no_shows':
        result = toolGetNoShows(map);
        break;
      case 'get_client_detail':
        result = toolGetClientDetail(map, args);
        break;
      case 'get_client_notes':
        result = toolGetClientNotes(map, args);
        break;
      case 'get_conversation':
        result = toolGetConversation(map, args);
        break;
      case 'search_messages':
        result = toolSearchMessages(map, args);
        break;
      case 'scan_conversations':
        result = toolScanConversations(map, args);
        break;
      case 'draft_message':
        result = toolDraftMessage(sink, args);
        break;
      case 'propose_booking':
        result = toolProposeBooking(sink, args);
        break;
      default:
        return { error: `Unknown tool "${name}".` };
    }
    assertNoPii(result, map);
    return result;
  };
}
