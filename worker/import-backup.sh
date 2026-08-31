#!/usr/bin/env bash
#
# Import an Android SMS backup into the relay.
#
# Why this exists on top of import-history.sh: SMSGate only remembers what it
# has handled, so its inbox starts the day it was installed. Anything older —
# and every message sent from the phone's own Messages app, which SMSGate
# never sees at all — lives only in Android's SMS database. The relay's
# history stopped dead at the install date for exactly that reason.
#
# The export comes from "SMS Backup & Restore" (SyncTech), which is free and
# writes a plain XML file:
#
#   1. Install it on the Android phone with the SIM.
#   2. Set up a backup, MESSAGES only, "Local backup" to the phone.
#   3. Copy the resulting sms-YYYYMMDDHHMMSS.xml off the phone.
#   4. ./import-backup.sh ~/Downloads/sms-20260831.xml
#
# Both directions come across, so threads read as conversations. Safe to
# re-run: ids are derived from the message itself, so a second pass adds
# nothing.
#
# Add a day count to limit how far back to go (default: everything):
#   ./import-backup.sh ~/Downloads/sms-20260831.xml 365

set -euo pipefail

FILE="${1:?path to the sms-*.xml file from SMS Backup & Restore}"
DAYS="${2:-0}"

RELAY="https://dayflow-inbox.giveawaybot1225.workers.dev"
SECRET="473b71b56fd1d8224a42965ff4a15c2b515d4973a4fbcba0"

[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }

python3 - "$FILE" "$DAYS" "$RELAY" "$SECRET" <<'PY'
import calendar, hashlib, json, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

path, days, relay, secret = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
floor_ms = 0 if days <= 0 else int((time.time() - days * 86400) * 1000)

# iterparse rather than parse: a few years of texts is a large file and there
# is no reason to hold all of it in memory at once.
records, skipped_mms, seen = [], 0, set()
for _, el in ET.iterparse(path, events=("end",)):
    tag = el.tag
    if tag == "mms":
        skipped_mms += 1
        el.clear()
        continue
    if tag != "sms":
        continue
    a = el.attrib
    el.clear()
    body = a.get("body") or ""
    address = (a.get("address") or "").strip()
    if not address or not body:
        continue
    try:
        at = int(a.get("date") or 0)
    except ValueError:
        continue
    if at <= 0 or at < floor_ms:
        continue
    # type 1 is received, 2 is sent. 3 is a draft and 5/6 are failures, none
    # of which ever reached anyone, so none of them belong in a transcript.
    kind = a.get("type")
    if kind not in ("1", "2"):
        continue
    direction = "in" if kind == "1" else "out"
    # Derived from the message, not from the export, so re-running the backup
    # tomorrow produces the same ids and adds nothing.
    key = "|".join([direction, address, str(at), body])
    mid = "bk-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    if mid in seen:
        continue
    seen.add(mid)
    records.append({
        "messageId": mid,
        "message": body,
        # `phoneNumber` is the OTHER party in both directions. The relay keys
        # a thread on it, and a sent message filed under our own number would
        # start a conversation with ourselves.
        "phoneNumber": address,
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(at / 1000)),
        "dir": direction,
    })

ins = sum(1 for r in records if r["dir"] == "in")
print(f"Read {len(records)} messages ({ins} received, {len(records) - ins} sent)"
      + (f", skipped {skipped_mms} picture messages" if skipped_mms else ""))
if not records:
    sys.exit(0)


def read_relay():
    """Everything the relay already holds, paged oldest-ward.

    The relay ids a webhook by the gateway's own message id, which nothing in
    a backup can reproduce — so without this every received message would be
    stored a second time under a backup id. The app collapses those on
    content and the threads would still read correctly, but the relay keeps
    only so many records, and spending half of them on second copies is what
    pushes real messages off the end.
    """
    seen, before = [], None
    while True:
        q = f"{relay}/messages?limit=500" + (f"&before={before}" if before else "")
        req = urllib.request.Request(
            q, headers={"authorization": f"Bearer {secret}", "user-agent": "dayflow-import/1"}
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            page = json.loads(res.read().decode("utf-8")).get("messages", [])
        stamps = [m["storedAt"] for m in page if isinstance(m.get("storedAt"), (int, float))]
        fresh = [m for m in page if before is None or (m.get("storedAt") or 0) < before]
        if not fresh:
            break
        seen.extend(fresh)
        # A relay too old to page backwards ignores `before` and would hand
        # back the same records for ever. One page is all it can offer.
        if not stamps:
            break
        before = min(stamps)
    return seen


def digits(num):
    d = "".join(c for c in str(num) if c.isdigit())
    return d[-10:] if len(d) >= 10 else d


held = {}
try:
    for m in read_relay():
        key = (m.get("dir") or "in", digits(m.get("from")), (m.get("text") or "").strip())
        held.setdefault(key, []).append(m.get("at") or 0)
except urllib.error.HTTPError as e:
    print(f"Could not read the relay first ({e.code}); importing without it.")

# Two clocks are involved — Android's and the gateway's — so the same text
# can carry stamps a few seconds apart. Same words, same person, same
# direction, within five minutes is the same message.
SLACK_MS = 5 * 60 * 1000
kept = []
for r in records:
    # timegm, not mktime: the stamp is UTC and mktime would read it as local,
    # which in summer is off by the DST hour — far enough to miss every match.
    at = calendar.timegm(time.strptime(r["receivedAt"], "%Y-%m-%dT%H:%M:%SZ")) * 1000
    key = (r["dir"], digits(r["phoneNumber"]), r["message"].strip())
    if any(abs(at - t) <= SLACK_MS for t in held.get(key, ())):
        continue
    kept.append(r)

if len(kept) != len(records):
    print(f"{len(records) - len(kept)} already in the relay; {len(kept)} to add")
records = kept
if not records:
    print("Nothing new to send.")
    sys.exit(0)

# Oldest first, so if the relay's cap is reached the newest survive.
records.sort(key=lambda r: r["receivedAt"])

BATCH = 100
added = 0
for i in range(0, len(records), BATCH):
    chunk = records[i:i + BATCH]
    body = json.dumps({"messages": chunk}).encode("utf-8")
    req = urllib.request.Request(
        f"{relay}/webhook/{secret}",
        data=body,
        # Cloudflare rejects Python's default agent outright, which reads
        # exactly like a rejected secret. Say something else.
        headers={"content-type": "application/json", "user-agent": "dayflow-import/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            out = json.loads(res.read().decode("utf-8"))
        added += out.get("added", 0)
        print(f"  {i + len(chunk)}/{len(records)} sent, {added} new so far")
    except urllib.error.HTTPError as e:
        print(f"  relay refused batch at {i}: {e.code} {e.read().decode('utf-8')[:200]}")
        sys.exit(1)

print(f"\nDone. {added} new messages in the relay.")
print("Now open DayFlow: Settings -> Own SIM -> Re-sync all messages.")
PY
