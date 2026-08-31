import type { SmsMessage } from './smsApi';
import { SmsSendError } from './smsApi';
import { normalizePhone } from './smsCredentials';
import type { TelerivetCredentials } from './telerivetCredentials';

/**
 * Telerivet client — the "own SIM" messaging route.
 *
 * Why this exists alongside the Twilio client: in Canada and the US every
 * CPaaS long code is application-to-person traffic, and carriers filter it on
 * the route rather than on the content. Perfectly ordinary conversation sent
 * through Twilio is scored as machine traffic before anyone reads it, which
 * is how work numbers here keep getting burned. Switching CPaaS vendors does
 * not help; they all hand off to the same carriers under the same rules.
 *
 * Telerivet's Android app relays through a normal consumer SIM in a real
 * handset, so the messages leave over the carrier's person-to-person path.
 * There is no campaign to register and nothing to be rejected from, and a new
 * number is a new prepaid SIM rather than a re-registration.
 *
 * Output is deliberately the same SmsMessage shape the Twilio client
 * produces, so threads, dedup, follow-ups and the rest of the app do not care
 * which route a message took.
 */

const BASE = 'https://api.telerivet.com/v1';

/** Telerivet returns seconds; the rest of the app is in epoch ms. */
const SEC = 1000;

/** Telerivet's documented maximum for page_size. */
const MAX_PAGE_SIZE = 500;

/** How far back a first sync reaches when there is no high-water mark yet. */
const FIRST_SYNC_WINDOW_MS = 30 * 24 * 60 * 60_000;

interface TelerivetMedia {
  url?: string;
  type?: string;
  filename?: string;
}

interface TelerivetMessageRecord {
  id?: string;
  direction?: string;
  status?: string;
  message_type?: string;
  time_created?: number | null;
  time_sent?: number | null;
  from_number?: string | null;
  to_number?: string | null;
  content?: string | null;
  media?: TelerivetMedia[] | null;
  error_message?: string | null;
}

interface TelerivetPage {
  data?: TelerivetMessageRecord[];
  next_marker?: string | null;
}

function authHeader(creds: TelerivetCredentials): string {
  // API key is the Basic username with an empty password.
  return 'Basic ' + btoa(`${creds.apiKey}:`);
}

/**
 * Telerivet's own status vocabulary, mapped onto the Twilio-shaped strings
 * the UI already renders. Keeping one vocabulary means MessageBubble and
 * explainSmsFailure need no knowledge of which route a message took.
 */
function mapStatus(status: string | undefined, direction: 'in' | 'out'): string {
  if (direction === 'in') return 'received';
  switch (status) {
    case 'delivered':
      return 'delivered';
    case 'not_delivered':
      return 'undelivered';
    case 'failed':
    case 'failed_queued':
      return 'failed';
    case 'sent':
      return 'sent';
    case 'queued':
    default:
      return 'queued';
  }
}

/**
 * One record → the app's shared message shape. Returns null for anything
 * without an id or a usable counterparty, which would only poison dedup.
 */
function toSmsMessage(
  rec: TelerivetMessageRecord,
  creds: TelerivetCredentials
): SmsMessage | null {
  const id = rec.id;
  if (!id) return null;
  const direction: 'in' | 'out' = rec.direction === 'incoming' ? 'in' : 'out';
  const counterparty = normalizePhone(
    (direction === 'in' ? rec.from_number : rec.to_number) ?? ''
  );
  if (!counterparty) return null;

  // Ours is the other end. Telerivet does not always populate from_number on
  // outbound, so fall back to the SIM number captured at connect time.
  const ours = normalizePhone(
    (direction === 'in' ? rec.to_number : rec.from_number) ?? ''
  );

  const media = (rec.media ?? [])
    .map((m) => m?.url)
    .filter((u): u is string => typeof u === 'string' && u.length > 0);

  const at = rec.time_sent ?? rec.time_created ?? 0;

  const msg: SmsMessage = {
    sid: id,
    counterparty,
    direction,
    body: rec.content ?? '',
    sentAt: at * SEC,
    status: mapStatus(rec.status ?? undefined, direction),
    ownNumber: ours || normalizePhone(creds.fromNumber),
  };
  if (media.length > 0) {
    msg.mediaUrls = media;
    msg.numMedia = media.length;
  }
  return msg;
}

