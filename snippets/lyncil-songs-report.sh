#!/bin/zsh
# Text-to-music on production, read-only: how many songs were started,
# finished and failed (and why), per day and per user, plus the thumbs-down
# feedback and the last hours of the lyncil function's song messages.
#
#   ./snippets/lyncil-songs-report.sh          # logs: last 6 hours
#   ./snippets/lyncil-songs-report.sh 2        # logs: last 2 hours
#
# Pavel's two test profiles (the ones lyncil-reset-test-songs.sh wipes) and
# staging sample rows are left out of everything. Uses the Supabase CLI's
# token from the Keychain. The failure reasons, retries and stored errors
# need migration 20261008120000; rows from before it carry no reason.

REF=ttjzshiaatqvszckjlhw
TEST_PROFILES="'b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f'"
LOG_HOURS=${1:-6}

RAW=$(security find-generic-password -s "Supabase CLI" -w) || { echo "No Supabase CLI token in the Keychain; run supabase login" >&2; exit 1; }
TOKEN=${RAW#go-keyring-base64:}
[[ "$RAW" == go-keyring-base64:* ]] && TOKEN=$(echo -n "$TOKEN" | base64 -d)

REAL="from lyncil.song_jobs where provider <> 'staging' and user_id not in ($TEST_PROFILES)"

q() {
  echo "\n== $1"
  jq -n --arg q "$2" '{query:$q}' | curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @- | jq -r '
      if type == "array" and length == 0 then "(none)"
      elif type == "array" then (.[0] | keys_unsorted | @tsv), (.[] | [.[] | if . == null then "-" else . end] | @tsv)
      else . end' | column -t -s $'\t'
}

q "Totals by provider" "
select provider, count(*) as started,
  count(*) filter (where status = 'succeeded') as ok,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'pending') as pending,
  round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*) filter (where status <> 'pending'), 0), 1) as ok_pct,
  count(distinct user_id) as users
$REAL group by 1 order by 1"

q "Per day (UTC)" "
select created_at::date as day, provider, count(*) as started,
  count(*) filter (where status = 'succeeded') as ok,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where retried_after is not null and status = 'succeeded') as rescued,
  round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*) filter (where status <> 'pending'), 0), 1) as ok_pct,
  count(distinct user_id) as users
$REAL group by 1, 2 order by 1, 2"

q "Why songs failed" "
select coalesce(failure, '(no reason, before 2026-10-08)') as failure, count(*) as jobs,
  count(distinct user_id) as users, max(left(error, 90)) as example_error
$REAL and status = 'failed' group by 1 order by 2 desc"

q "Automatic retries (one per song)" "
select retried_after, count(*) as retried,
  count(*) filter (where status = 'succeeded') as rescued,
  count(*) filter (where status = 'failed') as failed_again,
  count(*) filter (where status = 'pending') as running
$REAL and retried_after is not null group by 1 order by 2 desc"

q "Users" "
with u as (
  select user_id, count(*) filter (where status = 'succeeded') as ok, count(*) filter (where status = 'failed') as failed
  $REAL group by 1)
select count(*) as users, count(*) filter (where ok > 0) as got_a_song,
  count(*) filter (where ok = 0 and failed > 0) as only_failures,
  count(*) filter (where ok > 1) as more_than_one_song, max(ok) as most_songs_one_user
from u"

q "Songs per user" "
select ok as songs_made, count(*) as users from (
  select user_id, count(*) filter (where status = 'succeeded') as ok $REAL group by 1) s
group by 1 order by 1"

q "Stuck: pending for more than 15 minutes" "
select provider, count(*) as jobs, to_char(min(created_at), 'MM-DD HH24:MI') as oldest
$REAL and status = 'pending' and coalesce(attempt_started_at, created_at) < now() - interval '15 minutes'
group by 1"

q "Thumbs-down feedback" "
select coalesce(provider, '-') as provider, count(distinct f.id) as sends,
  count(distinct f.id) filter (where text <> '') as with_note,
  coalesce(string_agg(distinct r, ', '), '-') as reasons
from lyncil.song_feedback f left join lateral unnest(f.reasons) r on true
where user_id not in ($TEST_PROFILES) group by 1"

# Request lines, auth and cron logs crowd out the function's own messages, so
# only those are asked for, over a short window (long ones answer "Backend
# error!"). Logs are kept for about a day.
echo "\n== lyncil song messages, last $LOG_HOURS h"
START=$(date -u -v-${LOG_HOURS}H +%Y-%m-%dT%H:%M:%SZ); END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SQL="select timestamp, event_message from logs where (lower(event_message) like '%lyria%' or lower(event_message) like '%song%') and event_message not like '%|%' order by timestamp desc limit 100"
curl -s -G "https://api.supabase.com/v1/projects/$REF/analytics/endpoints/logs" \
  -H "Authorization: Bearer $TOKEN" --data-urlencode "sql=$SQL" \
  --data-urlencode "iso_timestamp_start=$START" --data-urlencode "iso_timestamp_end=$END" |
  jq -r 'if .result then (if (.result | length) == 0 then "(none)" else .result[] | "\(.timestamp[0:19])  \(.event_message | gsub("\n"; " ") | .[0:220])" end) else . end'
