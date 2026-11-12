-- Affirmations' library moves to the backend: the user's own collections, the
-- sessions they listened to (with the mood they picked afterwards), and their
-- favorites, plus the built-in collections every user gets.
--
-- Until now the server kept nothing of an Affirmations user but the daily
-- usage counters. From here on it keeps what they type (session titles are
-- the user's own words: "Nervous about Friday's presentation"), so:
--   * every row hangs off auth.users and cascades with it, and
--     `userHoldsAppData` in functions/_shared/erase-user.ts lists these
--     tables, or another app's deletion would take them with the auth user;
--   * delete-my-data deletes them;
--   * the app reaches them only through the RPCs below: SECURITY DEFINER,
--     scoped to auth.uid(), never to a user id the caller passes in.
--
-- Futura RPC style, like lyncil_*: tables in the app's schema (not exposed
-- through PostgREST), app-facing functions in public with search_path pinned
-- and an `affirmations_` prefix, granted to authenticated only (anonymous
-- users carry that role). Dates travel as epoch seconds.
--
-- Limits keep a free anonymous account from turning the project into
-- storage: 100 collections, 200 affirmations each, 400 characters an
-- affirmation (text-to-speech's own cap), 1,000 favorites, and the newest 500
-- sessions (older ones are dropped as new ones arrive).
--
-- Idempotent like every migration here.

create schema if not exists affirmations;

-- =============================================================================
-- Built-in collections (the same for every user)
-- =============================================================================

-- One row per collection: how it looks and when Home offers it. Edits are
-- live: a saved row changes what every installed copy shows at its next
-- library load. `enabled = false` hides a collection without deleting it.
create table if not exists affirmations.builtin_collections (
  id uuid primary key,
  slug text not null unique,
  position int not null,
  icon text not null,
  tint text not null,
  -- Parts of the day it suits: morning, day, evening, night.
  moments text[] not null default '{}',
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Its words, per language. The library takes the caller's language, then the
-- language without its region ("pt" for "pt-br"), then English.
create table if not exists affirmations.builtin_collection_texts (
  collection_id uuid not null references affirmations.builtin_collections (id) on delete cascade,
  language text not null,
  title text not null,
  subtitle text not null default '',
  -- In playing order.
  affirmations text[] not null,
  updated_at timestamptz not null default now(),
  primary key (collection_id, language)
);

alter table affirmations.builtin_collections enable row level security;
alter table affirmations.builtin_collection_texts enable row level security;

drop trigger if exists affirmations_set_updated_at on affirmations.builtin_collections;
create trigger affirmations_set_updated_at
  before update on affirmations.builtin_collections
  for each row execute function shared.set_updated_at();

drop trigger if exists affirmations_set_updated_at on affirmations.builtin_collection_texts;
create trigger affirmations_set_updated_at
  before update on affirmations.builtin_collection_texts
  for each row execute function shared.set_updated_at();

-- =============================================================================
-- The user's library
-- =============================================================================

-- A collection the user made. Its affirmations live in the row, in order, as
-- [{"text": "...", "own": true|false}] ("own": written by the user), so
-- saving a collection is one write of its whole state: a retry repeats it
-- harmlessly and a reorder can't half-apply.
create table if not exists affirmations.collections (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  icon text not null,
  tint text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists collections_user_created_idx
  on affirmations.collections (user_id, created_at desc);

-- A finished session, kept so it can be played again exactly as heard.
create table if not exists affirmations.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What the user typed, the suggestion they tapped, or the collection's name.
  title text not null,
  affirmations text[] not null,
  played_at timestamptz not null,
  minutes_listened int not null default 0,
  -- 1 heavy … 5 great; null until (unless) the user picks one on the recap.
  mood smallint check (mood between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_played_idx
  on affirmations.sessions (user_id, played_at desc);

-- The hearts. Keyed by text: the app identifies an affirmation by its words.
create table if not exists affirmations.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, text)
);

create index if not exists favorites_user_created_idx
  on affirmations.favorites (user_id, created_at desc);

-- Never exposed through PostgREST; the RPCs are the API. RLS on as a
-- belt-and-braces guard should that ever change.
alter table affirmations.collections enable row level security;
alter table affirmations.sessions enable row level security;
alter table affirmations.favorites enable row level security;

drop policy if exists collections_owner on affirmations.collections;
create policy collections_owner on affirmations.collections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists sessions_owner on affirmations.sessions;
create policy sessions_owner on affirmations.sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists favorites_owner on affirmations.favorites;
create policy favorites_owner on affirmations.favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists affirmations_set_updated_at on affirmations.collections;
create trigger affirmations_set_updated_at
  before update on affirmations.collections
  for each row execute function shared.set_updated_at();

-- =============================================================================
-- Helpers (no grant: called only inside the SECURITY DEFINER functions below)
-- =============================================================================

create or replace function affirmations.require_user()
returns uuid
language plpgsql stable
set search_path to ''
as $$
declare
  v_auth_id uuid := auth.uid();
begin
  if v_auth_id is null then
    raise exception 'not_signed_in';
  end if;
  return v_auth_id;
end;
$$;

-- An affirmation's text as stored: trimmed, non-empty, at most 400 characters.
create or replace function affirmations.clean_text(p_text text)
returns text
language plpgsql immutable
set search_path to ''
as $$
declare
  v_text text := btrim(coalesce(p_text, ''));
begin
  if v_text = '' then
    raise exception 'empty_text';
  end if;
  if char_length(v_text) > 400 then
    raise exception 'text_too_long';
  end if;
  return v_text;
end;
$$;

create or replace function affirmations.collection_json(c affirmations.collections)
returns jsonb
language sql immutable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'icon', c.icon,
    'tint', c.tint,
    'items', c.items,
    'created_at', extract(epoch from c.created_at),
    'updated_at', extract(epoch from c.updated_at)
  );
$$;

create or replace function affirmations.session_json(s affirmations.sessions)
returns jsonb
language sql immutable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'affirmations', to_jsonb(s.affirmations),
    'played_at', extract(epoch from s.played_at),
    'minutes_listened', s.minutes_listened,
    'mood', s.mood
  );
