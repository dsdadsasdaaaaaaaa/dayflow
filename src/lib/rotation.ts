import { clientNameForPhone, isPhoneBlocked, type ClientMeta } from '../store/clientMeta';
import type { SmsMessage } from './smsApi';
import { normalizePhone } from './smsCredentials';

/**
 * Number rotation. Retiring a work number and moving to a fresh one is a
 * deliberate, recurring practice here, not an accident to recover from: a
 * line that changes on a schedule is standard for discreet work and limits
 * what any single number can be tied back to.
 *
 * The awkward part is purely social. Everyone who knows us still has the
 * retired number saved, so until they hear from the new one, an unexplained
 * message is easy to ignore or report. This module answers the one question
 * that matters right after a rotation: who has not heard from the new number
 * yet, and in what order should they.
 *
 * Nothing here sends. It builds a worklist the user taps through by hand.
 * That restraint is not only about consent: firing the same text at everyone
 * inside a few minutes from a brand new number is the single most reliable
 * way to get that number filtered too, which is what rotation is meant to
 * escape. See ROTATION_PACING_MS.
 */

/**
 * Spacing to aim for between announcements. Carriers score a new number on
 * its first outbound burst, and identical text fanned out to many strangers
 * in one sitting is the exact signature of the spam they filter. Spreading
 * the announcements out keeps the new number's opening pattern looking like
 * a person texting people back.
 */
export const ROTATION_PACING_MS = 90_000;

/** Announcements to send in one sitting before taking a real break. */
export const ROTATION_BATCH_SIZE = 8;

const DAY_MS = 24 * 60 * 60_000;

/** How far back a contact still counts as worth re-reaching after a rotation. */
const STALE_AFTER_DAYS = 180;

export interface RotationEntry {
  /** E.164 counterparty. */
  number: string;
  /** Client name when we know it, else a formatted number. */
  name: string;
  /** Their most recent message either way, for ordering and display. */
  lastAt: number;
  /** True when they have written to us since the rotation and we owe a reply. */
  waiting: boolean;
  /** Which retired number they last reached us on, when we can tell. */
  lastKnownOwn?: string;
}

export interface RotationRosterOptions {
  messages: Record<string, SmsMessage>;
  meta: Record<string, ClientMeta>;
  /** The number now in use. Contacts already texted from it are done. */
  currentNumber: string;
  hiddenSids?: Record<string, true>;
  /** knownClients(tasks) — the display names a phone can resolve against. */
  clientNames: string[];
  now?: number;
  staleAfterDays?: number;
}

/**
 * Everyone who still has an old number for us: threads with real history,
 * where nothing outbound has yet gone out from the current number.
 *
 * Ordered so the tapping order is also the sensible order. People actively
 * mid-conversation come first (they may be waiting on a reply and will read
 * the explainer as a normal message rather than a cold text from a stranger),
 * then everyone else by recency. Blocked contacts are left out entirely.
 */
export function buildRotationRoster(opts: RotationRosterOptions): RotationEntry[] {
  const {
    messages,
    meta,
    hiddenSids,
    clientNames,
    now = Date.now(),
    staleAfterDays = STALE_AFTER_DAYS,
  } = opts;
  const current = normalizePhone(opts.currentNumber);
  if (!current) return [];

  const cutoff = now - staleAfterDays * DAY_MS;

  /** Fold the flat message map into per-counterparty facts in one pass. */
  interface Acc {
    lastAt: number;
    lastDirection: 'in' | 'out';
    sentFromCurrent: boolean;
    lastKnownOwn?: string;
  }
  const byThread = new Map<string, Acc>();

  for (const m of Object.values(messages)) {
    if (hiddenSids?.[m.sid]) continue;
    const key = m.counterparty;
    if (!key) continue;
    const acc = byThread.get(key);
    const fromCurrent = m.direction === 'out' && normalizePhone(m.ownNumber ?? '') === current;
    if (!acc) {
      byThread.set(key, {
        lastAt: m.sentAt,
        lastDirection: m.direction,
        sentFromCurrent: fromCurrent,
        lastKnownOwn: m.ownNumber,
      });
      continue;
    }
    if (fromCurrent) acc.sentFromCurrent = true;
    if (m.sentAt >= acc.lastAt) {
      acc.lastAt = m.sentAt;
      acc.lastDirection = m.direction;
      if (m.ownNumber) acc.lastKnownOwn = m.ownNumber;
    }
  }

  const out: RotationEntry[] = [];
  for (const [number, acc] of byThread) {
    // Already reached from the new number: they have it, nothing to do.
    if (acc.sentFromCurrent) continue;
    // Long-dormant contacts are not worth handing a live number to.
    if (acc.lastAt < cutoff) continue;
    if (isPhoneBlocked(meta, number)) continue;
    out.push({
      number,
      name: clientNameForPhone(meta, number, clientNames) ?? number,
      lastAt: acc.lastAt,
      waiting: acc.lastDirection === 'in',
      lastKnownOwn: acc.lastKnownOwn,
    });
  }

  return out.sort((a, b) => {
    // Someone mid-conversation reads the explainer as a reply, not a cold
    // text, so they are both the kindest and the safest to send first.
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1;
    return b.lastAt - a.lastAt;
  });
}

/**
 * Slight wording variation per contact. Carrier spam filters weight large
 * runs of byte-identical outbound, so rotating between a few honest phrasings
 * of the same message measurably helps a new number survive its first day.
 * Index by position in the roster, not at random, so a redraw is stable.
 */
export function rotationNoticeFor(index: number, waiting: boolean): string {
  const openers = [
    "Hey, it's Drew!",
    "Hi, Drew here.",
    "Hey, Drew again.",
  ];
  const bodies = [
    'I rotate my number every so often, it keeps things private for both of us.',
    'I change numbers now and then for privacy, mine and yours.',
    'I switch numbers periodically, it keeps things discreet on both ends.',
  ];
  const closers = [
    'This is my current one, so save it and delete the old one. Same me, nothing else changes.',
    'Save this one over the old one. Everything else is exactly the same.',
    'Worth saving this one and clearing the old. Nothing else changes on my end.',
  ];
  const lead = waiting ? 'Sorry for the wait, ' : '';
  const opener = openers[index % openers.length];
  const head = lead ? lead + opener.charAt(0).toLowerCase() + opener.slice(1) : opener;
  return [head, bodies[index % bodies.length], closers[index % closers.length]].join(' ');
}

/** "3 left" / "all caught up" for the roster header. */
export function rotationProgressLabel(remaining: number, total: number): string {
  if (total === 0) return 'Nobody needs the new number';
  if (remaining === 0) return 'Everyone has the new number';
  const done = total - remaining;
  return `${done} of ${total} told`;
}
