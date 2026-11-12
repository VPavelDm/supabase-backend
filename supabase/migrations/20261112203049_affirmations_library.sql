-- Affirmations' library on the backend: the user's collections, the sessions
-- they listened to (with the mood they picked afterwards) and their
-- favorites, plus the built-in collections every user gets.
--
-- The model is relational: an affirmation is a row with an id, and
-- collections, sessions and favorites point at it.
--   affirmations      one sentence. owner_id null = built-in content (with a
--                     language); otherwise the user who generated or wrote it.
--                     Never edited in place: changed text is a new row, so a
--                     session always replays what was heard.
--   collections       built-in (owner_id null; slug, order, moments; titles
--                     per language in collection_texts) and the user's own.
--   collection_items  a collection's affirmations, in order.
--   sessions          a finished session; collection_id says which collection
--                     it was played from (null for a typed prompt, or once
--                     that collection is deleted).
--   session_items     what was heard, in order: the replayable snapshot.
--   favorites         the hearts.
-- Ids are minted by the app, so every write is safe to retry. An affirmation
-- row is created the first time it is kept (hearted, added to a collection,
-- or heard in a recorded session); generated ones never kept stay off the
-- server, and ones nothing points at any more are swept daily.
--
-- Session titles and the user's affirmations are their own words, so:
--   * every user row cascades with auth.users, and `userHoldsAppData`
--     (functions/_shared/erase-user.ts) lists these tables, or another app's
--     deletion would take them with the shared auth user;
--   * delete-my-data deletes them;
--   * the app reaches them only through the RPCs below: SECURITY DEFINER,
--     scoped to auth.uid(), granted to authenticated only. RLS is on with no
--     policy, so no token can touch the tables directly.
--   * a user can only point at their own affirmations or built-in ones.
--
-- Limits keep a free anonymous account from turning the project into
-- storage: 100 collections, 200 affirmations each, 400 characters an
-- affirmation (text-to-speech's own cap), 200 per session, 1,000 favorites,
-- and the newest 500 sessions (older ones are dropped as new ones arrive).
--
-- Idempotent like every migration here.

create schema if not exists affirmations;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists affirmations.affirmations (
  id uuid primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 400),
  -- Built-in content's language ("en", "de", "pt-br"); null for the user's.
  language text,
  -- builtin: our content. generated: written by the model for this user.
  -- written: typed by the user ("Your words").
  source text not null check (source in ('builtin', 'generated', 'written')),
  created_at timestamptz not null default now(),
  check ((owner_id is null) = (source = 'builtin')),
  check ((source = 'builtin') = (language is not null))
);

create index if not exists affirmations_owner_idx on affirmations.affirmations (owner_id);

create table if not exists affirmations.collections (
  id uuid primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  -- The user's own collections; built-in titles live in collection_texts.
  title text check (char_length(title) between 1 and 80),
  icon text not null check (char_length(icon) between 1 and 60),
  tint text not null check (char_length(tint) between 1 and 30),
  -- Built-in only: a stable handle, the order on Explore, the parts of the day
  -- Home offers it for (morning, day, evening, night), and a switch to hide it.
  slug text unique,
  position int,
  moments text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_id is null) = (slug is not null)),
  check (owner_id is null or title is not null)
);

create index if not exists collections_owner_created_idx
  on affirmations.collections (owner_id, created_at desc);

-- A built-in collection's words per language. The library takes the caller's
-- language, then the language without its region ("pt" for "pt-br"), then
-- English, and shows the affirmations in that same language.
create table if not exists affirmations.collection_texts (
  collection_id uuid not null references affirmations.collections (id) on delete cascade,
  language text not null,
  title text not null check (char_length(title) between 1 and 80),
  subtitle text not null default '',
  primary key (collection_id, language)
);

create table if not exists affirmations.collection_items (
  collection_id uuid not null references affirmations.collections (id) on delete cascade,
  position int not null,
  -- No cascade: an affirmation still in use can't be deleted.
  affirmation_id uuid not null references affirmations.affirmations (id),
  primary key (collection_id, position),
  unique (collection_id, affirmation_id)
);

create index if not exists collection_items_affirmation_idx
  on affirmations.collection_items (affirmation_id);

create table if not exists affirmations.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What the user typed, the suggestion they tapped, or the collection's name.
  title text not null check (char_length(title) <= 200),
  collection_id uuid references affirmations.collections (id) on delete set null,
  played_at timestamptz not null,
  minutes_listened int not null default 0 check (minutes_listened >= 0),
  -- 1 heavy … 5 great; null until (unless) the user picks one on the recap.
  mood smallint check (mood between 1 and 5),
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_played_idx
  on affirmations.sessions (user_id, played_at desc, id);
