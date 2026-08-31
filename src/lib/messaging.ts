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
import { listSmsGate, sendSmsGate } from './smsgate';
import {
  loadSmsGateCredentials,
  type SmsGateCredentials,
} from './smsgateCredentials';

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
 * The SIM line can be served two ways. SMSGate is free — its cloud sends
 * from anywhere, and a small user-deployed Worker holds received messages to
 * be polled. Telerivet does the same job but bills per API call. Whichever
 * serves it, Telerivet stays connected for photos alone, since it is the
 * only one that sends MMS, and when SMSGate is present Telerivet is never
 * polled: two gateways reading one SIM would otherwise report every inbound
 * message twice.
 *
 * Both routes produce the same SmsMessage shape, so threads, dedup,
 * follow-ups and the number-rotation UI never learn which one was used.
 */

export type ProviderId = 'twilio' | 'telerivet' | 'smsgate';

export type MessagingCreds =
  | { provider: 'twilio'; twilio: SmsCredentials }
  | { provider: 'telerivet'; telerivet: TelerivetCredentials }
  | { provider: 'smsgate'; smsgate: SmsGateCredentials; mms: TelerivetCredentials | null };

/**
 * Both routes at once. Connecting the SIM used to mean switching to it, but
 * deliverability is per recipient, not per account: some people stop
 * receiving on the A2P long code while others are fine, so the useful setup
 * is both lines live with the choice made per conversation.
 */
export interface Routes {
  twilio: SmsCredentials | null;
  telerivet: TelerivetCredentials | null;
  smsgate: SmsGateCredentials | null;
}

export async function loadRoutes(): Promise<Routes> {
  const [twilio, telerivet, smsgate] = await Promise.all([
    loadSmsCredentials(),
    loadTelerivetCredentials(),
    loadSmsGateCredentials(),
  ]);
  return { twilio, telerivet, smsgate };
}

/** Which routes can actually send right now, preferred order first. */
export function availableRoutes(routes: Routes): ProviderId[] {
  const out: ProviderId[] = [];
  if (routes.twilio) out.push('twilio');
  // Still only two lines to choose between: Telerivet stops being a route of
  // its own once SMSGate serves the SIM, and becomes how photos leave it.
  if (routes.smsgate) out.push('smsgate');
  else if (routes.telerivet) out.push('telerivet');
  return out;
}

/** Credentials for one route, or null when that route is not connected. */
export function credsFor(routes: Routes, id: ProviderId): MessagingCreds | null {
  if (id === 'twilio') {
    return routes.twilio ? { provider: 'twilio', twilio: routes.twilio } : null;
  }
  if (id === 'smsgate') {
    return routes.smsgate
      ? { provider: 'smsgate', smsgate: routes.smsgate, mms: routes.telerivet }
      : null;
  }
  return routes.telerivet ? { provider: 'telerivet', telerivet: routes.telerivet } : null;
}

/** Every number we can currently send from, for telling ours from a retired one. */
export function activeNumbersOf(routes: Routes): string[] {
  const out: string[] = [];
  if (routes.twilio?.fromNumber) out.push(routes.twilio.fromNumber);
  // One number for the SIM however it is served, so a phone running both
  // gateways is not listed twice.
  const sim = routes.smsgate?.fromNumber ?? routes.telerivet?.fromNumber;
  if (sim) out.push(sim);
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
  if (creds.provider === 'twilio') return creds.twilio.fromNumber;
  if (creds.provider === 'smsgate') return creds.smsgate.fromNumber;
  return creds.telerivet.fromNumber;
}

export async function sendMessage(
  creds: MessagingCreds,
  to: string,
  body: string,
  mediaUrls?: string[]
): Promise<SmsMessage> {
  if (creds.provider === 'twilio') return sendSms(creds.twilio, to, body, mediaUrls);
  if (creds.provider === 'telerivet') {
    return sendTelerivet(creds.telerivet, to, body, mediaUrls);
  }
  // SMSGate cannot send MMS, so a photo leaves through Telerivet on the same
  // SIM: the one billable call, paid only when there is actually a photo
  // rather than on every poll.
  if (mediaUrls && mediaUrls.length > 0) {
    if (!creds.mms) {
      throw new SmsSendError(
        'Sending photos from your SIM needs Telerivet connected as well. Text-only sends work as normal.'
      );
    }
    return sendTelerivet(creds.mms, to, body, mediaUrls);
  }
  return sendSmsGate(creds.smsgate, to, body);
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
  if (creds.provider === 'smsgate') {
    return listSmsGate(
      creds.smsgate,
      pageSize,
      opts?.sentAfterMs != null ? { sentAfterMs: opts.sentAfterMs } : {}
    );
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
  if (creds.provider === 'smsgate') {
    // The relay only holds recent inbound; older history for this route has
    // to come from whatever is already stored on the phone.
    return listSmsGate(creds.smsgate, pageSize, { counterparty });
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
  if (creds.provider === 'smsgate') {
    return listSmsGate(creds.smsgate, pageSize, { counterparty });
  }
  return listTelerivetPaged(creds.telerivet, pageSize, { counterparty });
}

export async function fetchStatus(
  creds: MessagingCreds,
  sid: string
): Promise<SmsMessage | null> {
  if (creds.provider === 'twilio') return fetchSmsStatus(creds.twilio, sid);
  // The relay stores received messages only, so there is no delivery state
  // to settle for a send made through SMSGate.
  if (creds.provider === 'smsgate') return null;
  return fetchTelerivetMessage(creds.telerivet, sid);
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
