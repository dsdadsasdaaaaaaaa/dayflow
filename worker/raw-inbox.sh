#!/usr/bin/env bash
# Show exactly what the phone's /inbox returns: headers, status, body length.
# The importer saw a 200 with an empty body where the probe saw data, so this
# prints everything rather than summarising it.
IP="${1:?phone IP}"; IP="${IP%%:*}"; USER="${2:?user}"; PASS="${3:?pass}"
for Q in "" "?limit=500" "?limit=50&offset=0"; do
  echo "=== GET /inbox${Q} ==="
  curl -sS -i --max-time 15 -u "${USER}:${PASS}" "http://${IP}:8080/inbox${Q}" \
    | head -c 700
  echo; echo
done