create index if not exists sessions_collection_idx
  on affirmations.sessions (collection_id);

create table if not exists affirmations.session_items (
  session_id uuid not null references affirmations.sessions (id) on delete cascade,
  position int not null,
  affirmation_id uuid not null references affirmations.affirmations (id),
  primary key (session_id, position)
);

create index if not exists session_items_affirmation_idx
  on affirmations.session_items (affirmation_id);

create table if not exists affirmations.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  affirmation_id uuid not null references affirmations.affirmations (id),
  created_at timestamptz not null default now(),
  primary key (user_id, affirmation_id)
);

create index if not exists favorites_user_created_idx
  on affirmations.favorites (user_id, created_at desc);
create index if not exists favorites_affirmation_idx
  on affirmations.favorites (affirmation_id);

-- Not exposed through PostgREST; the RPCs are the API. RLS on and no policy:
-- should the schema ever be exposed, no token could read or write a row.
alter table affirmations.affirmations enable row level security;
alter table affirmations.collections enable row level security;
alter table affirmations.collection_texts enable row level security;
alter table affirmations.collection_items enable row level security;
alter table affirmations.sessions enable row level security;
alter table affirmations.session_items enable row level security;
alter table affirmations.favorites enable row level security;

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

-- Makes sure every affirmation in p_items ([{id, text, own}]) exists and is
-- one the user may point at: their own or built-in. New ids become the user's
-- rows ("written" when own, else "generated"); existing ones are left as they
-- are (text never changes). Raises affirmation_not_found when an id belongs
-- to another user.
create or replace function affirmations.ensure_affirmations(p_user uuid, p_items jsonb)
returns void
language plpgsql
set search_path to ''
as $$
declare
  v_ids uuid[];
  v_visible int;
begin
  insert into affirmations.affirmations (id, owner_id, text, source)
  select distinct on ((e ->> 'id')::uuid)
         (e ->> 'id')::uuid,
         p_user,
         affirmations.clean_text(e ->> 'text'),
         case when coalesce((e ->> 'own')::boolean, false) then 'written' else 'generated' end
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e
  on conflict (id) do nothing;

  select array_agg(distinct (e ->> 'id')::uuid) into v_ids
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as e;

  select count(*) into v_visible
  from affirmations.affirmations a
  where a.id = any (coalesce(v_ids, '{}'))
    and (a.owner_id = p_user or a.owner_id is null);

  if v_visible <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'affirmation_not_found';
  end if;
end;
$$;

create or replace function affirmations.affirmation_json(a affirmations.affirmations)
returns jsonb
language sql immutable
set search_path to ''
as $$
  select jsonb_build_object('id', a.id, 'text', a.text, 'own', a.source = 'written');
$$;

-- A collection's or session's affirmations, in order.
create or replace function affirmations.collection_items_json(p_collection_id uuid, p_language text default null)
returns jsonb
language sql stable
set search_path to ''
as $$
  select coalesce(jsonb_agg(affirmations.affirmation_json(a) order by i.position), '[]'::jsonb)
  from affirmations.collection_items i
  join affirmations.affirmations a on a.id = i.affirmation_id
  where i.collection_id = p_collection_id
    and (p_language is null or a.language = p_language);
$$;

create or replace function affirmations.session_json(s affirmations.sessions)
returns jsonb
language sql stable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'collection_id', s.collection_id,
    'items', coalesce((
      select jsonb_agg(affirmations.affirmation_json(a) order by i.position)
      from affirmations.session_items i
      join affirmations.affirmations a on a.id = i.affirmation_id
      where i.session_id = s.id
    ), '[]'::jsonb),
    'played_at', extract(epoch from s.played_at),
    'minutes_listened', s.minutes_listened,
    'mood', s.mood
  );
$$;

create or replace function affirmations.collection_json(c affirmations.collections)
returns jsonb
language sql stable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'icon', c.icon,
    'tint', c.tint,
    'items', affirmations.collection_items_json(c.id),
    'created_at', extract(epoch from c.created_at),
    'updated_at', extract(epoch from c.updated_at)
  );
$$;

