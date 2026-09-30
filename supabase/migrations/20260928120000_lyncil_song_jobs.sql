-- Text-to-music. A song takes longer than an edge function may hold a
-- request, so lyncil/generate-song starts a task with the provider (Mureka or
-- Google Lyria) and the app polls lyncil/song-status. This table ties each
-- task to the user who started it and the provider that runs it:
-- song-status only answers for your own tasks and always asks the right
-- provider, and generate-song counts the rows for its per-user daily cap.
--
-- Idempotent like every migration here.

create table if not exists lyncil.song_jobs (
  task_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('song', 'instrumental')),
  provider text not null default 'mureka' check (provider in ('mureka', 'google')),
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  -- Lyria returns the audio inline, so its tracks are kept in the
  -- lyncil-tracks bucket; Mureka's stay on Mureka's CDN and leave this null.
  audio_path text,
  created_at timestamptz not null default now()
);

create index if not exists song_jobs_user_created_idx
  on lyncil.song_jobs (user_id, created_at);

-- Reached only by the edge function over the direct connection; the lyncil
-- schema is not exposed through PostgREST. RLS on as a guard all the same.
alter table lyncil.song_jobs enable row level security;

-- Mureka's result URLs die after 30 days, and the cap only looks back one.
select cron.schedule('lyncil-song-jobs-cleanup', '37 4 * * *', $$
  delete from lyncil.song_jobs where created_at < now() - interval '30 days';
$$);

-- Lyria tracks, one folder per user (<user id>/<task id>.mp3). The edge
-- function writes and signs with the caller's own token, so these policies
-- are what keep one user out of another's tracks.
insert into storage.buckets (id, name, public)
values ('lyncil-tracks', 'lyncil-tracks', false)
on conflict (id) do nothing;

drop policy if exists "Lyncil users upload own tracks" on storage.objects;
create policy "Lyncil users upload own tracks"
  on storage.objects for insert
  with check (
    bucket_id = 'lyncil-tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Upsert on a retried poll replaces the object, which needs update too.
drop policy if exists "Lyncil users replace own tracks" on storage.objects;
create policy "Lyncil users replace own tracks"
  on storage.objects for update
  using (
    bucket_id = 'lyncil-tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Lyncil users read own tracks" on storage.objects;
create policy "Lyncil users read own tracks"
  on storage.objects for select
  using (
    bucket_id = 'lyncil-tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
