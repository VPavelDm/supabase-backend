-- A Lyncil user, as a row of its own. auth.users is shared with Futura, and
-- an anonymous user there says nothing about which app made it, so until now
-- a Lyncil user only showed up through what they left behind (a song, a
-- job). lyncil.profiles is that marker, and the parent of every Lyncil row:
--
--   profiles 1─N songs, song_jobs, song_feedback   (user_id, on delete cascade)
--   songs    1─N song_feedback                     (song_id, on delete set null)
--   song_jobs 1─N song_feedback                    (task_id, on delete set null)
--
-- The profile's id is the auth user's id, the same string Amplitude and Adapty
-- know the user by, so every table keeps the user_id it already has.
-- song_jobs.song_id stays a plain column: onboarding starts a track before
-- the song is saved, and may never save it.
--
-- App builds that predate profiles (App Store 2.7.1) never ask for one, so
-- every write that needs a profile makes it first (lyncil.ensure_profile).
-- onboarded_at lets a reinstall skip onboarding: the session, and with it the
-- user, survives a reinstall in the Keychain, UserDefaults don't.
--
-- Songs are no longer deleted: deleting one hides it from its owner
-- (deleted_at) and the row stays, with its track, for analysis. Saving the
-- song again clears deleted_at, which is how Home's Undo brings it back.
--
-- Idempotent like every migration here.

create table if not exists lyncil.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Null until the user finishes onboarding.
  onboarded_at timestamptz,
  -- The flow they went through (v1, v2, v3), for funnels.
  onboarding_variant text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Never exposed through PostgREST directly; the RPCs below are the API.
alter table lyncil.profiles enable row level security;

drop policy if exists profiles_owner on lyncil.profiles;
create policy profiles_owner on lyncil.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop trigger if exists lyncil_set_updated_at on lyncil.profiles;
create trigger lyncil_set_updated_at
  before update on lyncil.profiles
  for each row execute function shared.set_updated_at();

-- What every write calls before it inserts a row that belongs to a user.
-- Internal: the RPCs (SECURITY DEFINER) and the edge function (direct
-- connection) call it; the app never does.
create or replace function lyncil.ensure_profile(p_id uuid)
returns void
language sql
set search_path to 'lyncil'
as $$
  insert into profiles (id) values (p_id) on conflict (id) do nothing;
$$;

revoke execute on function lyncil.ensure_profile(uuid) from public;

-- =============================================================================
-- Backfill: everyone who already has Lyncil rows, from their first one
-- =============================================================================

insert into lyncil.profiles (id, created_at)
select user_id, min(created_at)
from (
  select user_id, created_at from lyncil.songs
  union all
  select user_id, created_at from lyncil.song_jobs
  union all
  select user_id, created_at from lyncil.song_feedback
) rows
group by user_id
on conflict (id) do nothing;

-- A saved song means onboarding is behind them: every flow ends by saving one,
-- and the library only exists past onboarding.
update lyncil.profiles p
set onboarded_at = first_song.created_at
from (
  select user_id, min(created_at) as created_at from lyncil.songs group by user_id
) first_song
where p.id = first_song.user_id and p.onboarded_at is null;

-- =============================================================================
-- Relationships
-- =============================================================================

alter table lyncil.songs drop constraint if exists songs_user_id_fkey;
alter table lyncil.songs add constraint songs_user_id_fkey
  foreign key (user_id) references lyncil.profiles (id) on delete cascade;

alter table lyncil.song_jobs drop constraint if exists song_jobs_user_id_fkey;
alter table lyncil.song_jobs add constraint song_jobs_user_id_fkey
  foreign key (user_id) references lyncil.profiles (id) on delete cascade;

alter table lyncil.song_feedback drop constraint if exists song_feedback_user_id_fkey;
alter table lyncil.song_feedback add constraint song_feedback_user_id_fkey
  foreign key (user_id) references lyncil.profiles (id) on delete cascade;