-- A page of the user's sessions, newest first, played before p_before (epoch
-- seconds; null = from the newest), and whether older ones remain.
create or replace function affirmations.sessions_page(p_user uuid, p_before double precision, p_limit int)
returns jsonb
language sql stable
set search_path to ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 50), 1), 100) as n
  ),
  page as (
    select s.id, s.played_at
    from affirmations.sessions s
    where s.user_id = p_user
      and (p_before is null or s.played_at < to_timestamp(p_before))
    order by s.played_at desc, s.id
    limit (select n from bounds) + 1
  ),
  shown as (
    select id from page order by played_at desc, id limit (select n from bounds)
  )
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(affirmations.session_json(s) order by s.played_at desc, s.id)
      from affirmations.sessions s
      where s.id in (select id from shown)
    ), '[]'::jsonb),
    'has_more', (select count(*) from page) > (select n from bounds)
  );
$$;

-- =============================================================================
-- RPCs
-- =============================================================================

-- Everything the library screens need at launch: the built-in collections in
-- the caller's language, the caller's collections and favorites (newest
-- first), and the newest sessions (`has_more_sessions` when older ones exist;
-- page through them with affirmations_get_sessions).
create or replace function public.affirmations_get_library(
  p_language text default 'en',
  p_session_limit int default 50
)
returns jsonb
language plpgsql stable security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_language text := lower(coalesce(nullif(btrim(p_language), ''), 'en'));
  v_base text := split_part(lower(coalesce(nullif(btrim(p_language), ''), 'en')), '-', 1);
  v_sessions jsonb := affirmations.sessions_page(v_auth_id, null, p_session_limit);
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
      where c.owner_id is null and c.enabled
    ), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(affirmations.collection_json(c) order by c.created_at desc, c.id)
      from collections c
      where c.owner_id = v_auth_id
    ), '[]'::jsonb),
    'favorites', coalesce((
      select jsonb_agg(affirmations.affirmation_json(a) order by f.created_at desc, a.id)
      from favorites f
      join affirmations a on a.id = f.affirmation_id
      where f.user_id = v_auth_id
    ), '[]'::jsonb),
    'sessions', v_sessions -> 'sessions',
    'has_more_sessions', v_sessions -> 'has_more'
  );
end;
$$;

grant execute on function public.affirmations_get_library(text, int) to authenticated;

-- Older sessions for history: those played before p_before (epoch seconds).
create or replace function public.affirmations_get_sessions(
  p_before double precision,
  p_limit int default 50
)
returns jsonb
language plpgsql stable security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  return affirmations.sessions_page(v_auth_id, p_before, p_limit);
end;
$$;

grant execute on function public.affirmations_get_sessions(double precision, int) to authenticated;

-- Creates or replaces one of the user's collections with its whole state. The
-- id is the app's (minted on the device), so create and every edit are the
-- same call. p_items: [{id, text, own}] in order; a repeated id is dropped.
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

  if not exists (select 1 from collections where id = p_id)
     and (select count(*) from collections where owner_id = v_auth_id) >= 100 then
    raise exception 'too_many_collections';
  end if;

  insert into collections (id, owner_id, title, icon, tint)
  values (p_id, v_auth_id, v_title, p_icon, p_tint)
  on conflict (id) do update set
    title = excluded.title,
    icon = excluded.icon,
    tint = excluded.tint,
    updated_at = now()
  where collections.owner_id = v_auth_id
  returning * into v_collection;

  -- The id is a built-in collection or someone else's.
  if not found then
    raise exception 'collection_not_found';
  end if;

  perform affirmations.ensure_affirmations(v_auth_id, p_items);

  delete from collection_items where collection_id = p_id;
  insert into collection_items (collection_id, position, affirmation_id)
  select p_id, row_number() over (order by first_ord), id
  from (
    select (e.value ->> 'id')::uuid as id, min(e.ordinality) as first_ord
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(value, ordinality)
    group by 1
  ) deduped;

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
  delete from collections where id = p_id and owner_id = v_auth_id;
  -- Deleting what is already gone is fine: the app retries writes.
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

grant execute on function public.affirmations_delete_collection(uuid) to authenticated;

