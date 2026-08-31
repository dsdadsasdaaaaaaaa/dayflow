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

interface WebhookRecord {
  id?: string;
  url?: string;
  event?: string;
}

/** The event that carries an incoming text. */
const RECEIVED_EVENT = 'sms:received';

/** The URL SMSGate should post to, secret in the path. */
export function webhookUrlFor(creds: SmsGateCredentials): string {
  return `${inbox(creds)}/webhook/${encodeURIComponent(creds.inboxSecret)}`;
}

/**
 * Point SMSGate at the relay.
 *
 * Webhooks are configured through the API rather than in the app, which would
 * otherwise leave the user hand-crafting a curl command with a secret in it
 * as the very last setup step — the easiest place to get something wrong and
 * the hardest to notice, since sending would work perfectly while nothing
 * ever came back.
 *
 * Existing registrations for the same URL are left alone, so reconnecting
 * does not pile up duplicates and deliver every message several times.
 */
export async function registerSmsGateWebhook(
  creds: SmsGateCredentials
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  if (!creds.inboxUrl || !creds.inboxSecret) {
    return { ok: false, error: 'No relay address to register.' };
  }
  const target = webhookUrlFor(creds);
  const headers = {
    'content-type': 'application/json',
    Authorization: authHeader(creds),
  };
  try {
    const existing = await fetch(`${base(creds)}/webhooks`, { headers });
    if (existing.ok) {
      const text = await existing.text();
      let rows: WebhookRecord[] = [];
      try {
        const parsed = JSON.parse(text) as WebhookRecord[] | { data?: WebhookRecord[] };
        rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
      } catch {
        rows = [];
      }
      if (rows.some((w) => w.url === target && w.event === RECEIVED_EVENT)) {
        return { ok: true, created: false };
      }
    }
    const res = await fetch(`${base(creds)}/webhooks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: target, event: RECEIVED_EVENT }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 160);
      return { ok: false, error: `SMSGate refused the webhook (${res.status}). ${detail}` };
    }
    return { ok: true, created: true };
  } catch {
    return { ok: false, error: 'Could not reach SMSGate to register the webhook.' };
  }
}

export interface SmsGateDiagnosis {
  /** Each check, in the order they have to pass. */
  lines: string[];
  /** The first thing that is actually wrong, or null when all is well. */
  problem: string | null;
}

/**
 * Walk the whole path and report where it stops.
 *
 * Inbound depends on four separate things being right — SMSGate credentials,
 * a registered webhook, a reachable relay, a matching secret — and every one
 * of them fails as "no messages". Without this the only way to tell them
 * apart is to guess and re-check one at a time.
 */
export async function diagnoseSmsGate(
  creds: SmsGateCredentials
): Promise<SmsGateDiagnosis> {
  const lines: string[] = [];
  let problem: string | null = null;
  const fail = (line: string, why: string) => {
    lines.push(`✕ ${line}`);
    if (!problem) problem = why;
  };

  // 1. Can we talk to SMSGate at all?
  let devicesOk = false;
  try {
    const res = await fetch(`${base(creds)}/devices`, {
      headers: { Authorization: authHeader(creds) },
    });
    if (res.ok) {
      const text = await res.text();
      let count = 0;
      try {
        const parsed = JSON.parse(text) as unknown[] | { data?: unknown[] };
        count = (Array.isArray(parsed) ? parsed : (parsed.data ?? [])).length;
      } catch {
        count = 0;
      }
      devicesOk = true;
      if (count > 0) lines.push(`✓ SMSGate reachable, ${count} device${count === 1 ? '' : 's'} registered`);
      else
        fail(
          'SMSGate reachable but NO device registered',
          'The Android app is not registered with SMSGate. Open it and make sure Cloud Server mode is on.'
        );
    } else {
      fail(
        `SMSGate rejected the login (${res.status})`,
        'Check the username and password on the SMSGate app Home tab.'
      );
    }
  } catch {
    fail('Could not reach SMSGate', 'No connection to SMSGate.');
  }

  // 2. Is our webhook registered? This is the step that silently does nothing.
  if (devicesOk) {
    const target = webhookUrlFor(creds);
    try {
      const res = await fetch(`${base(creds)}/webhooks`, {
        headers: { Authorization: authHeader(creds) },
      });
      if (res.ok) {
        const text = await res.text();
        let rows: WebhookRecord[] = [];
        try {
          const parsed = JSON.parse(text) as WebhookRecord[] | { data?: WebhookRecord[] };
          rows = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
        } catch {
          rows = [];
        }
        const mine = rows.find((w) => w.url === target);
        if (mine) lines.push('✓ Webhook registered and pointing at your relay');
        else if (rows.length > 0)
          fail(
            `${rows.length} webhook(s) registered, none pointing here`,
            'A webhook exists but has the wrong address. Disconnect and reconnect to re-register it.'
          );
        else
          fail(
            'NO webhook registered',
            'SMSGate has no webhook, so nothing is ever sent to the relay. Disconnect and reconnect to register it.'
          );
      } else {
        fail(`Could not list webhooks (${res.status})`, 'SMSGate would not report its webhooks.');
      }
    } catch {
      fail('Could not list webhooks', 'SMSGate would not report its webhooks.');
    }
  }

  // 3 and 4. The relay, and whether the secret matches.
  if (!creds.inboxUrl) {
    fail('No relay address set', 'Without a relay address nothing incoming can reach the app.');
  } else {
    try {
      const health = await fetch(`${inbox(creds)}/health`);
      if (health.ok) {
        const body = (await health.json()) as { stored?: number };
        lines.push(`✓ Relay reachable, holding ${body.stored ?? 0} message(s)`);
        if ((body.stored ?? 0) === 0) {
          lines.push('  (never received anything, so the webhook has not fired)');
        }
      } else {
        fail(`Relay answered ${health.status}`, 'The relay address does not look right.');
      }
    } catch {
      fail('Could not reach the relay', 'Check the Worker address, including https://');
    }
    try {
      const res = await fetch(`${inbox(creds)}/messages?limit=1`, {
        headers: { Authorization: `Bearer ${creds.inboxSecret}` },
      });
      if (res.ok) lines.push('✓ Relay secret accepted');
      else if (res.status === 403)
        fail(
          `Relay rejected the secret (sent ${creds.inboxSecret.length} characters)`,
          'The secret does not match the one in the Worker.'
        );
      else fail(`Relay read failed (${res.status})`, 'The relay would not return messages.');
    } catch {
      fail('Could not read from the relay', 'The relay would not return messages.');
    }
  }

  return { lines, problem };
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
    // /health needs no auth, so it separates "wrong address" from "wrong
    // secret" — two failures that otherwise look identical and send you
    // checking the wrong field.
    try {
      const probe = await fetch(`${inbox(creds)}/health`);
      if (!probe.ok) {
        return {
          ok: false,
          error: `Reached ${inbox(creds)} but it did not answer as the relay (${probe.status}). Check the Worker address.`,
        };
      }
    } catch {
      return {
        ok: false,
        error: `Could not reach ${inbox(creds)}. Check the Worker address, including https://`,
      };
    }

    try {
      const res = await fetch(`${inbox(creds)}/messages?limit=1`, {
        headers: { Authorization: `Bearer ${creds.inboxSecret}` },
      });
      if (res.status === 403) {
        // The relay is definitely reachable, so this is the secret. Report
        // the length rather than the value: a truncated or half-pasted
        // secret is by far the likeliest cause and is invisible in a
        // password field.
        return {
          ok: false,
          error: `The relay is reachable but rejected the secret. It received ${creds.inboxSecret.length} characters; the one in the Worker is 48. Re-paste it, making sure nothing was cut off.`,
        };
      }
      if (!res.ok) {
        return { ok: false, error: `The inbox relay answered with an error (${res.status}).` };
      }
    } catch {
      return { ok: false, error: 'Could not read from the inbox relay.' };
    }
  }
  return { ok: true };
}
