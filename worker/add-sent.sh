#!/usr/bin/env bash
#
# Add a message you sent by hand into DayFlow.
#
# SMSGate can only report what IT sent. Messages typed in the phone's own
# Messages app are invisible to it — there is no endpoint for them and no way
# to recover them automatically. For the handful sent that way while the
# gateway was being set up, this puts them in by hand.
#
# Usage:
#   ./add-sent.sh "+16476875450" "2026-08-29 14:30" "what you wrote"
#
# The time is read in your local timezone. Re-running with the same recipient,
# time and text changes nothing: the id is derived from those three, so the
# relay recognises it as one it already has.

set -euo pipefail

TO="${1:?recipient, e.g. +16476875450}"
WHEN="${2:?when you sent it, e.g. \"2026-08-29 14:30\"}"
TEXT="${3:?the message text}"

RELAY="https://dayflow-inbox.giveawaybot1225.workers.dev"
SECRET="473b71b56fd1d8224a42965ff4a15c2b515d4973a4fbcba0"

python3 - "$RELAY" "$SECRET" "$TO" "$WHEN" "$TEXT" <<'ADDPY'
import hashlib, json, sys, urllib.request
from datetime import datetime

relay, secret, to, when, text = sys.argv[1:6]

stamp = None
for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
    try:
        stamp = datetime.strptime(when, fmt).astimezone()
        break
    except ValueError:
        continue
if stamp is None:
    print(f'Could not read "{when}". Use e.g. "2026-08-29 14:30".')
    sys.exit(1)

# Deterministic id from the content, so re-running is harmless rather than
# creating a second copy of the same message.
key = f"{to}|{stamp.isoformat()}|{text}".encode()
msg_id = "manual-" + hashlib.sha256(key).hexdigest()[:16]

payload = {
    "event": "sms:sent",
    "id": msg_id,
    "dir": "out",
    "payload": {
        "messageId": msg_id,
        "message": text,
        # For a message we sent, the counterparty is the recipient.
        "sender": to,
        "receivedAt": stamp.isoformat(),
        "dir": "out",
    },
}
req = urllib.request.Request(
    f"{relay}/webhook/{secret}",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json", "user-agent": "dayflow-import/1.0"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=15) as resp:
    body = json.loads(resp.read() or b"{}")

if body.get("added"):
    print(f"Added: to {to} at {stamp:%Y-%m-%d %H:%M} — {text[:60]}")
else:
    print("Already present; nothing changed.")
ADDPY
