-- Affirmations: Breathe, the breathing exercises.
--
-- The four exercises themselves (Wake Up, Fall Asleep, Calm Down, Focus) are
-- defined in the app. The backend keeps only what is the user's:
--   * breathe_presets: an exercise saved to "Your collections" with the
--     settings the user picked. Free, and not counted against the 100 saved
--     collections; capped at 50 presets per user.
--   * breathe_sessions: each finished (or ended-early) breathing session, for
--     "Jump back in", with its mood check-in. The newest 1,000 per user are kept.
-- `settings` holds the rest of the session's choices (guide, background,
-- haptics, volumes, ...) as a small JSON object, so a setting added later needs
-- no migration; the app falls back to the exercise's default for any key it
-- doesn't find.
--
-- affirmations_get_library returns them under three new keys (breathe_presets,
-- breathe_sessions, breathe_stats); older builds ignore keys they don't know.
-- Its body is otherwise the one from 20261113240000_affirmations_goals_in_explore.sql.
--
-- Both tables are also in functions/_shared/erase-user.ts and
-- functions/affirmations/delete-my-data.ts. Deploy order: db push, then
-- snippets/check-account-tables.ts, then functions deploy — erase-user.ts is
-- shared by every app on the project and fails if it names a table that
-- doesn't exist yet.
--
-- Idempotent like every migration here.

-- MARK: - Tables

create table if not exists affirmations.breathe_presets (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  scenario text not null check (scenario in ('wake_up', 'fall_asleep', 'calm_down', 'focus')),
  title text not null check (char_length(title) between 1 and 80),
  duration_sec int not null check (duration_sec between 30 and 3600),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists breathe_presets_user_idx
  on affirmations.breathe_presets (user_id, created_at desc);

drop trigger if exists affirmations_set_updated_at on affirmations.breathe_presets;
create trigger affirmations_set_updated_at
  before update on affirmations.breathe_presets
  for each row execute function shared.set_updated_at();

create table if not exists affirmations.breathe_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  scenario text not null check (scenario in ('wake_up', 'fall_asleep', 'calm_down', 'focus')),
  preset_id uuid references affirmations.breathe_presets (id) on delete set null,
  duration_sec int not null check (duration_sec between 30 and 3600),
  seconds_breathed int not null check (seconds_breathed between 0 and 7200),
  completed boolean not null,
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2048),
  played_at timestamptz not null default now(),
  mood smallint check (mood between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists breathe_sessions_user_idx
  on affirmations.breathe_sessions (user_id, played_at desc, id);

alter table affirmations.breathe_presets enable row level security;
alter table affirmations.breathe_sessions enable row level security;
revoke all on affirmations.breathe_presets from public, anon, authenticated;
revoke all on affirmations.breathe_sessions from public, anon, authenticated;

-- MARK: - JSON

create or replace function affirmations.breathe_preset_json(p affirmations.breathe_presets)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'scenario', p.scenario,
    'title', p.title,
    'duration_sec', p.duration_sec,
    'settings', p.settings,
    'created_at', extract(epoch from p.created_at)
  );
$$;

create or replace function affirmations.breathe_session_json(s affirmations.breathe_sessions)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'scenario', s.scenario,
    'preset_id', s.preset_id,
    'duration_sec', s.duration_sec,
    'seconds_breathed', s.seconds_breathed,
    'completed', s.completed,
    'settings', s.settings,
    'played_at', extract(epoch from s.played_at),
    'mood', s.mood
  );
$$;

-- Totals for the finish screen: sessions and minutes (each session rounded up
-- to a whole minute, at least one, as the app counts them).
create or replace function affirmations.breathe_stats_json(p_user uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'sessions', count(*),
    'minutes', coalesce(sum(greatest(1, ceil(s.seconds_breathed / 60.0)))::int, 0)
  )
  from affirmations.breathe_sessions s
  where s.user_id = p_user;
$$;

revoke all on function affirmations.breathe_preset_json(affirmations.breathe_presets) from public, anon, authenticated;
revoke all on function affirmations.breathe_session_json(affirmations.breathe_sessions) from public, anon, authenticated;
revoke all on function affirmations.breathe_stats_json(uuid) from public, anon, authenticated;

