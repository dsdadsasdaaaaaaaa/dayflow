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

/** Send one SMS. Throws with a readable message on failure. */
export async function sendSms(
  creds: SmsCredentials,
  to: string,
  body: string
): Promise<SmsMessage> {
  const form = new URLSearchParams({
    From: creds.fromNumber,
    To: normalizePhone(to),
    Body: body,
  });
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
  return msg;
}

/**
 * List recent messages involving our number (both directions), newest first.
 * Twilio needs two queries (To=us and From=us); results are merged/deduped.
 */
export async function listRecentSms(
  creds: SmsCredentials,
  pageSize = 100
): Promise<SmsMessage[]> {
  const own = encodeURIComponent(normalizePhone(creds.fromNumber));
  const urls = [
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&To=${own}`,
    `${baseUrl(creds)}/Messages.json?PageSize=${pageSize}&From=${own}`,
  ];
  const results = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(json?.message ?? `Fetch failed (${res.status})`);
      }
      const json = (await res.json()) as { messages?: TwilioMessageRecord[] };
      return json.messages ?? [];
    })
  );
  const seen = new Set<string>();
  const merged: SmsMessage[] = [];
  for (const rec of results.flat()) {
    const msg = toSmsMessage(rec, creds.fromNumber);
    if (msg && !seen.has(msg.sid)) {
      seen.add(msg.sid);
      merged.push(msg);
    }
  }
  merged.sort((a, b) => b.sentAt - a.sentAt);
  return merged;
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
