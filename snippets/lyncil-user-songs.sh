#!/bin/zsh
# One Lyncil user's songs on production, read-only.
#
#   ./snippets/lyncil-user-songs.sh                # who made more songs than the free plan allows
#   ./snippets/lyncil-user-songs.sh 515afbef       # one user: full id or its first characters
#
# The id is the Supabase auth uid, which is also the Adapty customer user id
# (lowercased), so it can be copied from the purchase in the Adapty
# dashboard. Uses the Supabase CLI's token from the Keychain.

REF=ttjzshiaatqvszckjlhw
USER_PREFIX=${1:l}

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

if [[ -z "$USER_PREFIX" ]]; then
  # The free plan allows 1 song per 7 days, so anyone with 2 finished songs
  # inside a week was on a plan (or is a test profile, marked).
  q "Users with more finished songs in a week than the free plan allows" "
  with ok as (
    select user_id, created_at from lyncil.song_jobs
    where status = 'succeeded' and provider <> 'staging')
  select left(a.user_id::text, 8) as user_id,
    case when a.user_id in ('b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f')
      then 'test' else '' end as note,
    (select count(*) from ok o where o.user_id = a.user_id) as songs,
    (select count(*) from lyncil.song_jobs j where j.user_id = a.user_id and j.status = 'failed') as failed,
    to_char(min(a.created_at), 'MM-DD HH24:MI') as first_song,
    to_char(max(a.created_at), 'MM-DD HH24:MI') as last_song
  from ok a
  where exists (select 1 from ok b where b.user_id = a.user_id and b.created_at > a.created_at
                and b.created_at < a.created_at + interval '7 days')
  group by a.user_id order by 3 desc"
  echo "\nPass one of these ids (or the uid from Adapty) to see that user's songs."
  exit 0
fi

if [[ ! "$USER_PREFIX" =~ '^[0-9a-f-]{4,36}$' ]]; then
  echo "Give the user id or its first characters (hex), e.g. 515afbef" >&2
  exit 1
fi

MATCH="user_id::text like '$USER_PREFIX%'"

q "Matching users (should be exactly one)" "
select p.id as user_id, to_char(p.onboarded_at, 'YYYY-MM-DD HH24:MI') as onboarded,
  to_char(u.created_at, 'YYYY-MM-DD HH24:MI') as signed_up
from lyncil.profiles p left join auth.users u on u.id = p.id
where p.id::text like '$USER_PREFIX%'"

q "Songs made (song_jobs)" "
select count(*) as started, count(*) filter (where status = 'succeeded') as finished,
  count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'succeeded' and created_at > now() - interval '7 days') as finished_last_7d,
  count(*) filter (where status = 'succeeded' and created_at > now() - interval '30 days') as finished_last_30d
from lyncil.song_jobs where $MATCH and provider <> 'staging'"

q "Every song attempt" "
select to_char(created_at, 'MM-DD HH24:MI') as started, kind, provider, status,
  coalesce(failure, '-') as failure, coalesce(retried_after, '-') as retried_after,
  coalesce(left(error, 60), '-') as error, left(coalesce(song_id::text, '-'), 8) as song
from lyncil.song_jobs where $MATCH order by created_at"

q "Library (lyncil.songs)" "
select count(*) filter (where deleted_at is null) as in_library,
  count(*) filter (where deleted_at is null and audio_file_name is not null) as with_track,
  count(*) filter (where deleted_at is null and audio_file_name is null) as lyrics_only,
  count(*) filter (where deleted_at is not null) as deleted
from lyncil.songs where $MATCH"

q "Thumbs-down feedback" "
select to_char(created_at, 'MM-DD HH24:MI') as sent, coalesce(array_to_string(reasons, ', '), '-') as reasons,
  case when text <> '' then 'yes' else 'no' end as note
from lyncil.song_feedback where $MATCH order by created_at"
