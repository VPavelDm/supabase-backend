#!/bin/zsh
# Song health on production, read-only: success rate per song and per user,
# how many users recovered from a failure, and what the failures were.
#
#   ~/Developer/supabase-backend/snippets/lyncil-health.sh        # last 3 days
#   ~/Developer/supabase-backend/snippets/lyncil-health.sh 7      # last 7 days
#
# A song is one generate-song job; one the automatic retry rescued counts as
# a success (and is listed under "rescued"). A user "recovered" when a song
# of theirs succeeded after their first failure in the window, by the retry
# or by trying again; "lost" users only ever failed. Real Lyria songs only:
# no staging samples, no test profiles. "excl. 402" leaves out the Google
# billing outage of 2026-10-08/09. Uses the Supabase CLI linked to Lyncil.

set -euo pipefail
cd "$(dirname "$0")/.."

DAYS=${1:-3}
[[ "$DAYS" =~ '^[0-9]+$' ]] || { echo "days: a whole number" >&2; exit 1; }

JOBS="select * from lyncil.song_jobs
  where provider <> 'staging' and status in ('succeeded', 'failed')
    and user_id not in ('b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f')
    and created_at > now() - make_interval(days => $DAYS)"

# Songs and users for one set of jobs ($1 = label, $2 = extra filter).
summary() {
  echo "\n== $1"
  supabase db query --linked "
  with j as ($JOBS $2),
  u as (
    select user_id, count(*) filter (where status = 'succeeded') as ok,
      count(*) filter (where status = 'failed') as failed,
      min(created_at) filter (where status = 'failed') as first_fail,
      max(created_at) filter (where status = 'succeeded') as last_ok,
      bool_or(status = 'succeeded' and retried_after is not null) as rescued
    from j group by user_id)
  select
    (select count(*) from j) as songs,
    (select count(*) from j where status = 'succeeded') as ok,
    (select count(*) from j where status = 'failed') as failed,
    (select round(100.0 * count(*) filter (where status = 'succeeded') / nullif(count(*), 0), 1) from j) as song_ok_pct,
    (select count(*) from j where status = 'succeeded' and retried_after is not null) as rescued_by_retry,
    count(*) as users,
    count(*) filter (where ok > 0) as users_with_song,
    round(100.0 * count(*) filter (where ok > 0) / nullif(count(*), 0), 1) as user_ok_pct,
    count(*) filter (where failed > 0 or rescued) as users_hit_failure,
    count(*) filter (where (failed > 0 and last_ok > first_fail) or (failed = 0 and rescued)) as recovered,
    count(*) filter (where failed > 0 and ok = 0) as lost
  from u"
}

summary "Last $DAYS days, everything" ""
summary "Last $DAYS days, excl. the 402 billing outage" "and coalesce(error, '') not like '%402%'"

echo "\n== Per day (UTC), excl. 402"
supabase db query --linked "
with j as ($JOBS and coalesce(error, '') not like '%402%')
select created_at::date as day, count(*) as songs,
  count(*) filter (where status = 'succeeded') as ok,
  count(*) filter (where status = 'failed') as failed,
  round(100.0 * count(*) filter (where status = 'succeeded') / count(*), 1) as ok_pct,
  count(*) filter (where retried_after is not null and status = 'succeeded') as rescued,
  count(distinct user_id) as users,
  count(distinct user_id) filter (where status = 'failed') as users_failing
from j group by 1 order by 1"

echo "\n== Why songs failed (everything)"
supabase db query --linked "
with j as ($JOBS)
select coalesce(failure, '(none recorded)') as failure,
  coalesce(substring(error from 'returned (\\d{3}(?: \\w+)?)'), substring(error from 'lyrics: (\\w+)'), '-') as code,
  count(*) as songs, count(distinct user_id) as users,
  count(*) filter (where retried_after is not null) as after_retry,
  to_char(min(created_at), 'MM-DD HH24:MI') as first, to_char(max(created_at), 'MM-DD HH24:MI') as last,
  max(left(error, 70)) as example
from j where status = 'failed' group by 1, 2 order by 3 desc"

echo "\n== Automatic retry"
supabase db query --linked "
with j as ($JOBS)
select retried_after as retried_after, count(*) as retried,
  count(*) filter (where status = 'succeeded') as rescued,
  count(*) filter (where status = 'failed') as failed_again
from j where retried_after is not null group by 1 order by 2 desc"
