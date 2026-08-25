import {
  clientNameForPhone,
  clientNameForTelegram,
  isPhoneBlocked,
  isTelegramBlocked,
  type ClientMeta,
} from '../store/clientMeta';
import type { Task } from '../types';
import { addDays, todayKey } from './dates';
import { knownClients, meetingOccurrences } from './meetings';

/**
 * Follow-ups: threads where OUR last message went unanswered. An unreplied
 * lead is lost revenue, so they surface as a "Waiting" list and an in-thread
 * nudge bar. Nothing here ever sends: it only ever seeds a draft the user
 * reads, edits and sends by hand (automated nudges get numbers carrier-flagged).
 */

/** Quiet stretch before an unanswered outbound counts as a loose end. */
export const DEFAULT_QUIET_AFTER_MS = 24 * 60 * 60_000;

/** "Snooze" length offered in the thread bar. */
export const FOLLOW_UP_SNOOZE_MS = 3 * 24 * 60 * 60_000;

/** How far ahead a booking counts as "they already booked, leave them alone". */
const BOOKED_WINDOW_DAYS = 60;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Hours are readable up to two days; past that, days. */
const DAYS_AFTER_MS = 48 * HOUR_MS;

export type FollowUpChannel = 'sms' | 'telegram';

/**
 * Structural thread shape — SMS Threads (store/messages) and Telegram threads
 * (store/telegramAccount) both satisfy it, so one pass covers both channels.
 */
export interface FollowUpThread {
  counterparty: string;
  channel: FollowUpChannel;
  lastMessage: { direction: 'in' | 'out'; sentAt: number };
}

export interface FollowUpOptions {
  meta: Record<string, ClientMeta>;
  tasks: Record<string, Task>;
  /** Quiet threshold (default 24h). */
  quietAfterMs?: number;
  /** Clock injection — defaults to Date.now(). */
  now?: number;
  /** Precomputed knownClients(tasks); pass it when looping many threads. */
  clientNames?: string[];
  /** Precomputed bookedClientKeys(tasks); pass it when looping many threads. */
  bookedClients?: Set<string>;
}

/** One thread gone quiet, ready to nudge. */
export interface FollowUp {
  counterparty: string;
  channel: FollowUpChannel;
  /** Linked client display name, or null for an unknown counterparty. */
  clientName: string | null;
  /** When our unanswered message was sent (epoch ms). */
  lastOutboundAt: number;
  /** How long it has gone unanswered (ms). */
  quietMs: number;
}

export interface FollowUpState {
  threads: FollowUpThread[];
  tasks: Record<string, Task>;
  meta: Record<string, ClientMeta>;
  /** counterparty → epoch ms the follow-up stays hidden until. */
  snoozedUntil: Record<string, number>;
  /** counterparty → the user said this one needs nothing. */
  dismissed: Record<string, true>;
  quietAfterMs?: number;
  now?: number;
  /** Precomputed knownClients(tasks) — memoize it on `tasks` in screens. */
  clientNames?: string[];
  /** Precomputed bookedClientKeys(tasks) — memoize it on `tasks` in screens. */
  bookedClients?: Set<string>;
}

/**
 * Lowercased names of clients with a booking still ahead (today's unfinished
 * meeting counts, matching thread.tsx's nextBooking window). Someone who went
 * quiet because they are already on the calendar is NOT a loose end.
 */
export function bookedClientKeys(tasks: Record<string, Task>): Set<string> {
  const today = todayKey();
  const days = Array.from({ length: BOOKED_WINDOW_DAYS + 1 }, (_, i) => addDays(today, i));
  const out = new Set<string>();
  for (const o of meetingOccurrences(tasks, days)) {
    if (o.completed) continue;
    const key = o.client.trim().toLowerCase();
    if (key) out.add(key);
  }
  return out;
}

/** Client display name linked to this counterparty, or null. */
function linkedClientName(thread: FollowUpThread, opts: FollowUpOptions): string | null {
  const names = opts.clientNames ?? knownClients(opts.tasks);
  return thread.channel === 'telegram'
    ? clientNameForTelegram(opts.meta, thread.counterparty, names)
    : clientNameForPhone(opts.meta, thread.counterparty, names);
}

/**
 * Is this thread waiting on them? True when OUR message is the last one, it
 * has been quiet past the threshold, the counterparty isn't blocked, and the
 * linked client has nothing booked. Unknown/unlinked numbers still qualify —
 * an unanswered stranger is exactly the lead worth chasing.
 */
export function needsFollowUp(thread: FollowUpThread, opts: FollowUpOptions): boolean {
  const now = opts.now ?? Date.now();
  const quietAfterMs = opts.quietAfterMs ?? DEFAULT_QUIET_AFTER_MS;
  const last = thread.lastMessage;
  if (last.direction !== 'out') return false;
  if (now - last.sentAt < quietAfterMs) return false;

  const blocked =
    thread.channel === 'telegram'
      ? isTelegramBlocked(opts.meta, thread.counterparty)
      : isPhoneBlocked(opts.meta, thread.counterparty);
  if (blocked) return false;

  const name = linkedClientName(thread, opts);
  if (!name) return true;
  const booked = opts.bookedClients ?? bookedClientKeys(opts.tasks);
  return !booked.has(name.trim().toLowerCase());
}

/** Every thread waiting on a reply, longest-quiet first. */
export function buildFollowUps(state: FollowUpState): FollowUp[] {
  const now = state.now ?? Date.now();
  const opts: FollowUpOptions = {
    meta: state.meta,
    tasks: state.tasks,
    quietAfterMs: state.quietAfterMs,
    now,
    // Derived once for the whole pass instead of per thread.
    clientNames: state.clientNames ?? knownClients(state.tasks),
    bookedClients: state.bookedClients ?? bookedClientKeys(state.tasks),
  };

  const out: FollowUp[] = [];
  for (const thread of state.threads) {
    if (state.dismissed[thread.counterparty]) continue;
    if ((state.snoozedUntil[thread.counterparty] ?? 0) > now) continue;
    if (!needsFollowUp(thread, opts)) continue;
    out.push({
      counterparty: thread.counterparty,
      channel: thread.channel,
      clientName: linkedClientName(thread, opts),
      lastOutboundAt: thread.lastMessage.sentAt,
      quietMs: now - thread.lastMessage.sentAt,
    });
  }
  return out.sort((a, b) => b.quietMs - a.quietMs);
}

/** "3 days" / "26 hours" — the bare duration, for inline labels. */
export function formatQuietShort(ms: number): string {
  if (ms < HOUR_MS) return 'under an hour';
  if (ms < DAYS_AFTER_MS) {
    const hours = Math.round(ms / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(ms / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** "3 days, no reply" / "26 hours, no reply". */
export function formatQuiet(ms: number): string {
  return `${formatQuietShort(ms)}, no reply`;
}

/**
 * A warm, short nudge to seed the composer with. The user reads and edits it
 * before sending; nothing here is ever sent automatically.
 */
export function buildFollowUpDraft(clientName: string | null): string {
  const first = clientName?.trim().split(/\s+/)[0] ?? '';
  const greeting = first ? `Hey ${first}!` : 'Hey!';
  return `${greeting} Just circling back on this, still want to get something booked?`;
}