-- Records a finished session: what was heard ([{id, text, own}] in order) and,
-- when it was played from a collection, which one. The id is the app's;
-- recording the same id again changes nothing, so the app can retry. Only the
-- newest 500 stay.
create or replace function public.affirmations_record_session(
  p_id uuid,
  p_title text,
  p_items jsonb,
  p_played_at double precision,
  p_minutes_listened int default 0,
  p_collection_id uuid default null
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_collection_id uuid;
  v_session sessions%rowtype;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'empty_session';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'session_too_long';
  end if;

  -- Only a collection the user can see: their own or a built-in one.
  select id into v_collection_id
  from collections
  where id = p_collection_id and (owner_id = v_auth_id or owner_id is null);

  if exists (select 1 from sessions where id = p_id) then
    select * into v_session from sessions where id = p_id and user_id = v_auth_id;
    if not found then
      raise exception 'session_not_found';
    end if;
    return affirmations.session_json(v_session);
  end if;

  perform affirmations.ensure_affirmations(v_auth_id, p_items);

  insert into sessions (id, user_id, title, collection_id, played_at, minutes_listened)
  values (
    p_id, v_auth_id, v_title, v_collection_id,
    coalesce(to_timestamp(p_played_at), now()),
    greatest(coalesce(p_minutes_listened, 0), 0)
  )
  returning * into v_session;

  insert into session_items (session_id, position, affirmation_id)
  select p_id, e.ordinality, (e.value ->> 'id')::uuid
  from jsonb_array_elements(p_items) with ordinality as e(value, ordinality);

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

grant execute on function public.affirmations_record_session(uuid, text, jsonb, double precision, int, uuid) to authenticated;

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

-- Hearts or un-hearts one affirmation ({id, text, own}). Repeating either is
-- harmless.
create or replace function public.affirmations_set_favorite(p_affirmation jsonb, p_liked boolean)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_id uuid := (p_affirmation ->> 'id')::uuid;
begin
  if v_id is null then
    raise exception 'invalid_affirmation';
  end if;
  if p_liked then
    perform affirmations.ensure_affirmations(v_auth_id, jsonb_build_array(p_affirmation));
    if not exists (select 1 from favorites where user_id = v_auth_id and affirmation_id = v_id)
       and (select count(*) from favorites where user_id = v_auth_id) >= 1000 then
      raise exception 'too_many_favorites';
    end if;
    insert into favorites (user_id, affirmation_id) values (v_auth_id, v_id)
    on conflict (user_id, affirmation_id) do nothing;
  else
    delete from favorites where user_id = v_auth_id and affirmation_id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'liked', p_liked);
end;
$$;

grant execute on function public.affirmations_set_favorite(jsonb, boolean) to authenticated;

