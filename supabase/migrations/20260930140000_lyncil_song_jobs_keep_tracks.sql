-- song_jobs now does two more jobs than the daily cap it was made for: a
-- finished row is where a song's stored track is found again (audio_path),
-- and the song allowance per plan (functions/lyncil/song-quota.ts) counts
-- rows over a billing month. The nightly cleanup deleted every row after 30
-- days, which lost old tracks and could shorten a 31-day window, so it now
-- keeps finished rows and clears only failed or abandoned ones, after 40 days.
--
-- Idempotent like every migration here.

select cron.unschedule('lyncil-song-jobs-cleanup')
where exists (select 1 from cron.job where jobname = 'lyncil-song-jobs-cleanup');

select cron.schedule('lyncil-song-jobs-cleanup', '37 4 * * *', $$
  delete from lyncil.song_jobs
  where status <> 'succeeded' and created_at < now() - interval '40 days';
$$);