-- Feedback keeps a snapshot of what the song asked for so it reads on its own,
-- so it outlives a song that is gone (only a profile deletion removes songs
-- now) and a job the nightly cleanup cleared.
alter table lyncil.song_feedback alter column song_id drop not null;

update lyncil.song_feedback f set song_id = null
where f.song_id is not null
  and not exists (select 1 from lyncil.songs s where s.id = f.song_id);

alter table lyncil.song_feedback drop constraint if exists song_feedback_song_id_fkey;
alter table lyncil.song_feedback add constraint song_feedback_song_id_fkey
  foreign key (song_id) references lyncil.songs (id) on delete set null;

update lyncil.song_feedback f set task_id = null
where f.task_id is not null
  and not exists (select 1 from lyncil.song_jobs j where j.task_id = f.task_id);

alter table lyncil.song_feedback drop constraint if exists song_feedback_task_id_fkey;
alter table lyncil.song_feedback add constraint song_feedback_task_id_fkey
  foreign key (task_id) references lyncil.song_jobs (task_id) on delete set null;

-- =============================================================================
-- Deleted songs stay
-- =============================================================================

alter table lyncil.songs add column if not exists deleted_at timestamptz;

drop index if exists lyncil.songs_user_modified_idx;
create index if not exists songs_user_modified_live_idx
  on lyncil.songs (user_id, modified_at desc)
  where deleted_at is null;

-- The track stays with its song: no one deletes from lyncil-tracks any more.
-- Builds that still try do it best effort and carry on.
drop policy if exists "Lyncil users delete own tracks" on storage.objects;

-- =============================================================================
-- RPCs
-- =============================================================================

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
  where s.user_id = v_auth_id and s.deleted_at is null;

  return v_songs;
end;
$$;

-- As before, plus: the profile is made on the way in, and saving a deleted
-- song brings it back (Home's Undo saves the song it just deleted).
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

  perform ensure_profile(v_auth_id);

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
    modified_at = excluded.modified_at,
    deleted_at = null
  where songs.user_id = v_auth_id
  returning * into v_song;

  if not found then
    raise exception 'Song not found';
  end if;

  return public.lyncil_song_json(v_song);
end;
$$;

-- Hides the song from its owner; the row stays.
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

  update songs set deleted_at = now()
  where id = p_id and user_id = v_auth_id and deleted_at is null;

  -- Deleting what is already gone is fine: the app retries writes.
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

-- Dates travel as epoch seconds, like lyncil_song_json.
create or replace function public.lyncil_profile_json(p lyncil.profiles)
returns jsonb
language sql immutable
set search_path to 'lyncil'
as $$
  select jsonb_build_object(
    'id', p.id,
    'onboarded_at', extract(epoch from p.onboarded_at),
    'onboarding_variant', p.onboarding_variant
  );
$$;

-- The splash's question: has this user been through onboarding?
create or replace function public.lyncil_ensure_profile()
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  perform ensure_profile(v_auth_id);
  select * into v_profile from profiles where id = v_auth_id;

  return public.lyncil_profile_json(v_profile);
end;
$$;

grant execute on function public.lyncil_ensure_profile() to authenticated;

-- The first finish counts: a replay (or an old flag synced later) keeps it.
create or replace function public.lyncil_complete_onboarding(p_variant text default null)
returns jsonb
language plpgsql security definer
set search_path to 'lyncil'
as $$
declare
  v_auth_id uuid := auth.uid();
  v_profile profiles%rowtype;
begin
  if v_auth_id is null then
    raise exception 'Not signed in';
  end if;

  perform ensure_profile(v_auth_id);

  update profiles set
    onboarded_at = coalesce(onboarded_at, now()),
    onboarding_variant = coalesce(onboarding_variant, left(nullif(trim(p_variant), ''), 16))
  where id = v_auth_id
  returning * into v_profile;

  return public.lyncil_profile_json(v_profile);
end;
$$;

grant execute on function public.lyncil_complete_onboarding(text) to authenticated;
