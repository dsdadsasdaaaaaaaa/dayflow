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

4. **Check it.** Visit `https://<your-worker>.workers.dev/health` — it should
   answer `{"ok":true,"stored":0}`. Text the SIM from another phone, reload,
   and `stored` should become 1.

5. **Connect DayFlow.** Settings → Messaging & calls → Own SIM. You need the
   username and password from the SMSGate app's Home tab, the Worker URL, the
   shared secret, and the SIM's own number.

   DayFlow registers the `sms:received` webhook with SMSGate itself on
   connect. If that fails it says so and shows the exact URL to add by hand —
   the secret goes in the path because SMSGate lets you configure a URL but
   not headers.

## What it does not do

- **No MMS.** SMSGate cannot send picture messages. DayFlow keeps Telerivet
  connected for photos alone, which then costs one API call per photo and is
  never polled.
- **No delivery receipts.** Only received messages are stored, so a sent
  message stays at "sent" rather than settling to "delivered".
- **Last 500 messages.** Older ones fall off the relay; DayFlow keeps its own
  copy, so this only bounds how far a fresh install can backfill.

## Bringing over history from before SMSGate

SMSGate only remembers what it has handled, so its inbox starts the day it was
installed, and it never sees a message sent from the phone's own Messages app.
Everything older lives in Android's SMS database and has to come from a backup:

1. Install **SMS Backup & Restore** (SyncTech) on the phone with the SIM.
2. Back up **messages only**, to local storage.
3. Copy the `sms-*.xml` file to this computer.
4. `./import-backup.sh ~/Downloads/sms-20260831.xml`
5. In DayFlow: Settings → Own SIM → **Re-sync all messages**.

Both directions come across, so threads read as conversations rather than as
one side of one. Re-running it adds nothing, so it is safe to repeat after
each backup.

## Repairing an older relay

Records written before message ids were keyed on the SMS's own id are stored
twice, once per webhook retry. Collapse them:

```
curl -X POST -H "Authorization: Bearer $SHARED_SECRET" \
  https://YOUR-WORKER.workers.dev/compact
```

It reports how many records it started and finished with, and is safe to run
more than once.

## The weekly school schedule email

DayFlow cannot watch a mailbox and this relay cannot receive email, so the
fetching is done by a short Apps Script running inside the Google account that
already has the mail — the one place that needs no credentials, because it is
already signed in as you. It posts the newest schedule email to
`POST /schedule/<secret>`; the app reads it from `GET /schedule`.

Only the newest is kept. A schedule is a statement about one week, and last
week's is not history, it is just wrong.

Setup is in the header comment of `schedule-forwarder.gs`.
