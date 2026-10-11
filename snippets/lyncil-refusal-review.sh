#!/bin/zsh
# What the songs Lyria refused or rejected had in common, read-only: refusal
# rates by artist choice and length, then every refused or rejected song
# with the inputs that produced its lyrics (idea, artist, genre, mood) and
# the lyrics themselves, for working on the lyrics prompt.
#
#   ~/Developer/supabase-backend/snippets/lyncil-refusal-review.sh            # summaries + one line per song
#   ~/Developer/supabase-backend/snippets/lyncil-refusal-review.sh <task>     # one song's idea and lyrics in full
#
# Counts real Lyria songs only: no staging samples, no 402 billing outage,
# no test profiles. Lyrics are users' private writing: read them here, don't
# copy them anywhere else. Uses the Supabase CLI linked to the Lyncil project.

set -euo pipefail
cd "$(dirname "$0")/.."

BASE="from lyncil.song_jobs j join lyncil.songs s on s.id = j.song_id
  where j.provider = 'google' and j.kind = 'song' and coalesce(j.error, '') not like '%402%'
    and j.status in ('succeeded', 'failed')
    and j.user_id not in ('b260fc15-7620-4040-a4da-803db20a8ce3', 'c4ce1019-653e-46b2-8bf8-43dce994566f')"
# A song Lyria refused at least once: failed as blocked, or rescued by the retry.
REFUSED="(j.failure = 'blocked' or j.retried_after = 'blocked')"

echo "== Refusals by artist choice (an empty artist means the prompt's default, Taylor Swift)"
supabase db query --linked "
select case when coalesce(trim(s.artist), '') = '' then '(default)' else 'chosen' end as artist,
  count(*) as songs, count(*) filter (where $REFUSED) as refused_once,
  count(*) filter (where j.failure is not null and j.failure <> 'blocked') as other_failures
$BASE group by 1 order by 1"

echo "\n== Refusals by lyrics length"
supabase db query --linked "
select case when length(s.lyrics) < 1500 then 'a <1500' when length(s.lyrics) < 2500 then 'b 1500-2500'
  else 'c 2500+' end as chars,
  count(*) as songs, count(*) filter (where $REFUSED) as refused_once
$BASE group by 1 order by 1"

if [[ -n "${1:-}" ]]; then
  [[ "$1" =~ '^[A-Za-z0-9:-]+$' ]] || { echo "task: the id from the list, e.g. lyria-sync:1a2b" >&2; exit 1; }
  echo "\n== $1"
  supabase db query --linked "
  select coalesce(j.failure, '-') as failure, coalesce(j.retried_after, '-') as retried_after, coalesce(j.error, '-') as error,
    coalesce(nullif(trim(s.artist), ''), '(default)') as artist, coalesce(s.genre, '-') as genre, coalesce(s.mood, '-') as mood,
    s.prompt as idea, s.lyrics
  $BASE and j.task_id like '$1%' limit 1"
  exit 0
fi

echo "\n== Every song Lyria refused or rejected (pass a task id to see its lyrics)"
supabase db query --linked "
select left(j.task_id, 19) as task, to_char(j.created_at, 'MM-DD HH24:MI') as started, j.status,
  coalesce(j.failure, '-') as failure, coalesce(j.retried_after, '-') as retried_after,
  coalesce(left(j.error, 60), '-') as error,
  coalesce(nullif(trim(s.artist), ''), '(default)') as artist, coalesce(s.genre, '-') as genre,
  coalesce(s.mood, '-') as mood, length(s.lyrics) as chars,
  left(regexp_replace(s.prompt, '\\s+', ' ', 'g'), 70) as idea
$BASE and ($REFUSED or (j.status = 'failed'))
order by j.created_at"