-- MARK: - Sessions

create or replace function public.affirmations_record_breathe_session(
  p_id uuid,
  p_scenario text,
  p_preset_id uuid,
  p_duration_sec int,
  p_seconds_breathed int,
  p_completed boolean,
  p_settings jsonb,
  p_played_at double precision
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_session breathe_sessions%rowtype;
  v_preset_id uuid;
begin
  -- A retry of a session already recorded.
  if exists (select 1 from breathe_sessions where id = p_id) then
    select * into v_session from breathe_sessions where id = p_id and user_id = v_auth_id;
    if not found then
      raise exception 'session_not_found';
    end if;
    return affirmations.breathe_session_json(v_session);
  end if;

  -- Only a preset of the caller's; anything else is stored as none.
  select id into v_preset_id from breathe_presets where id = p_preset_id and user_id = v_auth_id;

  insert into breathe_sessions (
    id, user_id, scenario, preset_id, duration_sec, seconds_breathed, completed, settings, played_at
  )
  values (
    p_id, v_auth_id, p_scenario, v_preset_id, p_duration_sec,
    greatest(coalesce(p_seconds_breathed, 0), 0), coalesce(p_completed, false),
    coalesce(p_settings, '{}'::jsonb), coalesce(to_timestamp(p_played_at), now())
  )
  returning * into v_session;

  delete from breathe_sessions
  where user_id = v_auth_id
    and id not in (
      select id from breathe_sessions
      where user_id = v_auth_id
      order by played_at desc, id desc
      limit 1000
    );

  return affirmations.breathe_session_json(v_session);
end;
$$;

-- p_mood null clears it.
create or replace function public.affirmations_set_breathe_session_mood(p_id uuid, p_mood smallint)
returns void
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  update breathe_sessions set mood = p_mood where id = p_id and user_id = v_auth_id;
end;
$$;

create or replace function public.affirmations_delete_breathe_session(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  delete from breathe_sessions where id = p_id and user_id = v_auth_id;
end;
$$;

-- MARK: - Presets

-- Saves a preset as it stands now: a new one, or the same id again with new
-- settings.
create or replace function public.affirmations_save_breathe_preset(
  p_id uuid,
  p_scenario text,
  p_title text,
  p_duration_sec int,
  p_settings jsonb
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := left(btrim(coalesce(p_title, '')), 80);
  v_preset breathe_presets%rowtype;
begin
  if v_title = '' then
    raise exception 'invalid_title';
  end if;

  if exists (select 1 from breathe_presets where id = p_id) then
    update breathe_presets
    set scenario = p_scenario,
        title = v_title,
        duration_sec = p_duration_sec,
        settings = coalesce(p_settings, '{}'::jsonb)
    where id = p_id and user_id = v_auth_id
    returning * into v_preset;
    if not found then
      raise exception 'preset_not_found';
    end if;
    return affirmations.breathe_preset_json(v_preset);
  end if;

  if (select count(*) from breathe_presets where user_id = v_auth_id) >= 50 then
    raise exception 'too_many_presets';
  end if;

  insert into breathe_presets (id, user_id, scenario, title, duration_sec, settings)
  values (p_id, v_auth_id, p_scenario, v_title, p_duration_sec, coalesce(p_settings, '{}'::jsonb))
  returning * into v_preset;

  return affirmations.breathe_preset_json(v_preset);
end;
$$;

-- Sessions played from it keep their history; their preset_id goes null.
create or replace function public.affirmations_delete_breathe_preset(p_id uuid)
returns void
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  delete from breathe_presets where id = p_id and user_id = v_auth_id;
end;
$$;

revoke all on function public.affirmations_record_breathe_session(uuid, text, uuid, int, int, boolean, jsonb, double precision) from public, anon, authenticated;
revoke all on function public.affirmations_set_breathe_session_mood(uuid, smallint) from public, anon, authenticated;
revoke all on function public.affirmations_delete_breathe_session(uuid) from public, anon, authenticated;
revoke all on function public.affirmations_save_breathe_preset(uuid, text, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.affirmations_delete_breathe_preset(uuid) from public, anon, authenticated;
grant execute on function public.affirmations_record_breathe_session(uuid, text, uuid, int, int, boolean, jsonb, double precision) to authenticated;
grant execute on function public.affirmations_set_breathe_session_mood(uuid, smallint) to authenticated;
grant execute on function public.affirmations_delete_breathe_session(uuid) to authenticated;
grant execute on function public.affirmations_save_breathe_preset(uuid, text, text, int, jsonb) to authenticated;
grant execute on function public.affirmations_delete_breathe_preset(uuid) to authenticated;

-- MARK: - Library

create or replace function public.affirmations_get_library(
  p_language text default 'en',
  p_session_limit int default 50
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_language text := lower(coalesce(nullif(btrim(p_language), ''), 'en'));
  v_base text := split_part(lower(coalesce(nullif(btrim(p_language), ''), 'en')), '-', 1);
  v_sessions jsonb := affirmations.sessions_page(v_auth_id, null, p_session_limit);
  v_favorites_id uuid := affirmations.favorites_id(v_auth_id);
begin
  return jsonb_build_object(
    'builtin', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', t.title,
        'subtitle', t.subtitle,
        'icon', c.icon,
        'tint', c.tint,
        'moments', to_jsonb(c.moments),
        'items', affirmations.collection_items_json(c.id, t.language)
      ) order by c.position, c.id)
      from collections c
      cross join lateral (
        select ct.title, ct.subtitle, ct.language
        from collection_texts ct
        where ct.collection_id = c.id
          and lower(ct.language) in (v_language, v_base, 'en')
        order by case lower(ct.language) when v_language then 0 when v_base then 1 else 2 end
        limit 1
      ) t
      where c.kind = 'builtin' and c.enabled
    ), '[]'::jsonb),
    -- Onboarding's goal libraries again, by goal, for onboarding to find.
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'goal', c.goal,
        'title', t.title,
        'subtitle', t.subtitle,
        'icon', c.icon,
        'tint', c.tint,
        'moments', to_jsonb(c.moments),
        'items', affirmations.collection_items_json(c.id, t.language)
      ) order by c.position, c.id)
      from collections c
      cross join lateral (
        select ct.title, ct.subtitle, ct.language
        from collection_texts ct
        where ct.collection_id = c.id
          and lower(ct.language) in (v_language, v_base, 'en')
        order by case lower(ct.language) when v_language then 0 when v_base then 1 else 2 end
        limit 1
      ) t
      where c.kind = 'builtin' and c.enabled and c.goal is not null
    ), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(affirmations.collection_json(c) order by c.created_at desc, c.id)
      from collections c
      where c.owner_id = v_auth_id and c.kind = 'saved'
    ), '[]'::jsonb),
    'favorites', coalesce((
      select affirmations.collection_items_json(c.id)
      from collections c
      where c.owner_id = v_auth_id and c.kind = 'favorites'
    ), '[]'::jsonb),
    'favorites_id', v_favorites_id,
    'sessions', v_sessions -> 'sessions',
    'has_more_sessions', v_sessions -> 'has_more',
    -- Breathe: saved presets (newest first), the newest 20 sessions, totals.
    'breathe_presets', coalesce((
      select jsonb_agg(affirmations.breathe_preset_json(p) order by p.created_at desc, p.id)
      from breathe_presets p
      where p.user_id = v_auth_id
    ), '[]'::jsonb),
    'breathe_sessions', coalesce((
      select jsonb_agg(affirmations.breathe_session_json(s) order by s.played_at desc, s.id desc)
      from breathe_sessions s
      where s.id in (
        select id from breathe_sessions
        where user_id = v_auth_id
        order by played_at desc, id desc
        limit 20
      )
    ), '[]'::jsonb),
    'breathe_stats', affirmations.breathe_stats_json(v_auth_id)
  );
end;
$$;

grant execute on function public.affirmations_get_library(text, int) to authenticated;
