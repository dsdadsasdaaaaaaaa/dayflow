import { normalizePhone, type SmsCredentials } from './smsCredentials';

/**
 * Minimal Twilio Messages REST client. Everything is best-effort and typed
 * for exactly what the messenger needs: send one SMS, list recent traffic.
 * Auth is HTTP Basic with AccountSid:AuthToken (the user's own account,
 * stored in their keychain — no server of ours involved).
 */

export interface SmsMessage {
  /** Twilio message SID — stable id for dedup. */
  sid: string;
  /** The other party's number (E.164). */
  counterparty: string;
  direction: 'in' | 'out';
  body: string;
  /** Epoch ms. */
  sentAt: number;
  status: string;
  /**
   * Attached media (MMS). Absolute Twilio Media resource URLs — fetch them
   * with Basic auth (see src/lib/mediaCache.ts). Absent = no media, or the
   * media list hasn't been fetched yet (it's re-tried on the next sync).
   */
  mediaUrls?: string[];
}

interface TwilioMessageRecord {
  sid?: string;
  from?: string;
  to?: string;
  direction?: string;
  body?: string;
  date_sent?: string | null;
  date_created?: string | null;
  status?: string;
  /** Twilio returns this as a string, e.g. "0" or "2". */
  num_media?: string | null;
}

interface TwilioMediaRecord {
  sid?: string;
  /** Relative URI ending in ".json", e.g. "/2010-04-01/Accounts/.../Media/ME...json". */
  uri?: string;
  content_type?: string;
}

/** One Twilio list page: records + a relative link to the next (older) page. */
interface TwilioMessagePage {
  messages?: TwilioMessageRecord[];
  next_page_uri?: string | null;
}

/**
 * UTC calendar date ("YYYY-MM-DD") for Twilio's DateSent filters. The filter
 * is day-granular (GMT), so floors/ceilings widen to whole days — callers
 * always dedupe by SID.
 */
function isoDateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export interface ListSmsOptions {
  /**
   * Only fetch messages sent at/after this epoch ms (DateSent>= filter).
   * Day-granular — expect overlap with already-cached traffic.
   */
  sentAfterMs?: number;
  /**
   * Pages of PageSize to follow per direction via next_page_uri.
   * Default 1 = the classic newest-window behavior (no pagination).
   */
  maxPagesPerDirection?: number;
}

/** Parse Twilio's stringly-typed num_media. Defensive: bad input → 0. */
function numMediaOf(rec: TwilioMessageRecord): number {
  const n = parseInt(rec.num_media ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function baseUrl(creds: SmsCredentials): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}`;
}

function authHeader(creds: SmsCredentials): string {
  // btoa is available in React Native (Hermes) and on web.
  return 'Basic ' + btoa(`${creds.accountSid}:${creds.authToken}`);
}

function toSmsMessage(rec: TwilioMessageRecord, ownNumber: string): SmsMessage | null {
  if (!rec.sid || !rec.from || !rec.to) return null;
  const from = normalizePhone(rec.from);
  const to = normalizePhone(rec.to);
  const own = normalizePhone(ownNumber);
  const inbound = to === own;
  const counterparty = inbound ? from : to;
  if (!counterparty || counterparty === own) return null;
  const when = rec.date_sent ?? rec.date_created;
  return {
    sid: rec.sid,
    counterparty,
    direction: inbound ? 'in' : 'out',
    body: rec.body ?? '',
    sentAt: when ? Date.parse(when) : Date.now(),
    status: rec.status ?? 'unknown',
  };
}

/**
 * Fetch the media URL list for one message (Media subresource). Best-effort:
 * returns null on any failure so callers can retry on a later sync.
 */
export async function fetchMediaUrls(
  creds: SmsCredentials,
  messageSid: string
): Promise<string[] | null> {
  try {
    const res = await fetch(
      `${baseUrl(creds)}/Messages/${encodeURIComponent(messageSid)}/Media.json`,
      { headers: { Authorization: authHeader(creds) } }
    );
    if (!res.ok) {
      console.warn(`[smsApi] Media list fetch failed for ${messageSid} (${res.status})`);
      return null;
    }
    const json = (await res.json().catch(() => null)) as
      | { media_list?: TwilioMediaRecord[] }
      | null;
    const list = Array.isArray(json?.media_list) ? json.media_list : null;
    if (!list) return null;
    const urls: string[] = [];
    for (const item of list) {
      if (typeof item?.uri !== 'string' || !item.uri) continue;
      // Media item URL = https://api.twilio.com{uri with the ".json" stripped}.
      const path = item.uri.endsWith('.json') ? item.uri.slice(0, -'.json'.length) : item.uri;
      urls.push(`https://api.twilio.com${path}`);
    }
    return urls;
  } catch (e) {
    console.warn('[smsApi] Media list fetch error', e);
    return null;
  }
}

