-- Every failed song now says why (failure + error), and a sync Lyria song
-- that failed in a way another go can fix gets one more go by itself
-- (functions/lyncil/generate-song.ts). On 2026-10-07 the 4 failures out of
-- 16 were 2 Lyria refusals and 2 songs cut off with their worker; each user
-- who tried again got a song.
--
--   failure      blocked (refused lyrics), cut_off (worker shut down),
--                lost (pending past the give-up, the worker left no word),
--                timeout, error, start_failed / busy (the provider didn't
--                take the start: those rows used to be deleted)
--   error        the provider's or runtime's own words, shortened
--   attempts     1, or 2 once retried
--   attempt_started_at  when the running attempt began (the give-up and the
--                pending reuse go by it; created_at stays the start the
--                allowance counts)
--   retried_after  the failure the retry was for, kept for counting rescues
--   request      what the provider is asked, kept only while a retry can
--                still need it
--
-- Idempotent like every migration here.

alter table lyncil.song_jobs add column if not exists error text;
alter table lyncil.song_jobs add column if not exists attempts int not null default 1;
alter table lyncil.song_jobs add column if not exists attempt_started_at timestamptz;
alter table lyncil.song_jobs add column if not exists retried_after text;
alter table lyncil.song_jobs add column if not exists request jsonb;

alter table lyncil.song_jobs drop constraint if exists song_jobs_failure_check;
alter table lyncil.song_jobs add constraint song_jobs_failure_check
  check (failure in ('blocked', 'cut_off', 'lost', 'timeout', 'error', 'start_failed', 'busy'));
