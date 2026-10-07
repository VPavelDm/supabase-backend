-- Lyrics a provider refused to sing (Lyria's prohibited_content) are marked
-- on their job, with a fingerprint of the words. generate-song counts a
-- user's refusals over the last 24 hours and turns away the same lyrics
-- after 3, or anything from that user after 10, without asking the provider
-- again (functions/lyncil/generate-song.ts).
--
-- Idempotent like every migration here.

alter table lyncil.song_jobs add column if not exists lyrics_hash text;
alter table lyncil.song_jobs add column if not exists failure text;
alter table lyncil.song_jobs drop constraint if exists song_jobs_failure_check;
alter table lyncil.song_jobs add constraint song_jobs_failure_check
  check (failure in ('blocked'));

create index if not exists song_jobs_user_refusals_idx
  on lyncil.song_jobs (user_id, created_at) where failure = 'blocked';