/** Send one SMS/MMS. Throws with a readable message on failure. */
export async function sendSms(
  creds: SmsCredentials,
  to: string,
  body: string,
  mediaUrls?: string[]
): Promise<SmsMessage> {
  const form = new URLSearchParams({
    From: creds.fromNumber,
    To: normalizePhone(to),
    Body: body,
  });
  // Twilio accepts repeated MediaUrl keys for multi-attachment MMS.
  for (const url of mediaUrls ?? []) {
    if (url) form.append('MediaUrl', url);
  }
  const res = await fetch(`${baseUrl(creds)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = (await res.json()) as TwilioMessageRecord & { message?: string };
  if (!res.ok) {
    throw new Error(json.message ?? `Send failed (${res.status})`);
  }
  const msg = toSmsMessage(json, creds.fromNumber);
  if (!msg) throw new Error('Send succeeded but the response was unreadable.');
  // We already know exactly which media we attached — no need to re-fetch.
  if (mediaUrls && mediaUrls.length > 0) msg.mediaUrls = [...mediaUrls];
  return msg;
}

/** Max Media.json lookups per sync — keeps sync bounded (no N+1 blowups). */
const MEDIA_FETCH_CAP = 10;

/**
 * Fetch one Messages.json URL and follow next_page_uri up to `maxPages`.
 * Only warns about hitting the cap when the caller actually asked for
 * pagination (maxPages > 1) — single-page callers expect a partial window.
 */
async function fetchMessagePages(
  creds: SmsCredentials,
  firstUrl: string,
  maxPages: number
): Promise<TwilioMessageRecord[]> {
  const records: TwilioMessageRecord[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url; page++) {
    if (page >= maxPages) {
      if (maxPages > 1) {
        console.warn(
          `[smsApi] page cap (${maxPages}) hit — remaining history left for a later fetch`
        );
      }
      break;
    }
    const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(json?.message ?? `Fetch failed (${res.status})`);
    }
    const json = (await res.json()) as TwilioMessagePage;
    const batch = json.messages ?? [];
    records.push(...batch);
    url =
      batch.length > 0 && typeof json.next_page_uri === 'string' && json.next_page_uri
        ? `https://api.twilio.com${json.next_page_uri}`
        : null;
  }
  return records;
}

/** Dedupe raw records by SID into SmsMessages + the subset still needing media. */
function mergeRecords(
  records: TwilioMessageRecord[],
  ownNumber: string,
  skipMediaSids?: ReadonlySet<string>
): { merged: SmsMessage[]; needsMedia: SmsMessage[] } {
  const seen = new Set<string>();
  const merged: SmsMessage[] = [];
  const needsMedia: SmsMessage[] = [];
  for (const rec of records) {
    const msg = toSmsMessage(rec, ownNumber);
    if (msg && !seen.has(msg.sid)) {
      seen.add(msg.sid);
      merged.push(msg);
      if (numMediaOf(rec) > 0 && !skipMediaSids?.has(msg.sid)) needsMedia.push(msg);
    }
  }
  return { merged, needsMedia };
}

/** Resolve media URLs for up to MEDIA_FETCH_CAP messages, newest first. */
async function resolveMediaFor(creds: SmsCredentials, needsMedia: SmsMessage[]): Promise<void> {
  if (needsMedia.length === 0) return;
  // Newest first so fresh photos resolve before old history.
  needsMedia.sort((a, b) => b.sentAt - a.sentAt);
  const batch = needsMedia.slice(0, MEDIA_FETCH_CAP);
  await Promise.all(
    batch.map(async (msg) => {
      const urls = await fetchMediaUrls(creds, msg.sid);
      if (urls && urls.length > 0) msg.mediaUrls = urls;
    })
  );
}

