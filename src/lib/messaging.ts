import {
  fetchMediaUrls,
  fetchSmsStatus,
  listOlderSms,
  listRecentSms,
  listThreadToday,
  SmsSendError,
  sendSms,
  type ListSmsOptions,
  type SmsMessage,
} from './smsApi';
import { loadSmsCredentials, type SmsCredentials } from './smsCredentials';
import {
  fetchTelerivetMessage,
  listTelerivetPaged,
  sendTelerivet,
} from './telerivet';
import {
  loadTelerivetCredentials,
  type TelerivetCredentials,
} from './telerivetCredentials';

/**
 * The seam between the app and whichever route actually carries a message.
 *
 * Two routes exist, and the difference is not cosmetic. Twilio is a
 * carrier-registered A2P long code: in Canada and the US that traffic is
 * filtered on the route rather than the content, which is why ordinary
 * conversation sent through it keeps getting numbers burned. Telerivet
 * relays through a real consumer SIM in an Android handset, so messages
 * travel the carrier's ordinary person-to-person path with no campaign to
 * register and nothing to be rejected from.
 *
 * Selection is deliberately implicit: connecting Telerivet IS the switch, and
 * disconnecting it falls straight back to Twilio. One concept instead of a
 * credential set plus a separate toggle that can disagree with it.
 *
 * Both routes produce the same SmsMessage shape, so threads, dedup,
 * follow-ups and the number-rotation UI never learn which one was used.
 */

export type ProviderId = 'twilio' | 'telerivet';

export type MessagingCreds =
  | { provider: 'twilio'; twilio: SmsCredentials }
  | { provider: 'telerivet'; telerivet: TelerivetCredentials };

/**
 * Telerivet when it is connected, else Twilio, else nothing. Callers treat
 * null exactly as they treated missing Twilio credentials before.
 */
export async function loadMessagingCredentials(): Promise<MessagingCreds | null> {
  const tr = await loadTelerivetCredentials();
  if (tr) return { provider: 'telerivet', telerivet: tr };
  const tw = await loadSmsCredentials();
  if (tw) return { provider: 'twilio', twilio: tw };
  return null;
}

/** The number we send from on the active route. */
export function ownNumberOf(creds: MessagingCreds): string {
  return creds.provider === 'twilio'
    ? creds.twilio.fromNumber
    : creds.telerivet.fromNumber;
}

export async function sendMessage(
  creds: MessagingCreds,
  to: string,
  body: string,
  mediaUrls?: string[]
): Promise<SmsMessage> {
  return creds.provider === 'twilio'
    ? sendSms(creds.twilio, to, body, mediaUrls)
    : sendTelerivet(creds.telerivet, to, body, mediaUrls);
}

export async function listRecent(
  creds: MessagingCreds,
  pageSize = 100,
  skipMediaSids?: ReadonlySet<string>,
  opts?: ListSmsOptions
): Promise<SmsMessage[]> {
  if (creds.provider === 'twilio') {
    return listRecentSms(creds.twilio, pageSize, skipMediaSids, opts);
  }
  // Telerivet returns both directions in one project feed, and returns them
  // for every SIM the project has ever had — so rotated-away numbers keep
  // arriving without the explicit previousNumbers fan-out Twilio needs.
  return listTelerivetPaged(
    creds.telerivet,
    pageSize,
    opts?.sentAfterMs != null ? { sentAfterMs: opts.sentAfterMs } : {}
  );
}

export async function listOlder(
  creds: MessagingCreds,
  counterparty: string,
  beforeMs: number,
  pageSize = 100,
  skipMediaSids?: ReadonlySet<string>,
  previousNumbers?: readonly string[]
): Promise<SmsMessage[]> {
  if (creds.provider === 'twilio') {
    return listOlderSms(
      creds.twilio,
      counterparty,
      beforeMs,
      pageSize,
      skipMediaSids,
      previousNumbers
    );
  }
  return listTelerivetPaged(creds.telerivet, pageSize, {
    counterparty,
    sentBeforeMs: beforeMs,
  });
}

export async function listThread(
  creds: MessagingCreds,
  counterparty: string,
  pageSize = 20,
  skipMediaSids?: ReadonlySet<string>,
  previousNumbers?: readonly string[]
): Promise<SmsMessage[]> {
  if (creds.provider === 'twilio') {
    return listThreadToday(
      creds.twilio,
      counterparty,
      pageSize,
      skipMediaSids,
      previousNumbers
    );
  }
  return listTelerivetPaged(creds.telerivet, pageSize, { counterparty });
}

export async function fetchStatus(
  creds: MessagingCreds,
  sid: string
): Promise<SmsMessage | null> {
  return creds.provider === 'twilio'
    ? fetchSmsStatus(creds.twilio, sid)
    : fetchTelerivetMessage(creds.telerivet, sid);
}

/**
 * Twilio exposes attachments as a subresource that needs a second call.
 * Telerivet inlines media on the message itself, so there is never anything
 * to backfill and null is the honest answer.
 */
export async function fetchMedia(
  creds: MessagingCreds,
  sid: string
): Promise<string[] | null> {
  return creds.provider === 'twilio' ? fetchMediaUrls(creds.twilio, sid) : null;
}

/**
 * Scheduled sends ride Twilio's Messaging Service. Rather than silently
 * dropping a scheduled message on the other route, callers check this and
 * tell the user plainly.
 */
export function supportsScheduling(
  creds: MessagingCreds
): creds is { provider: 'twilio'; twilio: SmsCredentials } {
  return creds.provider === 'twilio';
}

export const SCHEDULING_UNSUPPORTED =
  'Scheduled sending needs the Twilio route. On your own SIM, send it when you mean to.';

export { SmsSendError };
export type { SmsMessage };
