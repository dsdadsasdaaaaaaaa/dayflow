# DayFlow inbox relay

A ~130 line Cloudflare Worker that lets DayFlow receive SMS from your own SIM
without paying anyone.

## Why this exists

SMSGate turns an Android phone into an SMS gateway. Its cloud is free and can
**send** from anywhere, but it only delivers **received** messages by webhook —
and DayFlow is a phone app with no server to receive one. Its pollable
`/inbox` endpoint works only on the same wifi as the Android phone, which is
no use when you are out.

This Worker is the missing piece: it catches those webhooks, keeps the
messages, and lets DayFlow poll for them. Everything sits inside Cloudflare's
free tier — polling every few seconds is roughly 14k requests a day against a
100k allowance, and each received message is one KV write against 1k.

A side effect worth having: your messages pass through infrastructure you
control rather than a third party's.

## Setup

1. **Create the Worker.** In the Cloudflare dashboard: Workers & Pages →
   Create → Worker. Name it something like `dayflow-inbox`. Deploy the
   placeholder, then Edit code, paste in `inbox-worker.js`, and deploy.

2. **Add KV storage.** Storage & Databases → KV → Create namespace, call it
   `dayflow-inbox`. Back in the Worker: Settings → Bindings → Add → KV
   namespace, with the variable name **`INBOX`** (exactly that) pointed at the
   namespace.

3. **Add the secret.** Settings → Variables and Secrets → Add → Secret, named
   **`SHARED_SECRET`**. Use a long random string. Generate one with:

   ```
   openssl rand -hex 24
   ```

   Keep it: DayFlow needs the same value.

4. **Point SMSGate at it.** In the SMSGate app, add a webhook for the
   `sms:received` event with the URL:

   ```
   https://<your-worker>.workers.dev/webhook/<SHARED_SECRET>
   ```

   The secret is in the path because the app only lets you configure a URL,
   not headers.

5. **Check it.** Visit `https://<your-worker>.workers.dev/health` — it should
   answer `{"ok":true,"stored":0}`. Text the SIM from another phone, reload,
   and `stored` should become 1.

6. **Connect DayFlow.** Settings → Messaging & calls → Own SIM. You need the
   username and password from the SMSGate app's Home tab, the Worker URL, the
   shared secret, and the SIM's own number.

## What it does not do

- **No MMS.** SMSGate cannot send picture messages. DayFlow keeps Telerivet
  connected for photos alone, which then costs one API call per photo and is
  never polled.
- **No delivery receipts.** Only received messages are stored, so a sent
  message stays at "sent" rather than settling to "delivered".
- **Last 500 messages.** Older ones fall off the relay; DayFlow keeps its own
  copy, so this only bounds how far a fresh install can backfill.
