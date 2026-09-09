/**
 * DayFlow inbox relay — a Cloudflare Worker.
 *
 * SMSGate's cloud can send from your SIM from anywhere, but it only delivers
 * RECEIVED messages by webhook, and DayFlow is a phone app with nothing to
 * receive one. This is the smallest possible thing that closes that gap: it
 * catches the webhook, keeps the message, and lets the app poll for it.
 *
 * Everything here runs on Cloudflare's free tier. Polling every few seconds
 * is roughly 14k requests a day against a 100k allowance, and each inbound
 * message is a single KV write against a 1k allowance.
 *
 * Deploy notes are in worker/README.md.
 */

/**
 * Most recent messages kept. Older ones fall off; the app has its own copy.
 *
 * Sized for a history import rather than for live traffic. Live polling only
 * needs the buffer to outlast the longest stretch the app is closed, which a
 * few hundred already covered. But a one-time backfill of everything the
 * phone remembers arrives all at once, and at a few hundred the front of it
 * pushed the back of it off the end before the app ever asked. The whole
 * inbox is one KV value, well inside the 25 MB a value may hold.
 */
const KEEP = 3000;

/** One KV key holding the whole inbox as JSON. */
const INBOX_KEY = 'inbox';

/** The most recent school schedule email, waiting to be read by the app. */
const SCHEDULE_KEY = 'schedule';

/**
 * A number the app wants the work phone to dial.
 *
 * The work number lives in the Android's SIM, and caller ID comes from the
 * line a call leaves on, so a call that shows the work number has to leave
 * from the Android. The app cannot reach the Android directly; it leaves
 * the number here, and an automation on the Android collects it and dials.
 * Consumed on read, so a number is dialled once.
 */
const CALL_KEY = 'call';

/**
 * The live link: a snapshot of the whole app, and a queue of changes for it.
 *
 * Guarded by DATA_SECRET, deliberately not the secret that guards messages.
 * The SMS secret is pasted into SMSGate, sits in a URL an automation app can
 * read, and has been shared more than once; it should not also be the key to
 * a client book. Two secrets means losing one does not lose both, and either
 * can be rotated without touching the other.
 */
const DATA_KEY = 'data';
const QUEUE_KEY = 'queue';

/** A snapshot past this is a bug, not a big inbox. */
const MAX_DATA_BYTES = 5_000_000;
/** Changes waiting for the app. Small on purpose: these are single actions. */
const MAX_QUEUED = 50;

/** Attachments the forwarder sends with a schedule: bell-schedule PDFs. */
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 700_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Constant-time-ish comparison. Not a defence against a determined attacker
 * with timing access, but it costs nothing and avoids the most obvious leak.
 */
function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Pull a message out of whatever shape the webhook arrives in.
 *
 * Field names are read defensively on purpose: the payload comes from
 * someone else's product and a rename upstream should degrade to storing
 * something imperfect, never to dropping the message on the floor.
 */