async function call(
  creds: TelerivetCredentials,
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> }
): Promise<unknown> {
  const qs = init?.query
    ? '?' +
      Object.entries(init.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const res = await fetch(`${BASE}${path}${qs}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: authHeader(creds),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const err = parsed as { error?: { message?: string; code?: string } } | null;
    const detail = err?.error?.message?.trim();
    // The daily allowance counts messages RECEIVED as well as sent, and the
    // gateway app on the phone sees every incoming text whether or not this
    // app ever asks for it. So the quota can be gone before a single photo is
    // attempted, which is baffling unless the message says so.
    const quota =
      /quota|limit|exceed/i.test(detail ?? '') || res.status === 402
        ? ' Telerivet\'s daily allowance counts messages it RECEIVES too, and the gateway app on your phone sees every incoming text. Add your clients under Ignored Phones in the Telerivet app so only photos you send count.'
        : '';
    throw new SmsSendError(
      (detail ? `${detail} (${res.status})` : `Telerivet request failed (${res.status})`) + quota
    );
  }
  return parsed;
}

/**
 * Send one message. Passing media promotes it to MMS — Telerivet fetches each
 * URL itself, so the attachment has to be publicly reachable for the moment
 * of the send (the existing Twilio Assets hosting already guarantees that,
 * and stays useful even once messaging has moved off Twilio).
 */
export async function sendTelerivet(
  creds: TelerivetCredentials,
  to: string,
  body: string,
  mediaUrls?: string[]
): Promise<SmsMessage> {
  const target = normalizePhone(to);
  if (!target) throw new SmsSendError('That number does not look valid.');

  const hasMedia = (mediaUrls?.length ?? 0) > 0;
  const payload: Record<string, unknown> = {
    to_number: target,
    content: body,
    message_type: hasMedia ? 'mms' : 'sms',
  };
  if (hasMedia) {
    payload.media = mediaUrls!.map((url) => ({ url }));
  }
  if (creds.routeId) payload.route_id = creds.routeId;

  const rec = (await call(creds, `/projects/${encodeURIComponent(creds.projectId)}/messages/send`, {
    method: 'POST',
    body: payload,
  })) as TelerivetMessageRecord | null;

  invalidateTelerivetCache();
  const mapped = rec ? toSmsMessage(rec, creds) : null;
  if (mapped) return mapped;
  // Accepted but unparseable: synthesize enough for the thread to render.
  return {
    sid: `tr-local-${Date.now()}`,
    counterparty: target,
    direction: 'out',
    body,
    sentAt: Date.now(),
    status: 'queued',
    ownNumber: normalizePhone(creds.fromNumber),
    ...(hasMedia ? { mediaUrls, numMedia: mediaUrls!.length } : {}),
  };
}

export interface TelerivetListOptions {
  /** Only messages created at or after this epoch ms. */
  sentAfterMs?: number;
  /** Only messages created at or before this epoch ms. */
  sentBeforeMs?: number;
  /** Restrict to one counterparty. */
  counterparty?: string;
  /** Continue a previous page. */
  marker?: string;
}

/**
 * Shortest gap between two identical list requests.
 *
 * Twilio is the user's own account and a wasted poll costs nothing, so the UI
 * polls an open conversation every 2.5s. Telerivet bills per API call, and
 * with both lines live that same screen was making around 48 calls a minute
 * while the user simply sat reading. This collapses repeats of the same query
 * inside the window onto one real request, so a chatty UI cannot drain the
 * account no matter how often it asks.
 */
const LIST_CACHE_MS = 6_000;

const listCache = new Map<string, { at: number; value: TelerivetPageResult }>();

/**
 * Drop the cache after we change something ourselves. Waiting out the window
 * to see a message we just sent would be a strange kind of thrift.
 */
export function invalidateTelerivetCache(): void {
  listCache.clear();
}

export interface TelerivetPageResult {
  messages: SmsMessage[];
  /** Pass back as `marker` to continue; absent when the list is exhausted. */
  nextMarker?: string;
}

/**
 * List messages newest-first. Telerivet returns both directions in one feed,
 * so unlike the Twilio client this needs no second call to merge in/out.
 */
export async function listTelerivet(
  creds: TelerivetCredentials,
  pageSize: number,
  opts: TelerivetListOptions = {}
): Promise<TelerivetPageResult> {
  // Only parameters Telerivet documents for this endpoint. sort/sort_dir were
  // carried over from a different part of their API and are not listed here;
  // an unrecognized parameter fails the request outright, which the callers
  // then reported as an empty inbox.
  const query: Record<string, string> = {
    page_size: String(Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE)),
  };
  // With no ordering parameter available, a floor is what keeps a first sync
  // from returning the oldest page of a long history instead of today's.
  const floorMs =
    opts.sentAfterMs ?? (opts.counterparty ? undefined : Date.now() - FIRST_SYNC_WINDOW_MS);
  if (floorMs != null) {
    query['time_created[min]'] = String(Math.floor(floorMs / SEC));
  }
  if (opts.sentBeforeMs != null) {
    query['time_created[max]'] = String(Math.ceil(opts.sentBeforeMs / SEC));
  }
  if (opts.marker) query.marker = opts.marker;

  const cacheKey = `${creds.projectId}:${JSON.stringify(query)}`;
  const now = Date.now();
  const hit = listCache.get(cacheKey);
  if (hit && now - hit.at < LIST_CACHE_MS) return hit.value;

  const page = (await call(
    creds,
    `/projects/${encodeURIComponent(creds.projectId)}/messages`,
    { query }
  )) as TelerivetPage | null;

  let messages = (page?.data ?? [])
    .map((r) => toSmsMessage(r, creds))
    .filter((m): m is SmsMessage => m != null);

  // Narrowing to one conversation happens here rather than in the query.
  // The server-side filter parameter was a guess, and an unrecognized
  // parameter is not ignored — it fails the whole request, which the callers
  // then swallowed as "no messages". Filtering what came back cannot be
  // wrong, and the request is being made either way.
  if (opts.counterparty) {
    const only = normalizePhone(opts.counterparty);
    if (only) messages = messages.filter((m) => m.counterparty === only);
  }

  if (opts.sentAfterMs != null) {
    messages = messages.filter((m) => m.sentAt >= opts.sentAfterMs!);
  }
  messages.sort((a, b) => b.sentAt - a.sentAt);
  const result: TelerivetPageResult = {
    messages,
    ...(page?.next_marker ? { nextMarker: page.next_marker } : {}),
  };
  listCache.set(cacheKey, { at: now, value: result });
  // Bounded: a long session with many distinct queries should not grow this
  // without limit, and anything evicted simply costs one more request.
  if (listCache.size > 64) {
    for (const k of listCache.keys()) {
      listCache.delete(k);
      if (listCache.size <= 32) break;
    }
  }
  return result;
}

/** Cheap credential check: ask for the project by id. */
export async function verifyTelerivetCredentials(
  creds: TelerivetCredentials
): Promise<boolean> {
  try {
    const project = (await call(
      creds,
      `/projects/${encodeURIComponent(creds.projectId)}`
    )) as { id?: string } | null;
    return !!project?.id;
  } catch {
    return false;
  }
}

/** Re-read one message, to settle a just-sent "queued" into its real status. */
export async function fetchTelerivetMessage(
  creds: TelerivetCredentials,
  id: string
): Promise<SmsMessage | null> {
  try {
    const rec = (await call(
      creds,
      `/projects/${encodeURIComponent(creds.projectId)}/messages/${encodeURIComponent(id)}`
    )) as TelerivetMessageRecord | null;
    return rec ? toSmsMessage(rec, creds) : null;
  } catch {
    return null;
  }
}

/**
 * Page through the project feed until `pageSize` messages are collected or
 * the feed runs out. Telerivet caps a page at 500; a busy stretch spanning
 * more than that would otherwise silently truncate.
 */
export async function listTelerivetPaged(
  creds: TelerivetCredentials,
  pageSize: number,
  opts: TelerivetListOptions = {},
  maxPages = 6
): Promise<SmsMessage[]> {
  const out: SmsMessage[] = [];
  let marker = opts.marker;
  for (let page = 0; page < maxPages; page++) {
    // Always ask for the largest page the API allows, not the caller's
    // display-sized page. Without an ordering parameter the server decides
    // the order, so the only safe assumption is that the messages we want
    // could be anywhere in the window — one big page is far likelier to
    // contain them than several small ones, and it is the same one request.
    const res = await listTelerivet(creds, MAX_PAGE_SIZE, { ...opts, marker });
    out.push(...res.messages);
    // Stop only when the feed is exhausted. Stopping once enough messages
    // had been COLLECTED was the bug: it returned after the first page, and
    // if the server orders oldest-first that page is the oldest slice of the
    // window, so newly arrived messages sat on a page never requested and
    // simply never appeared.
    if (!res.nextMarker) break;
    marker = res.nextMarker;
  }
  out.sort((a, b) => b.sentAt - a.sentAt);
  return pageSize > 0 ? out.slice(0, Math.max(pageSize, MAX_PAGE_SIZE)) : out;
}

/** One contact as Telerivet stores it. */
interface TelerivetContact {
  id?: string;
  name?: string | null;
  phone_number?: string | null;
}

/**
 * Create or update one contact. Telerivet keys contacts by phone number
 * within a project, so sending the same number twice updates rather than
 * duplicating — which makes this safe to re-run.
 */
export async function upsertTelerivetContact(
  creds: TelerivetCredentials,
  phoneNumber: string,
  name?: string
): Promise<boolean> {
  const number = normalizePhone(phoneNumber);
  if (!number) return false;
  try {
    const rec = (await call(
      creds,
      `/projects/${encodeURIComponent(creds.projectId)}/contacts`,
      {
        method: 'POST',
        body: { phone_number: number, ...(name ? { name } : {}) },
      }
    )) as TelerivetContact | null;
    return !!rec?.id;
  } catch {
    return false;
  }
}
