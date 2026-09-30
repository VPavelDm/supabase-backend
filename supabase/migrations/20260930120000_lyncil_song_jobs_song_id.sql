-- A converted song has to stay converted. The finished track is kept in the
-- lyncil-tracks bucket under <user id>/<song id>.<ext>, the phone keeps a
-- copy, and whenever the phone doesn't have it (the screen was left
-- mid-generation, the download failed, a reinstall, a new phone) the app asks
-- song-status by song id and downloads it again. So each job remembers the
-- Lyncil song it belongs to and the stored track's length, which the app
-- needs for its list.
--
-- Deleting a song removes its track from the bucket (the app does it with the
-- user's own token), so storage only holds tracks of songs that exist.
--
-- Rows from before this migration have no song id; they just can't be found
-- by song.
--
-- Idempotent like every migration here.

alter table lyncil.song_jobs add column if not exists song_id uuid;
alter table lyncil.song_jobs add column if not exists audio_duration double precision;

create index if not exists song_jobs_user_song_created_idx
  on lyncil.song_jobs (user_id, song_id, created_at desc);

drop policy if exists "Lyncil users delete own tracks" on storage.objects;
create policy "Lyncil users delete own tracks"
  on storage.objects for delete
  using (
    bucket_id = 'lyncil-tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
