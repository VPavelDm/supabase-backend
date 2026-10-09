#!/bin/zsh
# Who an outage hit, read-only: every user whose songs failed with a given
# error since a given time, and how they fared otherwise.
#
#   ./snippets/lyncil-outage-users.sh                              # the Lyria 402 outage of 2026-10-08
#   ./snippets/lyncil-outage-users.sh '2026-10-08 20:00' '%402%'   # since, error pattern
#
# Per user: failed attempts, when, songs finished before and after, whether
# they have ever had a song, and whether they arrived during the outage (the
# onboarding song is the first thing a new user tries). Pavel's two test
# profiles are marked. Uses the Supabase CLI linked to the Lyncil project.

set -euo pipefail
cd "$(dirname "$0")/.."

SINCE=${1:-2026-10-08 20:00}
PATTERN=${2:-%402%}
[[ "$SINCE" =~ '^[0-9: -]+$' ]] || { echo "since: a UTC time like '2026-10-08 20:00'" >&2; exit 1; }
[[ "$PATTERN" != *"'"* ]] || { echo "pattern: no quotes" >&2; exit 1; }

supabase db query --linked "
with hit as (
  select user_id, count(*) as failed, min(created_at) as first_fail, max(created_at) as last_fail
  from lyncil.song_jobs
  where status = 'failed' and error like '$PATTERN' and created_at >= '$SINCE'::timestamptz
  group by user_id)
select left(h.user_id::text, 8) as user_id,
  case when h.user_id in ('b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f')
    then 'test' when p.onboarded_at >= '$SINCE'::timestamptz then 'new' else '' end as note,
  h.failed,
  to_char(h.first_fail, 'MM-DD HH24:MI') as first_fail, to_char(h.last_fail, 'MM-DD HH24:MI') as last_fail,
  (select count(*) from lyncil.song_jobs j where j.user_id = h.user_id and j.status = 'succeeded'
     and j.created_at < h.first_fail) as ok_before,
  (select count(*) from lyncil.song_jobs j where j.user_id = h.user_id and j.status = 'succeeded'
     and j.created_at > h.last_fail) as ok_after,
  (select count(*) from lyncil.devices d where d.user_id = h.user_id) as push_devices
from hit h left join lyncil.profiles p on p.id = h.user_id
order by h.failed desc"

supabase db query --linked "
with hit as (
  select distinct user_id from lyncil.song_jobs
  where status = 'failed' and error like '$PATTERN' and created_at >= '$SINCE'::timestamptz)
select count(*) as users_hit,
  count(*) filter (where not exists (select 1 from lyncil.song_jobs j where j.user_id = h.user_id and j.status = 'succeeded'))
    as never_got_a_song,
  count(*) filter (where p.onboarded_at >= '$SINCE'::timestamptz) as arrived_during_outage,
  (select count(*) from lyncil.song_jobs where status = 'failed' and error like '$PATTERN'
     and created_at >= '$SINCE'::timestamptz) as failed_attempts,
  (select to_char(max(created_at), 'MM-DD HH24:MI') from lyncil.song_jobs where status = 'failed'
     and error like '$PATTERN' and created_at >= '$SINCE'::timestamptz) as latest_failure,
  (select to_char(max(created_at), 'MM-DD HH24:MI') from lyncil.song_jobs where status = 'succeeded'
     and provider <> 'staging') as latest_success
from hit h left join lyncil.profiles p on p.id = h.user_id"