function normalize(payload) {
  const p = payload?.payload ?? payload ?? {};
  const text = p.message ?? p.text ?? p.body ?? p.content ?? '';
  const from = p.phoneNumber ?? p.sender ?? p.from ?? p.source ?? '';
  const at = p.receivedAt ?? p.receivedat ?? p.timestamp ?? p.createdAt ?? null;
  const parsed = at ? Date.parse(at) : NaN;
  // Keyed on the SMS's OWN id, not the webhook envelope's. SMSGate retries a
  // delivery it did not see acknowledged, and each retry carries a fresh
  // envelope id — so keying on that stored the same text again every time.
  // Duplicates are not only noise: each one consumes a slot against KEEP, so
  // a retry storm silently pushed real older messages off the end.
  const smsId = p.messageId ?? p.id ?? null;
  return {
    id: smsId
      ? `sms:${smsId}`
      : (payload?.id ?? `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    from: String(from),
    text: String(text),
    // Which way it went. Webhooks only ever carry received messages, so
    // inbound is the default; the history importer sets this explicitly so
    // the user's own replies come across too, and a thread reads as a
    // conversation rather than one side of one.
    dir: payload?.dir === 'out' || p.dir === 'out' ? 'out' : 'in',
    at: Number.isFinite(parsed) ? parsed : Date.now(),
    // Kept so a field this normalizer missed can still be recovered later
    // without having to ask the sender to resend anything.
    raw: p,
  };
}

/**
 * Every message in a webhook body.
 *
 * A normal delivery carries one message. A history replay (POST
 * /inbox/refresh with batch delivery) carries up to a hundred, and doing
 * that one-at-a-time would mean a hundred read-modify-write cycles racing
 * each other over a single key — most of the backfill would be lost. Both
 * shapes are read defensively, since only one of them is documented in a way
 * worth trusting.
 */
function messagesIn(payload) {
  const p = payload?.payload ?? payload ?? {};
  const candidates =
    (Array.isArray(p) && p) ||
    (Array.isArray(p.messages) && p.messages) ||
    (Array.isArray(payload?.messages) && payload.messages) ||
    null;
  if (candidates) return candidates.map((m) => normalize({ ...payload, payload: m, id: undefined }));
  return [normalize(payload)];
}

async function readInbox(env) {
  const stored = await env.INBOX.get(INBOX_KEY, 'json');
  return Array.isArray(stored) ? stored : [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.SHARED_SECRET;
    if (!secret) return json({ error: 'SHARED_SECRET is not configured' }, 500);

    // --- inbound webhook from SMSGate --------------------------------------
    // The secret lives in the path because the sender only lets you configure
    // a URL, not headers.
    if (request.method === 'POST' && url.pathname.startsWith('/webhook/')) {
      const given = decodeURIComponent(url.pathname.slice('/webhook/'.length));
      if (!secretMatches(given, secret)) return json({ error: 'forbidden' }, 403);

      let payload = null;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'body was not JSON' }, 400);
      }
      const incoming = messagesIn(payload);

      // One read-modify-write for the whole delivery, however many messages
      // it carried. Two deliveries landing in the same instant can still
      // race, which at the rate a person receives texts is not a real risk —
      // and avoiding it entirely would mean a Durable Object and a paid plan.
      const inbox = await readInbox(env);
      const seen = new Set(inbox.map((m) => m.id));
      // When the message ARRIVED here, which is not when it was sent. A phone
      // that was offline delivers hours-old texts the moment it reconnects,
      // and the reader pages by this rather than by send time so a late
      // arrival is still new to whoever is polling. Stamped once, at write.
      const storedAt = Date.now();
      let added = 0;
      for (const message of incoming) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        inbox.push({ ...message, storedAt });
        added++;
      }
      if (added > 0) {
        inbox.sort((a, b) => a.at - b.at);
        // Oldest fall off, so a long backfill keeps the most recent KEEP.
        await env.INBOX.put(INBOX_KEY, JSON.stringify(inbox.slice(-KEEP)));
      }
      return json({ ok: true, received: incoming.length, added });
    }

    // --- polling from DayFlow ---------------------------------------------
    if (request.method === 'GET' && url.pathname === '/messages') {
      const auth = request.headers.get('authorization') ?? '';
      const given = auth.replace(/^Bearer\s+/i, '');
      if (!secretMatches(given, secret)) return json({ error: 'forbidden' }, 403);

      const since = Number(url.searchParams.get('since') ?? '0');
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '200'), KEEP);
      const inbox = await readInbox(env);
      // `since` is a floor on ARRIVAL, never on send time. Filtering by send
      // time loses any message this relay learned about late: the reader
      // advances its cursor to the newest text it has seen, and a webhook
      // retried an hour later carries an older send time, so it lands behind
      // the cursor and is never asked for again. Arrival only ever moves
      // forward, so nothing can be stored behind the reader's back.
      const arrival = (m) => (typeof m.storedAt === 'number' ? m.storedAt : m.at);
      // `before` walks backwards through arrivals, so a reader can page the
      // whole relay instead of seeing only its newest page. An import of
      // several thousand messages is otherwise invisible past the first one.
      const beforeParam = url.searchParams.get('before');
      const before = beforeParam == null ? null : Number(beforeParam);
      const messages = inbox
        .filter((m) => (Number.isFinite(since) ? arrival(m) >= since : true))
        .filter((m) => (before != null && Number.isFinite(before) ? arrival(m) < before : true))
        // Newest arrival first, so a `limit` smaller than the backlog keeps
        // the part the reader has not seen rather than the part it has.
        .sort((a, b) => arrival(b) - arrival(a))
        .slice(0, limit)
        .map((m) => ({ ...m, storedAt: arrival(m) }));
      return json({ messages });
    }

    // --- the school's weekly schedule email --------------------------------
    // Posted by a small Apps Script running in the user's own mailbox (see
    // worker/schedule-forwarder.gs), because a phone app cannot read email
    // and this relay cannot receive any. Only the newest is kept: a schedule
    // is a statement about one week, and last week's is not history, it is
    // just wrong.
    if (request.method === 'POST' && url.pathname.startsWith('/schedule/')) {
      const given = decodeURIComponent(url.pathname.slice('/schedule/'.length));
      if (!secretMatches(given, secret)) return json({ error: 'forbidden' }, 403);
      let payload = null;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'body was not JSON' }, 400);
      }
      const body = String(payload?.body ?? payload?.text ?? '').slice(0, 40000);
      if (!body.trim()) return json({ error: 'no email body' }, 400);
      // The bell-schedule PDFs the newsletter links to. They are images, so
      // they travel as base64 for the app to hand to a model that can see.
      const attachments = (Array.isArray(payload?.attachments) ? payload.attachments : [])
        .slice(0, MAX_ATTACHMENTS)
        .map((a) => ({
          name: String(a?.name ?? '').slice(0, 200),
          mime: String(a?.mime ?? 'application/pdf').slice(0, 100),
          data: String(a?.data ?? '').slice(0, MAX_ATTACHMENT_BYTES * 1.4),
        }))
        .filter((a) => a.data.length > 0);
      await env.INBOX.put(
        SCHEDULE_KEY,
        JSON.stringify({
          body,
          subject: String(payload?.subject ?? '').slice(0, 300),
          from: String(payload?.from ?? '').slice(0, 300),
          sentAt: Number(payload?.sentAt) || Date.now(),
          storedAt: Date.now(),
          attachments,
        })
      );
      return json({ ok: true, stored: body.length, attachments: attachments.length });
    }

    if (request.method === 'GET' && url.pathname === '/schedule') {
      const auth = request.headers.get('authorization') ?? '';
      if (!secretMatches(auth.replace(/^Bearer\s+/i, ''), secret)) {
        return json({ error: 'forbidden' }, 403);
      }
      const stored = await env.INBOX.get(SCHEDULE_KEY, 'json');
      return json({ schedule: stored ?? null });
    }

    // --- remote dial ----------------------------------------------------------
    // The app leaves a number; the Android collects it. The secret is in the
    // path on both because the Android side is an automation app that can
    // set a URL and not much else.
    if (request.method === 'POST' && url.pathname.startsWith('/call/')) {
      const given = decodeURIComponent(url.pathname.slice('/call/'.length));
      if (!secretMatches(given, secret)) return json({ error: 'forbidden' }, 403);
      let payload = null;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'body was not JSON' }, 400);
      }
      const to = String(payload?.to ?? '').replace(/[^\d+]/g, '');
      if (!/^\+?\d{7,15}$/.test(to)) return json({ error: 'not a phone number' }, 400);
      await env.INBOX.put(CALL_KEY, JSON.stringify({ to, at: Date.now() }));
      return json({ ok: true, to });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/call/')) {
      const given = decodeURIComponent(url.pathname.slice('/call/'.length));
      if (!secretMatches(given, secret)) return new Response('', { status: 403 });
      const pending = await env.INBOX.get(CALL_KEY, 'json');
      // Plain text, the number alone or nothing: the Android side is an
      // automation that can dial a variable but cannot parse JSON.
      if (!pending?.to) return new Response('', { headers: { 'content-type': 'text/plain' } });
      // A number older than two minutes is a call nobody is waiting for any
      // more; dialling it now would surprise everyone involved.
      await env.INBOX.delete(CALL_KEY);
      if (Date.now() - pending.at > 120_000) {
        return new Response('', { headers: { 'content-type': 'text/plain' } });
      }
      return new Response(pending.to, { headers: { 'content-type': 'text/plain' } });
    }

    // --- the live link ------------------------------------------------------
    const dataSecret = env.DATA_SECRET;
    const dataAuth = (req) =>
      dataSecret != null &&
      secretMatches((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''), dataSecret);

    // The app pushes its whole state here. Replaces rather than merges: a
    // snapshot is a statement about right now, and half of one is worse than
    // none because it still looks current.
    if (request.method === 'POST' && url.pathname.startsWith('/data/')) {
      const given = decodeURIComponent(url.pathname.slice('/data/'.length));
      if (!dataSecret) return json({ error: 'live link is not configured' }, 501);
      if (!secretMatches(given, dataSecret)) return json({ error: 'forbidden' }, 403);
      const body = await request.text();
      if (body.length > MAX_DATA_BYTES) return json({ error: 'snapshot too large' }, 413);
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json({ error: 'body was not JSON' }, 400);
      }
      await env.INBOX.put(
        DATA_KEY,
        JSON.stringify({ ...parsed, storedAt: Date.now() })
      );
      return json({ ok: true, bytes: body.length });
    }

    if (request.method === 'GET' && url.pathname === '/data') {
      if (!dataSecret) return json({ error: 'live link is not configured' }, 501);
      if (!dataAuth(request)) return json({ error: 'forbidden' }, 403);
      const stored = await env.INBOX.get(DATA_KEY, 'json');
      return json({ data: stored ?? null });
    }

    // Turning the link off has to actually remove what is up here, or "off"
    // means "still readable by whoever has the secret".
    if (request.method === 'DELETE' && url.pathname.startsWith('/data/')) {
      const given = decodeURIComponent(url.pathname.slice('/data/'.length));
      if (!dataSecret) return json({ error: 'live link is not configured' }, 501);
      if (!secretMatches(given, dataSecret)) return json({ error: 'forbidden' }, 403);
      await env.INBOX.delete(DATA_KEY);
      await env.INBOX.delete(QUEUE_KEY);
      return json({ ok: true, cleared: true });
    }

    // An assistant queues a change; the app collects it and decides what to
    // do with it. Nothing here reaches a client: a message is queued as a
    // DRAFT and the app still requires a person to send it.
    if (request.method === 'POST' && url.pathname === '/queue') {
      if (!dataSecret) return json({ error: 'live link is not configured' }, 501);
      if (!dataAuth(request)) return json({ error: 'forbidden' }, 403);
      let change = null;
      try {
        change = await request.json();
      } catch {
        return json({ error: 'body was not JSON' }, 400);
      }
      if (!change || typeof change.action !== 'string') {
        return json({ error: 'a change needs an action' }, 400);
      }
      const queue = (await env.INBOX.get(QUEUE_KEY, 'json')) ?? [];
      if (queue.length >= MAX_QUEUED) return json({ error: 'queue is full' }, 429);
      queue.push({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: Date.now(),
        ...change,
      });
      await env.INBOX.put(QUEUE_KEY, JSON.stringify(queue));
      return json({ ok: true, queued: queue.length });
    }

    // The app collects everything waiting and the queue is emptied in the
    // same breath, so a change is applied once even if two syncs overlap.
    if (request.method === 'GET' && url.pathname.startsWith('/queue/')) {
      const given = decodeURIComponent(url.pathname.slice('/queue/'.length));
      if (!dataSecret) return json({ error: 'live link is not configured' }, 501);
      if (!secretMatches(given, dataSecret)) return json({ error: 'forbidden' }, 403);
      const queue = (await env.INBOX.get(QUEUE_KEY, 'json')) ?? [];
      if (queue.length > 0) await env.INBOX.delete(QUEUE_KEY);
      return json({ changes: queue });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const inbox = await readInbox(env);
      return json({ ok: true, stored: inbox.length });
    }

    // --- one-off repair -----------------------------------------------------
    // Records written before ids were keyed on the SMS's own message id are
    // still duplicated under envelope ids, and they hold no arrival stamp.
    // This re-keys them the way a fresh write would, so the duplicates
    // collapse and every record can be paged by arrival. Idempotent.
    if (request.method === 'POST' && url.pathname === '/compact') {
      const auth = request.headers.get('authorization') ?? '';
      if (!secretMatches(auth.replace(/^Bearer\s+/i, ''), secret)) {
        return json({ error: 'forbidden' }, 403);
      }
      const inbox = await readInbox(env);
      const byId = new Map();
      for (const m of inbox) {
        const smsId = m?.raw?.messageId ?? m?.raw?.id ?? null;
        const id = smsId ? `sms:${smsId}` : m.id;
        // Keep whichever copy already carries an arrival stamp; failing that,
        // the first seen. Never invent an arrival later than the send time,
        // or the repair would hide old messages from a reader mid-page.
        const kept = byId.get(id);
        const storedAt = typeof m.storedAt === 'number' ? m.storedAt : m.at;
        if (!kept || (kept.storedAt == null && storedAt != null)) {
          byId.set(id, { ...m, id, storedAt });
        }
      }
      const compacted = [...byId.values()].sort((a, b) => a.at - b.at).slice(-KEEP);
      await env.INBOX.put(INBOX_KEY, JSON.stringify(compacted));
      return json({ ok: true, before: inbox.length, after: compacted.length });
    }

    return json({ error: 'not found' }, 404);
  },
};
