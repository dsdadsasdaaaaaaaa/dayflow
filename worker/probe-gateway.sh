#!/usr/bin/env bash
#
# Discover the SMSGate local server's API path.
#
# The local base path is not published anywhere reliable: the cloud OpenAPI
# spec describes the endpoints but not where the on-device server mounts
# them, and there is no separate local spec. Rather than guess again, this
# asks the phone what it actually serves.
#
# Usage: ./probe-gateway.sh 192.168.2.33 sms MyPassword

set -uo pipefail
IP="${1:?phone IP}"; IP="${IP%%:*}"
USER="${2:?local username}"
PASS="${3:?local password}"

for PORT in 8080 8081 3000; do
  echo "=== port ${PORT} ==="
  for PATH_ in "" "/" "/api" "/health" "/inbox" "/messages" \
               "/3rdparty/v1/inbox" "/api/3rdparty/v1/inbox" \
               "/v1/inbox" "/api/v1/inbox" "/api/inbox" "/openapi.json" "/swagger.json"; do
    OUT=$(curl -s --max-time 5 -u "${USER}:${PASS}" -w "\n%{http_code}" "http://${IP}:${PORT}${PATH_}" 2>/dev/null)
    CODE=$(printf '%s' "$OUT" | tail -1)
    BODY=$(printf '%s' "$OUT" | sed '$d' | tr -d '\n' | cut -c1-110)
    [ -z "$CODE" ] && CODE="---"
    printf '  %-28s %s  %s\n' "${PATH_:-/}" "$CODE" "$BODY"
  done
done