/**
 * List recent messages involving our number (both directions), newest first.
 * Twilio needs two queries (To=us and From=us); results are merged/deduped.
 *
 * Incremental mode: pass `opts.sentAfterMs` (DateSent>= floor, encoded as
 * `DateSent%3E=`) plus `opts.maxPagesPerDirection` and the call pages through
 * next_page_uri until the window is drained or the cap hits — so gaps beyond
 * one page are never silently lost.
 *
 * MMS: message records only carry a media COUNT (num_media); the URLs live in
 * a Media subresource. To stay bounded we resolve media for at most
 * MEDIA_FETCH_CAP messages per call, skipping sids in `skipMediaSids` (pass
 * the sids whose media the caller already has). Unresolved ones simply come
 * back without mediaUrls and get picked up on a later sync.
 */
export async function listRecentSms(
  creds: SmsCredentials,
  pageSize = 100,
  skipMediaSids?: ReadonlySet<string>,
  opts?: ListSmsOptions
): Promise<SmsMessage[]> {
  const own = encodeURIComponent(normalizePhone(creds.fromNumber));
  // %3E= is the URL-encoded '>=' Twilio expects in the param name.
  const floor = opts?.sentAfterMs != null ? `&DateSent%3E=${isoDateOf(opts.sentAfterMs)}` : '';
  const maxPages = opts?.maxPagesPerDirection ?? 1;
  const urls = [
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&To=${own}${floor}`,
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&From=${own}${floor}`,
  ];
  const results = await Promise.all(urls.map((u) => fetchMessagePages(creds, u, maxPages)));
  const { merged, needsMedia } = mergeRecords(results.flat(), creds.fromNumber, skipMediaSids);
  merged.sort((a, b) => b.sentAt - a.sentAt);
  await resolveMediaFor(creds, needsMedia);
  return merged;
}

/**
 * One page of history OLDER than `beforeMs` for a single counterparty, both
 * directions (Twilio supports combining To= and From= filters in one query,
 * so each direction is exactly one query). `DateSent%3C=` (encoded '<=') is
 * day-granular, so results overlap the oldest cached day — callers dedupe by
 * SID and count only genuinely new messages.
 */
export async function listOlderSms(
  creds: SmsCredentials,
  counterparty: string,
  beforeMs: number,
  pageSize = 100,
  skipMediaSids?: ReadonlySet<string>
): Promise<SmsMessage[]> {
  const own = encodeURIComponent(normalizePhone(creds.fromNumber));
  const other = encodeURIComponent(normalizePhone(counterparty));
  const ceiling = `&DateSent%3C=${isoDateOf(beforeMs)}`;
  const urls = [
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&To=${own}&From=${other}${ceiling}`,
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&From=${own}&To=${other}${ceiling}`,
  ];
  const results = await Promise.all(urls.map((u) => fetchMessagePages(creds, u, 1)));
  const { merged, needsMedia } = mergeRecords(results.flat(), creds.fromNumber, skipMediaSids);
  merged.sort((a, b) => b.sentAt - a.sentAt);
  await resolveMediaFor(creds, needsMedia);
  return merged;
}

/** Refresh one message's record (cheap — used to settle outbound status). */
export async function fetchSmsStatus(
  creds: SmsCredentials,
  sid: string
): Promise<SmsMessage | null> {
  try {
    const res = await fetch(`${baseUrl(creds)}/Messages/${encodeURIComponent(sid)}.json`, {
      headers: { Authorization: authHeader(creds) },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TwilioMessageRecord;
    const msg = toSmsMessage(json, creds.fromNumber);
    // Single message → one bounded extra call for its media, best-effort.
    if (msg && numMediaOf(json) > 0) {
      const urls = await fetchMediaUrls(creds, msg.sid);
      if (urls && urls.length > 0) msg.mediaUrls = urls;
    }
    return msg;
  } catch {
    return null;
  }
}

/** Cheap credential check: fetches the account resource. */
export async function verifySmsCredentials(creds: SmsCredentials): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(creds)}.json`, {
      headers: { Authorization: authHeader(creds) },
    });
    return res.ok;
  } catch {
    return false;
  }
}
