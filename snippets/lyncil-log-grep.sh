#!/bin/zsh
# Production logs containing one phrase, over a short window, read-only.
#
#   ./snippets/lyncil-log-grep.sh 'lyria render failed' '2026-10-10 20:40' '2026-10-10 21:00'
#
# Times are UTC; keep the window short (an hour or less): the logs API
# answers wide or heavy queries with nothing or "Backend error!". Logs are
# kept for about a day. The project is shared with futura and treddy, so a
# phrase from the lyncil function's own messages works best. Uses the
# Supabase CLI's token from the Keychain.

REF=ttjzshiaatqvszckjlhw
PHRASE=${1:?phrase to look for}
FROM=${2:?start, UTC, like '2026-10-10 20:40'}
TO=${3:?end, UTC}
[[ "$PHRASE" != *"'"* ]] || { echo "phrase: no single quotes" >&2; exit 1; }

RAW=$(security find-generic-password -s "Supabase CLI" -w) || { echo "No Supabase CLI token in the Keychain; run supabase login" >&2; exit 1; }
TOKEN=${RAW#go-keyring-base64:}
[[ "$RAW" == go-keyring-base64:* ]] && TOKEN=$(echo -n "$TOKEN" | base64 -d)

iso() { date -u -j -f "%Y-%m-%d %H:%M" "$1" +%Y-%m-%dT%H:%M:00Z 2>/dev/null || { echo "bad time: $1" >&2; exit 1; }; }
START=$(iso "$FROM"); END=$(iso "$TO")

SQL="select timestamp, event_message from logs where event_message like '%${PHRASE}%' order by timestamp limit 100"
OUT=$(mktemp -t lyncil-log-grep); trap 'rm -f "$OUT"' EXIT
STATUS=$(curl -s -o "$OUT" -w "%{http_code}" -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL" \
  --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END")

if [[ "$STATUS" != 200 ]] || ! jq -e '.result' "$OUT" >/dev/null 2>&1; then
  echo "Logs API answered HTTP $STATUS: $(head -c 300 "$OUT")"
  exit 1
fi
jq -r 'if (.result | length) == 0 then "(nothing for that phrase and window)"
  else .result[] | "\(.timestamp[0:19])  \(.event_message | gsub("\\s+"; " ") | .[0:1500])" end' "$OUT"
