-- The editor's thumbs-down: a user who didn't like a generated song says why,
-- by tapping reasons (voice, melody, lyrics, genre, sound, length) and/or a
-- short note, or just that they didn't. Each send is a row, tied to the task and the
-- provider that made the track so Lyria and Mureka can be compared, with a
-- snapshot of what the song asked for, because the song itself may be
-- deleted later and the feedback should still read on its own.
--
-- Futura RPC style like lyncil_songs: the table in the lyncil schema, the
-- app-facing function in public, SECURITY DEFINER + auth.uid().
-- Idempotent like every migration here.

create table if not exists lyncil.song_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  song_id uuid not null,
  task_id text,
  provider text,
  genre text,
  mood text,
  voice text,
  -- Keys, not labels, so they count the same in every language:
  -- voice, melody, lyrics, genre, sound, length.
  reasons text[] not null default '{}',
  text text not null default '',
  created_at timestamptz not null default now()
);

-- For a database that ran this file before reasons existed.
alter table lyncil.song_feedback add column if not exists reasons text[] not null default '{}';

create index if not exists song_feedback_created_idx
  on lyncil.song_feedback (created_at desc);

-- Never exposed through PostgREST directly; the RPC below is the API.
alter table lyncil.song_feedback enable row level security;

drop function if exists public.lyncil_add_song_feedback(uuid, text);

create or replace function public.lyncil_add_song_feedback(
  p_song_id uuid,
  p_reasons text[] default '{}',
  p_text text default ''
)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_song songs%rowtype;
  v_job song_jobs%rowtype;
  v_id uuid;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  select * into v_song from songs where id = p_song_id and user_id = v_auth_id;
  if not found then
    raise exception 'Song not found';
  end if;

  select * into v_job from song_jobs
  where song_id = p_song_id and user_id = v_auth_id and status = 'succeeded'
  order by created_at desc limit 1;

  insert into song_feedback (user_id, song_id, task_id, provider, genre, mood, voice, reasons, text)
  values (
    v_auth_id, p_song_id, v_job.task_id, v_job.provider,
    v_song.genre, v_song.mood, v_song.voice,
    -- Known keys only, each once: the app is not the only possible caller.
    coalesce((
      select array_agg(distinct r) from unnest(p_reasons) as r
      where r in ('voice', 'melody', 'lyrics', 'genre', 'sound', 'length')
    ), '{}'),
    left(coalesce(trim(p_text), ''), 2000)
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.lyncil_add_song_feedback(uuid, text[], text) to authenticated;