-- One-time upload of the hearts an older build kept on the phone (texts only,
-- newest first). Each becomes one of the user's affirmations and a favorite;
-- a text already among their favorites is skipped, and past 1,000 the rest
-- are dropped. Returns the favorites as the library would.
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
  -- Each imported heart is a second older than the one before it, so "newest
  -- first" keeps the phone's order.
  with pending as materialized (
  select gen_random_uuid() as id, t.text, t.rank
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
    where not exists (
      select 1 from favorites f join affirmations a on a.id = f.affirmation_id
      where f.user_id = v_auth_id and a.text = deduped.text
    )
  ) t
  where t.rank <= v_room
  ),
  created as (
    insert into affirmations (id, owner_id, text, source)
    select id, v_auth_id, text, 'generated' from pending
    returning id
  )
  insert into favorites (user_id, affirmation_id, created_at)
  select v_auth_id, p.id, v_oldest - make_interval(secs => p.rank)
  from pending p
  join created c on c.id = p.id;

  return coalesce((
    select jsonb_agg(affirmations.affirmation_json(a) order by f.created_at desc, a.id)
    from favorites f
    join affirmations a on a.id = f.affirmation_id
    where f.user_id = v_auth_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.affirmations_import_favorites(text[]) to authenticated;

-- =============================================================================
-- Daily sweep: usage counters past the cap window, and the user's affirmations
-- nothing points at any more (removed from a collection, un-hearted, or their
-- session deleted). A day's grace keeps one an app is about to reuse.
-- =============================================================================

select cron.schedule('affirmations-cleanup', '37 4 * * *', $$
  delete from affirmations.ai_usage where day < current_date - 30;
  delete from affirmations.affirmations a
  where a.owner_id is not null
    and a.created_at < now() - interval '1 day'
    and not exists (select 1 from affirmations.collection_items i where i.affirmation_id = a.id)
    and not exists (select 1 from affirmations.session_items i where i.affirmation_id = a.id)
    and not exists (select 1 from affirmations.favorites f where f.affirmation_id = a.id);
$$);

-- =============================================================================
-- Built-in content (placeholder, English). Affirmation ids are derived from
-- the collection, language and position, so a re-run finds the same rows and
-- inserts nothing; edits made since are never overwritten. To change a text,
-- add a new affirmation row and point the collection at it (rows are never
-- edited in place: sessions that played the old one replay it as heard).
-- =============================================================================

create temp table seed (slug text, position int, icon text, tint text, moments text[],
                        title text, subtitle text, texts text[]);

insert into seed values
  ('morning-3-min', 10, 'sun.max.fill', 'amber', '{morning}', 'Morning, 3 min', 'A calm, steady start to the day', array[
    'I welcome this day with an open and steady heart.',
    'I have everything I need to meet today with calm.',
    'I choose to focus on what I can influence today.',
    'My energy is clear, and my mind is ready.',
    'I give myself permission to start gently.',
    'Today I move at a pace that feels right for me.',
    'I am grateful for this fresh beginning.',
    'I trust myself to handle whatever this day brings.'
  ]),
  ('cant-sleep', 20, 'moon.stars.fill', 'lavender', '{night}', 'Can''t sleep', 'Quiet a busy mind and drift off', array[
    'I release today and everything it asked of me.',
    'My thoughts can wait until morning; right now I rest.',
    'My body is heavy, warm, and safe.',
    'With every breath out, I let go a little more.',
    'I did enough today, and I am enough tonight.',
    'Sleep comes to me easily when I stop chasing it.',
    'I am safe here, in this moment, in this bed.',
    'Tomorrow will meet me rested and ready.'
  ]),
  ('before-a-big-meeting', 30, 'briefcase.fill', 'sky', '{day}', 'Before a big meeting', 'Walk in grounded and clear', array[
    'I am prepared, and I know more than I give myself credit for.',
    'My voice deserves to be heard in this room.',
    'I can pause, breathe, and answer with clarity.',
    'Nerves mean I care; they do not mean I''m unready.',
    'I speak slowly, simply, and with confidence.',
    'I don''t need to be perfect to be valuable here.',
    'I bring calm into every conversation I join.',
    'Whatever the outcome, I will learn and grow from it.'
  ]),
  ('after-a-hard-day', 40, 'leaf.fill', 'mint', '{evening}', 'After a hard day', 'Be kind to yourself tonight', array[
    'It was a hard day, not a hard life.',
    'I did my best with what I had today.',
    'I let go of what I cannot change tonight.',
    'My worth is not measured by one difficult day.',
    'I am allowed to rest without earning it.',
    'I treat myself with the kindness I give to others.',
    'This feeling will pass, and I will feel lighter.',
    'I am proud of myself for getting through today.'
  ]),
  ('exam-day', 50, 'book.fill', 'teal', '{day}', 'Exam day', 'Focus, recall, and stay steady', array[
    'I have prepared, and my mind remembers what I learned.',
    'I read each question calmly and answer what I know.',
    'If I get stuck, I breathe and move on with ease.',
    'My focus is sharp and my thoughts are clear.',
    'One exam does not define my future or my worth.',
    'I trust the work I have already put in.',
    'I stay present with one question at a time.',
    'I leave this exam proud of my effort.'
  ]),
  ('worthy-as-i-am', 60, 'heart.fill', 'rose', '{evening}', 'Worthy as I am', 'Self-worth for the quiet moments', array[
    'I am worthy of love exactly as I am right now.',
    'I don''t need to prove my value to anyone.',
    'I speak to myself with patience and warmth.',
    'My needs matter, and I honor them.',
    'I am allowed to take up space.',
    'I forgive myself for what I didn''t know then.',
    'I am becoming someone I am proud of.',
    'I deserve the same care I give so freely.'
  ]);

insert into affirmations.collections (id, owner_id, icon, tint, slug, position, moments)
select md5('affirmations:collection:' || slug)::uuid, null, icon, tint, slug, position, moments
from seed
on conflict (id) do nothing;

insert into affirmations.collection_texts (collection_id, language, title, subtitle)
select md5('affirmations:collection:' || slug)::uuid, 'en', title, subtitle
from seed
on conflict (collection_id, language) do nothing;

insert into affirmations.affirmations (id, owner_id, text, language, source)
select md5('affirmations:builtin:' || s.slug || ':en:' || t.ord)::uuid, null, t.text, 'en', 'builtin'
from seed s
cross join lateral unnest(s.texts) with ordinality as t(text, ord)
on conflict (id) do nothing;

insert into affirmations.collection_items (collection_id, position, affirmation_id)
select md5('affirmations:collection:' || s.slug)::uuid, t.ord,
       md5('affirmations:builtin:' || s.slug || ':en:' || t.ord)::uuid
from seed s
cross join lateral unnest(s.texts) with ordinality as t(text, ord)
on conflict do nothing;

drop table seed;
