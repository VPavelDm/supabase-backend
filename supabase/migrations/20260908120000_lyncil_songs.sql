-- Lyncil's songs move off the device. The app signs every install in
-- anonymously (the Supabase session lives in the Keychain, which survives a
-- reinstall, so the same anonymous user comes back with their library) and
-- keeps each song here: what the user picked (genre, mood, artist, voice),
-- what they asked for (the prompt), and what came back (name and lyrics),
-- plus the library state the app needs (favourite, cover style, the local
-- track's file name and length).
--
-- Futura RPC style: the table lives in the app's schema, the app-facing
-- functions in public with search_path pinned, SECURITY DEFINER + auth.uid()
-- for auth, GRANT EXECUTE to authenticated (anonymous users carry that role).
-- Names are lyncil_-prefixed because public is shared by several apps.
-- Idempotent like every migration here.

create schema if not exists lyncil;

create table if not exists lyncil.songs (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  lyrics text not null default '',
  prompt text not null default '',
  genre text,
  mood text,
  artist text,
  voice text not null default 'male',
  style text not null default 'black',
  is_favorite boolean not null default false,
  audio_file_name text,
  audio_duration double precision,
  -- The app's own "last edited" clock: the library sorts by it, and only
  -- edits move it. Favouriting doesn't, so it is set by the app, not a trigger.
  modified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists songs_user_modified_idx
  on lyncil.songs (user_id, modified_at desc);

-- Never exposed through PostgREST directly; the RPCs below are the API.
-- RLS on as a belt-and-braces guard should that ever change.
alter table lyncil.songs enable row level security;

drop policy if exists songs_owner on lyncil.songs;
create policy songs_owner on lyncil.songs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists lyncil_set_updated_at on lyncil.songs;
create trigger lyncil_set_updated_at
  before update on lyncil.songs
  for each row execute function shared.set_updated_at();

-- =============================================================================
-- RPCs
-- =============================================================================

-- Dates travel as epoch seconds: jsonb renders timestamptz with microseconds
-- and an offset, which Foundation's ISO 8601 decoder rejects.
create or replace function public.lyncil_song_json(s lyncil.songs)
returns jsonb
language sql immutable
set search_path to 'lyncil'
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'lyrics', s.lyrics,
    'prompt', s.prompt,
    'genre', s.genre,
    'mood', s.mood,
    'artist', s.artist,
    'voice', s.voice,
    'style', s.style,
    'is_favorite', s.is_favorite,
    'audio_file_name', s.audio_file_name,
    'audio_duration', s.audio_duration,
    'modified_at', extract(epoch from s.modified_at),
    'created_at', extract(epoch from s.created_at)
  );
$$;

create or replace function public.lyncil_get_songs()
returns jsonb
language plpgsql stable security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_songs jsonb;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  select coalesce(jsonb_agg(public.lyncil_song_json(s) order by s.modified_at desc, s.id), '[]'::jsonb)
    into v_songs
  from songs s
  where s.user_id = v_auth_id;

  return v_songs;
end;
$$;

grant execute on function public.lyncil_get_songs() to authenticated;

-- Insert or replace by id. The id is the app's (a UUID minted on the device
-- when the song is written), so an edit and a create are the same call.
create or replace function public.lyncil_upsert_song(
  p_id uuid,
  p_name text,
  p_lyrics text,
  p_prompt text default '',
  p_genre text default null,
  p_mood text default null,
  p_artist text default null,
  p_voice text default 'male',
  p_style text default 'black',
  p_is_favorite boolean default false,
  p_audio_file_name text default null,
  p_audio_duration double precision default null,
  p_modified_at double precision default null
)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_modified_at timestamptz := coalesce(to_timestamp(p_modified_at), now());
  v_song songs%rowtype;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  insert into songs (
    id, user_id, name, lyrics, prompt, genre, mood, artist, voice, style,
    is_favorite, audio_file_name, audio_duration, modified_at
  )
  values (
    p_id, v_auth_id, p_name, p_lyrics, p_prompt, p_genre, p_mood, p_artist,
    coalesce(p_voice, 'male'), coalesce(p_style, 'black'),
    p_is_favorite, p_audio_file_name, p_audio_duration, v_modified_at
  )
  on conflict (id) do update set
    name = excluded.name,
    lyrics = excluded.lyrics,
    prompt = excluded.prompt,
    genre = excluded.genre,
    mood = excluded.mood,
    artist = excluded.artist,
    voice = excluded.voice,
    style = excluded.style,
    is_favorite = excluded.is_favorite,
    audio_file_name = excluded.audio_file_name,
    audio_duration = excluded.audio_duration,
    modified_at = excluded.modified_at
  where songs.user_id = v_auth_id
  returning * into v_song;

  if not found then
    raise exception 'Song not found';
  end if;

  return public.lyncil_song_json(v_song);
end;
$$;

grant execute on function public.lyncil_upsert_song(
  uuid, text, text, text, text, text, text, text, text, boolean, text, double precision, double precision
) to authenticated;

create or replace function public.lyncil_delete_song(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  delete from songs where id = p_id and user_id = v_auth_id;

  -- Deleting what is already gone is fine: the app retries writes.
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

grant execute on function public.lyncil_delete_song(uuid) to authenticated;
