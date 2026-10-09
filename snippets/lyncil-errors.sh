#!/bin/zsh
# Lyncil errors on production, read-only: failed songs from the database and
# the lyncil function's own error messages and non-2xx answers from the logs.
#
#   ./snippets/lyncil-errors.sh          # last 48 hours
#   ./snippets/lyncil-errors.sh 12       # last 12 hours
#
# The database keeps every failed song; the logs only go back about a day,
# so older hours print as "no logs". Pavel's two test profiles are marked,
# not hidden. Uses the Supabase CLI's token from the Keychain.

REF=ttjzshiaatqvszckjlhw
TEST_PROFILES="'b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f'"
HOURS=${1:-48}
# Logs API windows: long ones answer "Backend error!", so the range is asked
# for a few hours at a time.
CHUNK_HOURS=3

RAW=$(security find-generic-password -s "Supabase CLI" -w) || { echo "No Supabase CLI token in the Keychain; run supabase login" >&2; exit 1; }
TOKEN=${RAW#go-keyring-base64:}
[[ "$RAW" == go-keyring-base64:* ]] && TOKEN=$(echo -n "$TOKEN" | base64 -d)

q() {
  echo "\n== $1"
  jq -n --arg q "$2" '{query:$q}' | curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- | jq -r '
      if type == "array" and length == 0 then "(none)"
      elif type == "array" then (.[0] | keys_unsorted | @tsv), (.[] | [.[] | if . == null then "-" else . end] | @tsv)
      else . end' | column -t -s $'\t'
}

WINDOW="created_at > now() - make_interval(hours => $HOURS)"
WHO="case when user_id in ($TEST_PROFILES) then 'test' else left(user_id::text, 8) end"

echo "Lyncil errors, last $HOURS h (UTC)"

q "Songs in the window" "
select count(*) as started, count(*) filter (where status = 'succeeded') as ok,
  count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'pending') as pending,
  count(*) filter (where retried_after is not null) as retried,
  count(*) filter (where retried_after is not null and status = 'succeeded') as rescued
from lyncil.song_jobs where provider <> 'staging' and $WINDOW"

q "Failed songs by reason" "
select coalesce(failure, '-') as failure, count(*) as jobs, count(distinct user_id) as users,
  count(*) filter (where user_id in ($TEST_PROFILES)) as test_jobs, max(left(error, 100)) as example_error
from lyncil.song_jobs where status = 'failed' and provider <> 'staging' and $WINDOW
group by 1 order by 2 desc"

q "Every failed song" "
select to_char(created_at, 'MM-DD HH24:MI') as started, $WHO as user_id, provider, coalesce(failure, '-') as failure,
  attempts, coalesce(retried_after, '-') as retried_after, coalesce(left(error, 90), '-') as error
from lyncil.song_jobs where status = 'failed' and provider <> 'staging' and $WINDOW
order by created_at"

# --- Logs ---------------------------------------------------------------

TMP=$(mktemp -t lyncil-errors)
trap 'rm -f "$TMP"' EXIT

# Request lines contain " | "; the function's own messages don't. The words
# below cover every console.error in functions/lyncil.
ERRORS="event_message not like '%|%' and (
  lower(event_message) like '%lyria%' or lower(event_message) like '%mureka%' or
  lower(event_message) like '%song%' or lower(event_message) like '%track%' or
  lower(event_message) like '%lyrics%' or lower(event_message) like '%openai%' or
  lower(event_message) like '%adapty%' or lower(event_message) like '%uncaught%' or
  lower(event_message) like '%timeout manager%')
  and event_message not like 'lyria song kept%' and event_message not like '[Lifecycle]%'"
REQUESTS="event_message like '%/functions/v1/lyncil/%' and event_message not like '%| 200 |%'"
SQL="select timestamp, event_message from logs where ($ERRORS) or ($REQUESTS) order by timestamp limit 1000"

echo "\n== Reading logs in $CHUNK_HOURS h windows"
empty=0
for (( back = HOURS; back > 0; back -= CHUNK_HOURS )); do
  START=$(date -u -v-${back}H +%Y-%m-%dT%H:%M:%SZ)
  next=$(( back - CHUNK_HOURS )); (( next < 0 )) && next=0
  END=$(date -u -v-${next}H +%Y-%m-%dT%H:%M:%SZ)
  # The logs API throttles quick runs of calls: wait between windows and
  # back off when it says Too Many Requests.
  for wait in 2 10 30; do
    sleep $wait
    out=$(curl -s -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" \
      -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL" \
      --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END")
    [[ "$out" == *ThrottlerException* ]] || break
  done
  if ! echo "$out" | jq -e '.result' >/dev/null 2>&1; then
    echo "  ${START[6,16]} → ${END[6,16]}: $(echo "$out" | jq -c '.error // .' 2>/dev/null | cut -c1-120)"
    continue
  fi
  n=$(echo "$out" | jq '.result | length')
  (( n == 0 )) && empty=$(( empty + 1 ))
  (( n >= 1000 )) && echo "  ${START[6,16]} → ${END[6,16]}: hit the 1000-line limit, some lines missing"
  echo "$out" | jq -c '.result[]' >> "$TMP"
done
(( empty > 0 )) && echo "  $empty windows had no matching lines (quiet, or older than the logs keep)"

echo "\n== Function errors, grouped (first words of the message)"
jq -rs '
  map(select(.event_message | test("\\|") | not))
  | map(. + {key: (.event_message | gsub("\\s+"; " ") | split(" ")[0:4] | join(" "))})
  | group_by(.key)
  | map({key: .[0].key, count: length, first: (map(.timestamp) | min)[5:16], last: (map(.timestamp) | max)[5:16]})
  | sort_by(-.count)
  | if length == 0 then "(none)" else (["count", "first", "last", "message"] | @tsv), (.[] | [.count, .first, .last, .key] | @tsv) end
' "$TMP" | column -t -s $'\t'

echo "\n== lyncil answers other than 200, by route and status"
jq -rs '
  map(select(.event_message | test("/functions/v1/lyncil/")))
  | map(.event_message | split(" | ") | {status: .[1], route: (.[2] | capture("/functions/v1/lyncil/(?<r>[^? ]+)").r // .[2])})
  | group_by([.route, .status])
  | map([.[0].route, .[0].status, length])
  | sort_by(-.[2])
  | if length == 0 then "(none)" else (["route", "status", "count"] | @tsv), (.[] | @tsv) end
' "$TMP" | column -t -s $'\t'

echo "\n== Latest 40 function errors (worker recycling left out)"
jq -rs '
  map(select((.event_message | test("\\|") | not) and (.event_message | test("timeout manager") | not)))
  | sort_by(.timestamp) | .[-40:]
  | if length == 0 then "(none)" else .[] | "\(.timestamp[5:19])  \(.event_message | gsub("\\s+"; " ") | .[0:200])" end
' "$TMP"
