import type { SmsMessage } from './smsApi';
import { SmsSendError } from './smsApi';
import { normalizePhone } from './smsCredentials';
import type { TextbeeCredentials } from './textbeeCredentials';

/**
 * textbee client — the unmetered SIM route.
 *
 * Same idea as the Telerivet client: an Android phone with a consumer SIM
 * relays our messages over the carrier's ordinary person-to-person path. The
 * difference is billing. Telerivet charges per API call, which turns routine
 * polling into a running cost; textbee is open source and self-hostable, so
 * the same traffic costs nothing.
 *
 * It cannot SEND MMS, which is why Telerivet stays connected purely for
 * photos. See lib/messaging for how a send is split between them.
 *
 * Output is the shared SmsMessage shape, so nothing above this layer knows
 * or cares which gateway carried a message.
 */

const SEC = 1000;

interface TextbeeRecord {
  id?: string;
  _id?: string;
  message?: string | null;
  body?: string | null;
  sender?: string | null;
  recipient?: string | null;
  receivedAt?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  type?: string | null;
  direction?: string | null;
  status?: string | null;
}

function headers(creds: TextbeeCredentials): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': creds.apiKey };
}

function base(creds: TextbeeCredentials): string {
  return creds.baseUrl.replace(/\/+$/, '');
}

/** Epoch ms from whichever timestamp field the record carries. */
function timeOf(rec: TextbeeRecord): number {
  const raw = rec.sentAt ?? rec.receivedAt ?? rec.createdAt;
  if (!raw) return Date.now();
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toSmsMessage(
  rec: TextbeeRecord,
  creds: TextbeeCredentials
): SmsMessage | null {
  const sid = rec.id ?? rec._id;
  if (!sid) return null;
  const inbound =
    rec.direction === 'received' ||
    rec.type === 'received' ||
    rec.direction === 'in';
  const counterparty = normalizePhone(
    (inbound ? rec.sender : rec.recipient) ?? ''
  );
  if (!counterparty) return null;
  return {
    sid,
    counterparty,
    direction: inbound ? 'in' : 'out',
    body: rec.message ?? rec.body ?? '',
    sentAt: timeOf(rec),
    status: inbound ? 'received' : (rec.status ?? 'sent'),
    ownNumber: normalizePhone(creds.fromNumber),
  };
}

async function call(
  creds: TextbeeCredentials,
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> }
): Promise<unknown> {
  const qs = init?.query
    ? '?' +
      Object.entries(init.query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : '';
  const res = await fetch(`${base(creds)}${path}${qs}`, {
    method: init?.method ?? 'GET',
    headers: headers(creds),
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
    const err = parsed as { message?: string | string[] } | null;
    const msg = Array.isArray(err?.message) ? err?.message.join(', ') : err?.message;
    throw new SmsSendError(msg || `Gateway request failed (${res.status})`);
  }
  return parsed;
}

/** Records can arrive bare, under `data`, or under `data.messages`. */
function recordsOf(payload: unknown): TextbeeRecord[] {
  if (Array.isArray(payload)) return payload as TextbeeRecord[];
  const obj = payload as { data?: unknown; messages?: unknown } | null;
  if (Array.isArray(obj?.data)) return obj.data as TextbeeRecord[];
  if (Array.isArray(obj?.messages)) return obj.messages as TextbeeRecord[];
  const nested = (obj?.data as { messages?: unknown } | undefined)?.messages;
  if (Array.isArray(nested)) return nested as TextbeeRecord[];
  return [];
}

export async function sendTextbee(
  creds: TextbeeCredentials,
  to: string,
  body: string
): Promise<SmsMessage> {
  const target = normalizePhone(to);
  if (!target) throw new SmsSendError('That number does not look valid.');
  await call(creds, `/gateway/devices/${encodeURIComponent(creds.deviceId)}/send-sms`, {
    method: 'POST',
    body: { recipients: [target], message: body },
  });
  // The gateway acknowledges the queue rather than returning a full record,
  // so the bubble is synthesized and the next poll settles the real one.
  return {
    sid: `tb-local-${Date.now()}`,
    counterparty: target,
    direction: 'out',
    body,
    sentAt: Date.now(),
    status: 'sent',
    ownNumber: normalizePhone(creds.fromNumber),
  };
}

export interface TextbeeListOptions {
  /** Only messages at or after this epoch ms. */
  sentAfterMs?: number;
  counterparty?: string;
}

/**
 * Everything the gateway has, both directions, newest first. It exposes no
 * server-side time filter, so the window is applied here — fine at the
 * volumes one person's phone produces, and unmetered either way.
 */
export async function listTextbee(
  creds: TextbeeCredentials,
  pageSize: number,
  opts: TextbeeListOptions = {}
): Promise<SmsMessage[]> {
  const out: SmsMessage[] = [];
  for (const direction of ['received', 'sent'] as const) {
    try {
      const payload = await call(
        creds,
        `/gateway/devices/${encodeURIComponent(creds.deviceId)}/messages`,
        { query: { direction, limit: String(Math.min(Math.max(pageSize, 1), 200)) } }
      );
      for (const rec of recordsOf(payload)) {
        const msg = toSmsMessage({ direction, ...rec }, creds);
        if (msg) out.push(msg);
      }
    } catch {
      // One direction failing should not lose the other.
    }
  }
  const after = opts.sentAfterMs;
  const only = opts.counterparty ? normalizePhone(opts.counterparty) : '';
  return out
    .filter((m) => (after == null || m.sentAt >= after) && (!only || m.counterparty === only))
    .sort((a, b) => b.sentAt - a.sentAt);
}

/** Cheap credential check: ask the gateway for its devices. */
export async function verifyTextbeeCredentials(
  creds: TextbeeCredentials
): Promise<boolean> {
  try {
    const payload = await call(creds, '/gateway/devices');
    return payload != null;
  } catch {
    return false;
  }
}
