#!/usr/bin/env bash
#
# One-time import of the Android gateway's existing SMS into the relay.
#
# Why this exists: a webhook fires once, when a text arrives, so anything
# received before the relay was wired up was never sent anywhere. SMSGate can
# replay its inbox (POST /inbox/refresh) but only ONCE per message — after
# that the device treats them as already handled and skips them, and there is
# no documented way to reset that.
#
# GET /inbox is not subject to that: it just lists what the phone holds. The
# catch is that it only exists in Local Server mode, so this has to run on the
# same wifi as the Android phone. It reads the history straight off the phone
# and posts it into the relay in the shape the webhook would have used.
#
# Safe to re-run: the relay deduplicates by message id.
#
# Usage:
#   ./import-history.sh 192.168.2.33 sms MyPassword 90
#
# The IP and the LOCAL username/password are shown in the SMSGate app once
# Local Server mode is switched on. They are not the cloud credentials.
# No angle brackets — pass the values themselves.

set -euo pipefail

IP="${1:?phone IP, e.g. 192.168.1.42}"
USER="${2:?local username from the SMSGate app}"
PASS="${3:?local password from the SMSGate app}"
DAYS="${4:-90}"

RELAY="https://dayflow-inbox.giveawaybot1225.workers.dev"
SECRET="473b71b56fd1d8224a42965ff4a15c2b515d4973a4fbcba0"
# Strip a port if one was pasted in with the address.
IP="${IP%%:*}"

FROM=$(python3 -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=$DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ'))")

# The local server's base path is not documented consistently — the OpenAPI
# spec lists one thing and the app another — so try the plausible ones and
# keep whichever actually answers, rather than guessing and failing opaquely.
BASES=(
  "http://${IP}:8080/api/3rdparty/v1"
  "http://${IP}:8080/3rdparty/v1"
  "http://${IP}:8080/api"
  "http://${IP}:8080/api/v1"
  "http://${IP}:3000/api"
)

echo "Looking for the gateway on ${IP}…"
LOCAL=""
for B in "${BASES[@]}"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 -u "${USER}:${PASS}" "${B}/inbox?limit=1" || true)
  echo "  ${B} -> ${CODE:-no response}"
  if [ "$CODE" = "200" ]; then LOCAL="$B"; break; fi
done

if [ -z "$LOCAL" ]; then
  echo
  echo "Could not find the gateway API on ${IP}."
  echo "Check that you are on the same wifi as the phone, that Local Server"
  echo "mode is switched on in SMSGate, and that the address and the LOCAL"
  echo "username/password (they differ from the cloud ones) are right."
  exit 1
fi

echo "Using ${LOCAL}"
echo "Reading inbox (last ${DAYS} days)…"
BODY=$(curl -sS --max-time 20 -u "${USER}:${PASS}" "${LOCAL}/inbox?limit=500&from=${FROM}")

echo "$BODY" | python3 - "$RELAY" "$SECRET" <<'PY'
import json, sys, urllib.request

relay, secret = sys.argv[1], sys.argv[2]
raw = sys.stdin.read()
try:
    rows = json.loads(raw)
except json.JSONDecodeError:
    print("The phone did not return JSON. It answered:\n" + raw[:300])
    sys.exit(1)
if isinstance(rows, dict):
    rows = rows.get("data") or rows.get("messages") or []
if not rows:
    print("The phone reported no messages in that range.")
    sys.exit(0)

print(f"Found {len(rows)} message(s). Sending to the relay…")
sent = added = 0
for r in rows:
    # Rebuild the sms:received envelope the relay already understands, so it
    # needs no special case for imported history.
    payload = {
        "event": "sms:received",
        "id": r.get("id"),
        "payload": {
            "messageId": r.get("id"),
            "message": r.get("contentPreview") or "",
            "sender": r.get("sender") or "",
            "recipient": r.get("recipient") or "",
            "receivedAt": r.get("createdAt"),
        },
    }
    req = urllib.request.Request(
        f"{relay}/webhook/{secret}",
        data=json.dumps(payload).encode(),
        headers={
            "content-type": "application/json",
            # Cloudflare's edge blocks the default Python-urllib agent as a
            # bot (error 1010) before the Worker ever sees the request, which
            # looks exactly like a rejected secret.
            "user-agent": "dayflow-import/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read() or b"{}")
            sent += 1
            added += int(body.get("added") or 0)
    except Exception as e:
        print(f"  failed for {r.get('id')}: {e}")

print(f"Sent {sent}, newly stored {added} (the rest were already there).")
PY

echo
echo "Relay now holds:"
curl -sS "${RELAY}/health"
echo
