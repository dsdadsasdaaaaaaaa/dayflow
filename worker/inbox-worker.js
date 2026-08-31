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

/** Most recent messages kept. Older ones fall off; the app has its own copy. */
const KEEP = 500;

/** One KV key holding the whole inbox as JSON. */
const INBOX_KEY = 'inbox';

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
  return {
    id:
      payload?.id ??
      p.messageId ??
      p.id ??
      `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: String(from),
    text: String(text),
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
      let added = 0;
      for (const message of incoming) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        inbox.push(message);
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
      const messages = inbox
        .filter((m) => (Number.isFinite(since) ? m.at >= since : true))
        .sort((a, b) => b.at - a.at)
        .slice(0, limit);
      return json({ messages });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      const inbox = await readInbox(env);
      return json({ ok: true, stored: inbox.length });
    }

    return json({ error: 'not found' }, 404);
  },
};