$$;

-- =============================================================================
-- RPCs
-- =============================================================================

-- Everything the library screens show, in one call: the built-in collections
-- in the caller's language, then the caller's collections (newest first),
-- favorites (newest first) and sessions (newest first).
create or replace function public.affirmations_get_library(p_language text default 'en')
returns jsonb
language plpgsql stable security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_language text := lower(coalesce(nullif(btrim(p_language), ''), 'en'));
  v_base text := split_part(lower(coalesce(nullif(btrim(p_language), ''), 'en')), '-', 1);
begin
  return jsonb_build_object(
    'builtin', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'title', t.title,
        'subtitle', t.subtitle,
        'icon', b.icon,
        'tint', b.tint,
        'moments', to_jsonb(b.moments),
        'affirmations', to_jsonb(t.affirmations)
      ) order by b.position, b.id)
      from builtin_collections b
      cross join lateral (
        select bt.title, bt.subtitle, bt.affirmations
        from builtin_collection_texts bt
        where bt.collection_id = b.id
          and lower(bt.language) in (v_language, v_base, 'en')
        order by case lower(bt.language)
          when v_language then 0 when v_base then 1 else 2 end
        limit 1
      ) t
      where b.enabled
    ), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(affirmations.collection_json(c) order by c.created_at desc, c.id)
      from collections c
      where c.user_id = v_auth_id
    ), '[]'::jsonb),
    'favorites', coalesce((
      select jsonb_agg(f.text order by f.created_at desc, f.text)
      from favorites f
      where f.user_id = v_auth_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(affirmations.session_json(s) order by s.played_at desc, s.id)
      from sessions s
      where s.user_id = v_auth_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.affirmations_get_library(text) to authenticated;

-- Creates or replaces a collection with its whole state. The id is the app's
-- (minted on the device), so create and every edit are the same call.
-- p_items: [{"text": "...", "own": bool}], in order; repeated texts are dropped.
create or replace function public.affirmations_save_collection(
  p_id uuid,
  p_title text,
  p_icon text,
  p_tint text,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := btrim(coalesce(p_title, ''));
  v_items jsonb;
  v_collection collections%rowtype;
begin
  if v_title = '' or char_length(v_title) > 80 then
    raise exception 'invalid_title';
  end if;
  if coalesce(p_icon, '') = '' or char_length(p_icon) > 60
     or coalesce(p_tint, '') = '' or char_length(p_tint) > 30 then
    raise exception 'invalid_style';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200 then
    raise exception 'collection_too_long';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('text', i.text, 'own', i.own) order by i.ord), '[]'::jsonb)
    into v_items
  from (
    select distinct on (cleaned.text) cleaned.text, cleaned.own, cleaned.ord
    from (
      select affirmations.clean_text(e.value ->> 'text') as text,
             coalesce((e.value ->> 'own')::boolean, false) as own,
             e.ordinality as ord
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(value, ordinality)
    ) cleaned
    order by cleaned.text, cleaned.ord
  ) i;

  if not exists (select 1 from collections where id = p_id)
     and (select count(*) from collections where user_id = v_auth_id) >= 100 then
    raise exception 'too_many_collections';
  end if;

  insert into collections (id, user_id, title, icon, tint, items)
  values (p_id, v_auth_id, v_title, p_icon, p_tint, v_items)
  on conflict (id) do update set
    title = excluded.title,
    icon = excluded.icon,
    tint = excluded.tint,
    items = excluded.items
  where collections.user_id = v_auth_id
  returning * into v_collection;

  -- The id belongs to someone else's collection.
  if not found then
    raise exception 'collection_not_found';
  end if;

  return affirmations.collection_json(v_collection);
end;
$$;

grant execute on function public.affirmations_save_collection(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.affirmations_delete_collection(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  delete from collections where id = p_id and user_id = v_auth_id;
  -- Deleting what is already gone is fine: the app retries writes.
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

grant execute on function public.affirmations_delete_collection(uuid) to authenticated;

-- Records a finished session. The id is the app's; recording the same id
-- again changes nothing, so the app can retry. Only the newest 500 stay.
create or replace function public.affirmations_record_session(
  p_id uuid,
  p_title text,
  p_affirmations text[],
  p_played_at double precision,
  p_minutes_listened int default 0
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_texts text[];
  v_session sessions%rowtype;
begin
  if coalesce(array_length(p_affirmations, 1), 0) = 0 then
    raise exception 'empty_session';
  end if;
  if array_length(p_affirmations, 1) > 200 then
    raise exception 'session_too_long';
  end if;
  select array_agg(affirmations.clean_text(u.text) order by u.ord)
    into v_texts
  from unnest(p_affirmations) with ordinality as u(text, ord);

  insert into sessions (id, user_id, title, affirmations, played_at, minutes_listened)
  values (
    p_id, v_auth_id, v_title, v_texts,
    coalesce(to_timestamp(p_played_at), now()),
    greatest(coalesce(p_minutes_listened, 0), 0)
  )
  on conflict (id) do nothing;

  select * into v_session from sessions where id = p_id and user_id = v_auth_id;
  if not found then
    raise exception 'session_not_found';
  end if;

  delete from sessions
  where user_id = v_auth_id
    and id in (
      select id from sessions
      where user_id = v_auth_id
      order by played_at desc, id
      offset 500
    );

  return affirmations.session_json(v_session);
end;
$$;

grant execute on function public.affirmations_record_session(uuid, text, text[], double precision, int) to authenticated;

-- The mood picked on the recap; null clears it.
create or replace function public.affirmations_set_session_mood(p_id uuid, p_mood smallint)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  if p_mood is not null and p_mood not between 1 and 5 then
    raise exception 'invalid_mood';
  end if;
  update sessions set mood = p_mood where id = p_id and user_id = v_auth_id;
  return jsonb_build_object('id', p_id, 'updated', found);
end;
$$;

grant execute on function public.affirmations_set_session_mood(uuid, smallint) to authenticated;

create or replace function public.affirmations_delete_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  delete from sessions where id = p_id and user_id = v_auth_id;
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

grant execute on function public.affirmations_delete_session(uuid) to authenticated;

-- Hearts or un-hearts one affirmation. Repeating either is harmless.
create or replace function public.affirmations_set_favorite(p_text text, p_liked boolean)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_text text := affirmations.clean_text(p_text);
begin
  if p_liked then
    if not exists (select 1 from favorites where user_id = v_auth_id and text = v_text)
       and (select count(*) from favorites where user_id = v_auth_id) >= 1000 then
      raise exception 'too_many_favorites';
    end if;
    insert into favorites (user_id, text) values (v_auth_id, v_text)
    on conflict (user_id, text) do nothing;
  else
    delete from favorites where user_id = v_auth_id and text = v_text;
  end if;
  return jsonb_build_object('text', v_text, 'liked', p_liked);
end;
$$;

grant execute on function public.affirmations_set_favorite(text, boolean) to authenticated;

-- One-time upload of the hearts an older build kept on the phone, newest
-- first. Hearts already here stay as they are and keep sorting first; past
-- 1,000 the rest are dropped. Returns the favorites as the library would.
create or replace function public.affirmations_import_favorites(p_texts text[])
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_room int := greatest(1000 - (select count(*) from favorites where user_id = v_auth_id), 0);
  v_oldest timestamptz := (select coalesce(min(created_at), now()) from favorites where user_id = v_auth_id);
begin
  -- Each imported heart is a second older than the one before it, so
  -- "newest first" keeps the phone's order.
  insert into favorites (user_id, text, created_at)
  select v_auth_id, t.text, v_oldest - make_interval(secs => t.rank)
  from (
    select deduped.text, row_number() over (order by deduped.ord) as rank
    from (
      select distinct on (cleaned.text) cleaned.text, cleaned.ord
      from (
        select btrim(u.text) as text, u.ord
        from unnest(coalesce(p_texts, '{}')) with ordinality as u(text, ord)
        where btrim(coalesce(u.text, '')) <> '' and char_length(btrim(u.text)) <= 400
      ) cleaned
      order by cleaned.text, cleaned.ord
    ) deduped
  ) t
  where t.rank <= v_room
  on conflict (user_id, text) do nothing;

  return coalesce((
    select jsonb_agg(f.text order by f.created_at desc, f.text)
    from favorites f
    where f.user_id = v_auth_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.affirmations_import_favorites(text[]) to authenticated;

-- =============================================================================
-- Built-in content (placeholder, English). Inserted only if missing, so a
-- re-run never overwrites edits made since.
-- =============================================================================

insert into affirmations.builtin_collections (id, slug, position, icon, tint, moments) values
  ('06253b17-4d00-4e79-aa0e-699f2509c69d', 'morning-3-min', 10, 'sun.max.fill', 'amber', '{morning}'),
  ('6ab7b29f-3e84-4a89-a29d-9ef01eed1b51', 'cant-sleep', 20, 'moon.stars.fill', 'lavender', '{night}'),
  ('e5e99a2c-6326-4481-9e6c-b6a0d8d7a6cf', 'before-a-big-meeting', 30, 'briefcase.fill', 'sky', '{day}'),
  ('1e8a0423-93da-485e-a1f4-1b8186ef5bbb', 'after-a-hard-day', 40, 'leaf.fill', 'mint', '{evening}'),
  ('66511f6c-779b-43c2-b037-e9e0826be477', 'exam-day', 50, 'book.fill', 'teal', '{day}'),
  ('96cae753-dc0a-4f17-9261-ba0afa28b3b3', 'worthy-as-i-am', 60, 'heart.fill', 'rose', '{evening}')
on conflict (id) do nothing;

insert into affirmations.builtin_collection_texts (collection_id, language, title, subtitle, affirmations) values
  ('06253b17-4d00-4e79-aa0e-699f2509c69d', 'en', 'Morning, 3 min', 'A calm, steady start to the day', array[
    'I welcome this day with an open and steady heart.',
    'I have everything I need to meet today with calm.',
    'I choose to focus on what I can influence today.',
    'My energy is clear, and my mind is ready.',
    'I give myself permission to start gently.',
    'Today I move at a pace that feels right for me.',
    'I am grateful for this fresh beginning.',
    'I trust myself to handle whatever this day brings.'
  ]),
  ('6ab7b29f-3e84-4a89-a29d-9ef01eed1b51', 'en', 'Can''t sleep', 'Quiet a busy mind and drift off', array[
    'I release today and everything it asked of me.',
    'My thoughts can wait until morning; right now I rest.',
    'My body is heavy, warm, and safe.',
    'With every breath out, I let go a little more.',
    'I did enough today, and I am enough tonight.',
    'Sleep comes to me easily when I stop chasing it.',
    'I am safe here, in this moment, in this bed.',
    'Tomorrow will meet me rested and ready.'
  ]),
  ('e5e99a2c-6326-4481-9e6c-b6a0d8d7a6cf', 'en', 'Before a big meeting', 'Walk in grounded and clear', array[
    'I am prepared, and I know more than I give myself credit for.',
    'My voice deserves to be heard in this room.',
    'I can pause, breathe, and answer with clarity.',
    'Nerves mean I care; they do not mean I''m unready.',
    'I speak slowly, simply, and with confidence.',
    'I don''t need to be perfect to be valuable here.',
    'I bring calm into every conversation I join.',
    'Whatever the outcome, I will learn and grow from it.'
  ]),
  ('1e8a0423-93da-485e-a1f4-1b8186ef5bbb', 'en', 'After a hard day', 'Be kind to yourself tonight', array[
    'It was a hard day, not a hard life.',
    'I did my best with what I had today.',
    'I let go of what I cannot change tonight.',
    'My worth is not measured by one difficult day.',
    'I am allowed to rest without earning it.',
    'I treat myself with the kindness I give to others.',
    'This feeling will pass, and I will feel lighter.',
    'I am proud of myself for getting through today.'
  ]),
  ('66511f6c-779b-43c2-b037-e9e0826be477', 'en', 'Exam day', 'Focus, recall, and stay steady', array[
    'I have prepared, and my mind remembers what I learned.',
    'I read each question calmly and answer what I know.',
    'If I get stuck, I breathe and move on with ease.',
    'My focus is sharp and my thoughts are clear.',
    'One exam does not define my future or my worth.',
    'I trust the work I have already put in.',
    'I stay present with one question at a time.',
    'I leave this exam proud of my effort.'
  ]),
  ('96cae753-dc0a-4f17-9261-ba0afa28b3b3', 'en', 'Worthy as I am', 'Self-worth for the quiet moments', array[
    'I am worthy of love exactly as I am right now.',
    'I don''t need to prove my value to anyone.',
    'I speak to myself with patience and warmth.',
    'My needs matter, and I honor them.',
    'I am allowed to take up space.',
    'I forgive myself for what I didn''t know then.',
    'I am becoming someone I am proud of.',
    'I deserve the same care I give so freely.'
  ])
on conflict (collection_id, language) do nothing;
