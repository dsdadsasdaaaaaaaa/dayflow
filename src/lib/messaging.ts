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
 * Both can be connected at once and each conversation picks a line. That is
 * the shape the problem actually has: carriers filter per recipient, so some
 * people stop receiving on the A2P long code while everyone else is fine.
 * Switching wholesale would move the ones who were never having trouble onto
 * a number they have never seen, for no reason.
 *
 * Both routes produce the same SmsMessage shape, so threads, dedup,
 * follow-ups and the number-rotation UI never learn which one was used.
 */

export type ProviderId = 'twilio' | 'telerivet';

export type MessagingCreds =
  | { provider: 'twilio'; twilio: SmsCredentials }
  | { provider: 'telerivet'; telerivet: TelerivetCredentials };

/**
 * Both routes at once. Connecting the SIM used to mean switching to it, but
 * deliverability is per recipient, not per account: some people stop
 * receiving on the A2P long code while others are fine, so the useful setup
 * is both lines live with the choice made per conversation.
 */
export interface Routes {
  twilio: SmsCredentials | null;
  telerivet: TelerivetCredentials | null;
}

export async function loadRoutes(): Promise<Routes> {
  const [twilio, telerivet] = await Promise.all([
    loadSmsCredentials(),
    loadTelerivetCredentials(),
  ]);
  return { twilio, telerivet };
}

/** Which routes can actually send right now, preferred order first. */
export function availableRoutes(routes: Routes): ProviderId[] {
  const out: ProviderId[] = [];
  if (routes.twilio) out.push('twilio');
  if (routes.telerivet) out.push('telerivet');
  return out;
}

/** Credentials for one route, or null when that route is not connected. */
export function credsFor(routes: Routes, id: ProviderId): MessagingCreds | null {
  if (id === 'twilio') {
    return routes.twilio ? { provider: 'twilio', twilio: routes.twilio } : null;
  }
  return routes.telerivet ? { provider: 'telerivet', telerivet: routes.telerivet } : null;
}

/** Every number we can currently send from, for telling ours from a retired one. */
export function activeNumbersOf(routes: Routes): string[] {
  const out: string[] = [];
  if (routes.twilio?.fromNumber) out.push(routes.twilio.fromNumber);
  if (routes.telerivet?.fromNumber) out.push(routes.telerivet.fromNumber);
  return out;
}

/**
 * The route to use when a conversation has no explicit choice. Twilio stays
 * the default: it is the number clients already have, and the SIM is the
 * fallback for the ones it no longer reaches.
 */
export function defaultRoute(routes: Routes, preferred?: ProviderId): ProviderId | null {
  if (preferred && credsFor(routes, preferred)) return preferred;
  return availableRoutes(routes)[0] ?? null;
}

/** Human label for pickers and status lines. */
export function routeLabel(id: ProviderId): string {
  return id === 'twilio' ? 'Twilio' : 'Own SIM';
}

/**
 * Back-compat single-route load, resolving to `preferred` when it is
 * connected. Callers that do not care which line carries a read still use it.
 */
export async function loadMessagingCredentials(
  preferred?: ProviderId
): Promise<MessagingCreds | null> {
  const routes = await loadRoutes();
  const id = defaultRoute(routes, preferred);
  return id ? credsFor(routes, id) : null;
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
