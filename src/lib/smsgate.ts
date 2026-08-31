import type { SmsMessage } from './smsApi';
import { SmsSendError } from './smsApi';
import { normalizePhone } from './smsCredentials';
import type { SmsGateCredentials } from './smsgateCredentials';

/**
 * SMSGate client — the free SIM route.
 *
 * Sending goes through SMSGate's cloud, which is free and reachable from
 * anywhere. Receiving does NOT: in cloud mode SMSGate delivers inbound only
 * by webhook, and this app has no server to receive one. So inbound is read
 * from a small Worker the user deploys, which catches those webhooks and
 * holds them to be polled (worker/README.md).
 *
 * It cannot send MMS. Photos continue to go out through Telerivet, which is
 * then billed once per photo and never polled — see lib/messaging.
 */

function base(creds: SmsGateCredentials): string {
  return creds.baseUrl.replace(/\/+$/, '');
}

function inbox(creds: SmsGateCredentials): string {
  return creds.inboxUrl.replace(/\/+$/, '');
}

function authHeader(creds: SmsGateCredentials): string {
  return 'Basic ' + btoa(`${creds.username}:${creds.password}`);
}

interface RelayMessage {
  id?: string;
  from?: string;
  text?: string;
  at?: number;
}

/**
 * Send one text. SMSGate answers with an id and a queue state rather than a
 * finished message, so the bubble is synthesized locally; the real thing is
 * whatever the recipient receives.
 */
export async function sendSmsGate(
  creds: SmsGateCredentials,
  to: string,
  body: string
): Promise<SmsMessage> {
  const target = normalizePhone(to);
  if (!target) throw new SmsSendError('That number does not look valid.');

  const res = await fetch(`${base(creds)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: authHeader(creds) },
    body: JSON.stringify({
      textMessage: { text: body },
      phoneNumbers: [target],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(text) as { message?: string };
      detail = parsed.message?.trim() ?? '';
    } catch {
      detail = '';
    }
    throw new SmsSendError(
      detail ? `${detail} (${res.status})` : `SMSGate rejected the send (${res.status}).`
    );
  }
  let id = '';
  try {
    id = ((JSON.parse(text) as { id?: string }).id ?? '').trim();
  } catch {
    id = '';
  }
  return {
    sid: id || `sg-local-${Date.now()}`,
    counterparty: target,
    direction: 'out',
    body,
    sentAt: Date.now(),
    // Delivery state would arrive as its own webhook; the relay deliberately
    // stores only received messages, so an outbound send stays at "sent".
    status: 'sent',
    ownNumber: normalizePhone(creds.fromNumber),
  };
}

export interface SmsGateListOptions {
  sentAfterMs?: number;
  counterparty?: string;
}

/** Received messages, newest first, from the user's own relay. */
export async function listSmsGate(
  creds: SmsGateCredentials,
  pageSize: number,
  opts: SmsGateListOptions = {}
): Promise<SmsMessage[]> {
  if (!creds.inboxUrl || !creds.inboxSecret) return [];
  const since = opts.sentAfterMs != null ? `&since=${Math.floor(opts.sentAfterMs)}` : '';
  const res = await fetch(
    `${inbox(creds)}/messages?limit=${Math.min(Math.max(pageSize, 1), 500)}${since}`,
    { headers: { Authorization: `Bearer ${creds.inboxSecret}` } }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new SmsSendError(
      res.status === 403
        ? 'The inbox relay rejected the secret. Check it matches the Worker.'
        : `Inbox relay error (${res.status}).`
    );
  }
  let rows: RelayMessage[] = [];
  try {
    rows = ((JSON.parse(text) as { messages?: RelayMessage[] }).messages ?? []) as RelayMessage[];
  } catch {
    rows = [];
  }

  const mine = normalizePhone(creds.fromNumber);
  const only = opts.counterparty ? normalizePhone(opts.counterparty) : '';
  return rows
    .map((r): SmsMessage | null => {
      const counterparty = normalizePhone(r.from ?? '');
      if (!counterparty || !r.id) return null;
      return {
        sid: r.id,
        counterparty,
        direction: 'in',
        body: r.text ?? '',
        sentAt: typeof r.at === 'number' ? r.at : Date.now(),
        status: 'received',
        ownNumber: mine,
      };
    })
    .filter((m): m is SmsMessage => m != null && (!only || m.counterparty === only))
    .sort((a, b) => b.sentAt - a.sentAt);
}

/** Check both halves: the cloud can be reached AND the relay answers. */
export async function verifySmsGateCredentials(
  creds: SmsGateCredentials
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${base(creds)}/devices`, {
      headers: { Authorization: authHeader(creds) },
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401
            ? 'SMSGate rejected that username or password. They are on the app’s Home tab.'
            : `SMSGate returned an error (${res.status}).`,
      };
    }
  } catch {
    return { ok: false, error: 'Could not reach SMSGate. Check your connection.' };
  }

  if (creds.inboxUrl) {
    try {
      const res = await fetch(`${inbox(creds)}/messages?limit=1`, {
        headers: { Authorization: `Bearer ${creds.inboxSecret}` },
      });
      if (!res.ok) {
        return {
          ok: false,
          error:
            res.status === 403
              ? 'The Worker rejected the secret. It must match SHARED_SECRET exactly.'
              : `The inbox relay answered with an error (${res.status}).`,
        };
      }
    } catch {
      return { ok: false, error: 'Could not reach the inbox relay at that address.' };
    }
  }
  return { ok: true };
}
