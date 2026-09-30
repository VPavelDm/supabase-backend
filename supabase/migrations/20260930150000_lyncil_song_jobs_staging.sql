-- Staging builds (simulator, Xcode, TestFlight) get a stored sample track
-- instead of a paid one (functions/lyncil/generate-song.ts), recorded like
-- any other song so the plan allowance and recovery work the same. Their rows
-- carry provider 'staging', which keeps them out of any provider comparison.
--
-- Idempotent like every migration here.

alter table lyncil.song_jobs drop constraint if exists song_jobs_provider_check;
alter table lyncil.song_jobs add constraint song_jobs_provider_check
  check (provider in ('mureka', 'google', 'staging'));
