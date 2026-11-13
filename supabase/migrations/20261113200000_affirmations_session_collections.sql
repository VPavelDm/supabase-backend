-- Affirmations: every session points at a collection, and Favorites is one.
--
-- collections.kind says what a collection is:
--   builtin    our content (owner_id null), shown on Explore.
--   saved      the user's own, shown in "Your collections"; editable.
--   favorites  the user's hearts, one per user, newest first.
--   session    what one session played: the affirmations that started, in
--              the order they first started. Hidden, never edited; it is the
--              session's history and goes when the session goes.
--   prompt     everything queued for a session that had no collection to
--              point at, heard or not: a typed prompt's generated
--              affirmations ("What's on your mind?"), or Favorites as played.
--              Lets the session be replayed and saved in full. Hidden, never
--              edited.
--
-- sessions:
--   collection_id         its `session` collection (required; deleting the
--                         collection deletes the session).
--   source_collection_id  where it was played from: a built-in, saved or
--                         favorites collection, or the typed prompt's
--                         `prompt` collection. "Play again" and "Save" use it.
--   saved_collection_id   the collection the user saved from it, once.
--
-- The 100-collection cap counts saved collections only.
--
-- session_items and favorites are copied over and no longer used, but stay:
-- _shared/erase-user.ts still reads favorites for every app on this project,
-- so dropping it before the functions stop reading it would break every
-- app's delete-my-data. A later migration drops both. New rows all hang off
-- collections (owner_id), which delete-my-data and erase-user already cover.
--
-- Idempotent like every migration here.

-- =============================================================================
-- Schema
-- =============================================================================

alter table affirmations.collections add column if not exists kind text;

update affirmations.collections
set kind = case when owner_id is null then 'builtin' else 'saved' end
where kind is null;

alter table affirmations.collections alter column kind set not null;
alter table affirmations.collections alter column kind set default 'saved';

alter table affirmations.collections drop constraint if exists collections_kind_check;
alter table affirmations.collections add constraint collections_kind_check check (
  kind in ('builtin', 'saved', 'favorites', 'session', 'prompt')
  and ((owner_id is null) = (kind = 'builtin'))
);

create unique index if not exists collections_one_favorites_idx
  on affirmations.collections (owner_id) where kind = 'favorites';
create index if not exists collections_owner_kind_idx
  on affirmations.collections (owner_id, kind, created_at desc);

alter table affirmations.sessions
  add column if not exists source_collection_id uuid
    references affirmations.collections (id) on delete set null,
  add column if not exists saved_collection_id uuid
    references affirmations.collections (id) on delete set null;

create index if not exists sessions_source_collection_idx
  on affirmations.sessions (source_collection_id);
create index if not exists sessions_saved_collection_idx
  on affirmations.sessions (saved_collection_id);

-- =============================================================================
-- Data: each session gets its `session` collection; hearts become Favorites
-- =============================================================================

-- Until now collection_id was where a session was played from. A session
-- whose collection_id isn't a `session` collection yet is converted: that id
-- becomes its source, and its session_items its own collection.
do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select s.id, s.user_id, s.title, s.played_at, s.collection_id,
           src.icon as src_icon, src.tint as src_tint
    from affirmations.sessions s
    left join affirmations.collections cur on cur.id = s.collection_id
    left join affirmations.collections src on src.id = s.collection_id
    where cur.id is null or cur.kind <> 'session'
  loop
    v_id := gen_random_uuid();
    insert into affirmations.collections (id, owner_id, kind, title, icon, tint, created_at, updated_at)
    values (
      v_id, r.user_id, 'session',
      left(coalesce(nullif(btrim(r.title), ''), 'Your session'), 80),
      coalesce(r.src_icon, 'sparkles'), coalesce(r.src_tint, 'lavender'),
      r.played_at, r.played_at
    );
    insert into affirmations.collection_items (collection_id, position, affirmation_id)
    select v_id, row_number() over (order by first_pos), affirmation_id
    from (
      select i.affirmation_id, min(i.position) as first_pos
      from affirmations.session_items i
      where i.session_id = r.id
      group by i.affirmation_id
    ) heard;
    update affirmations.sessions
    set source_collection_id = r.collection_id,
        collection_id = v_id
    where id = r.id;
  end loop;
end;
$$;

-- A session left with nothing heard can't be replayed or shown; drop it.
delete from affirmations.sessions s
where not exists (select 1 from affirmations.collection_items i where i.collection_id = s.collection_id);
delete from affirmations.collections c
where c.kind = 'session'
  and not exists (select 1 from affirmations.sessions s where s.collection_id = c.id);

alter table affirmations.sessions alter column collection_id set not null;
alter table affirmations.sessions drop constraint if exists sessions_collection_id_fkey;
alter table affirmations.sessions add constraint sessions_collection_id_fkey
  foreign key (collection_id) references affirmations.collections (id) on delete cascade;

-- Hearts: one Favorites collection per user, newest first (lowest position).
insert into affirmations.collections (id, owner_id, kind, title, icon, tint)
select gen_random_uuid(), f.user_id, 'favorites', 'Favorites', 'heart.fill', 'lavender'
from (select distinct user_id from affirmations.favorites) f
where not exists (
  select 1 from affirmations.collections c where c.owner_id = f.user_id and c.kind = 'favorites'
);

insert into affirmations.collection_items (collection_id, position, affirmation_id)
select c.id, row_number() over (partition by f.user_id order by f.created_at desc, f.affirmation_id), f.affirmation_id
from affirmations.favorites f
join affirmations.collections c on c.owner_id = f.user_id and c.kind = 'favorites'
where not exists (select 1 from affirmations.collection_items i where i.collection_id = c.id)
on conflict do nothing;

-- =============================================================================
-- Helpers
-- =============================================================================

-- The user's Favorites collection, created on first use.
create or replace function affirmations.favorites_id(p_user uuid)
returns uuid
language plpgsql
set search_path to ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from affirmations.collections where owner_id = p_user and kind = 'favorites';
  if v_id is null then
    insert into affirmations.collections (id, owner_id, kind, title, icon, tint)
    values (gen_random_uuid(), p_user, 'favorites', 'Favorites', 'heart.fill', 'lavender')
    on conflict (owner_id) where kind = 'favorites' do nothing;
    select id into v_id from affirmations.collections where owner_id = p_user and kind = 'favorites';
  end if;
  return v_id;
end;
$$;

-- Fills a new collection with p_items ([{id, ...}]) in order, a repeated id
-- kept once where it first appears.
create or replace function affirmations.fill_collection(p_collection_id uuid, p_items jsonb)
returns void
language sql
set search_path to ''
as $$
  insert into affirmations.collection_items (collection_id, position, affirmation_id)
  select p_collection_id, row_number() over (order by first_ord), id
  from (
    select (e.value ->> 'id')::uuid as id, min(e.ordinality) as first_ord
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(value, ordinality)
    group by 1
  ) deduped;
$$;

-- A built-in collection's items in one language: the caller's, else its base
-- ("pt" for "pt-br"), else English, matching affirmations_get_library.
create or replace function affirmations.builtin_language(p_collection_id uuid, p_language text)
returns text
language sql stable
set search_path to ''
as $$
  select ct.language
  from affirmations.collection_texts ct
  where ct.collection_id = p_collection_id
    and lower(ct.language) in (
      lower(coalesce(nullif(btrim(p_language), ''), 'en')),
      split_part(lower(coalesce(nullif(btrim(p_language), ''), 'en')), '-', 1),
      'en'
    )
  order by case lower(ct.language)
    when lower(coalesce(nullif(btrim(p_language), ''), 'en')) then 0
    when split_part(lower(coalesce(nullif(btrim(p_language), ''), 'en')), '-', 1) then 1
    else 2 end
  limit 1;
$$;

-- Deletes the user's sessions beyond the newest 500, with their `session`
-- collections, and `prompt` collections no session plays from any more.
create or replace function affirmations.trim_sessions(p_user uuid)
returns void
language sql
set search_path to ''
as $$
  delete from affirmations.collections c
  using affirmations.sessions s
  where s.collection_id = c.id
    and s.id in (
      select id from affirmations.sessions
      where user_id = p_user
      order by played_at desc, id
      offset 500
    );
  delete from affirmations.collections c
  where c.owner_id = p_user and c.kind = 'prompt'
    and not exists (select 1 from affirmations.sessions s where s.source_collection_id = c.id);
$$;

-- A session for the app: what was heard (`items`), where it came from, and
-- what was saved from it. `source_items` carries a typed prompt's full list,
-- which the app has nowhere else; other sources are in the library.
create or replace function affirmations.session_json(s affirmations.sessions)
returns jsonb
language sql stable
set search_path to ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'collection_id', s.source_collection_id,
    'items', affirmations.collection_items_json(s.collection_id),
    'source_items', (
      select affirmations.collection_items_json(c.id)
      from affirmations.collections c
      where c.id = s.source_collection_id and c.kind = 'prompt'
    ),
    'saved_collection_id', s.saved_collection_id,
    'saved_collection_title', (select c.title from affirmations.collections c where c.id = s.saved_collection_id),
    'played_at', extract(epoch from s.played_at),
    'minutes_listened', s.minutes_listened,
    'mood', s.mood
  );
$$;

-- =============================================================================
-- RPCs
-- =============================================================================

-- As before, with "collections" only the saved ones and "favorites" read from
-- the Favorites collection (newest first).
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
      where c.kind = 'builtin' and c.enabled
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
    'sessions', v_sessions -> 'sessions',
    'has_more_sessions', v_sessions -> 'has_more'
  );
end;
$$;

-- Only the user's saved collections: Favorites changes through hearts, and
-- session and prompt collections never change.
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
     and (select count(*) from collections where owner_id = v_auth_id and kind = 'saved') >= 100 then
    raise exception 'too_many_collections';
  end if;

  insert into collections (id, owner_id, kind, title, icon, tint)
  values (p_id, v_auth_id, 'saved', v_title, p_icon, p_tint)
  on conflict (id) do update set
    title = excluded.title,
    icon = excluded.icon,
    tint = excluded.tint,
    updated_at = now()
  where collections.owner_id = v_auth_id and collections.kind = 'saved'
  returning * into v_collection;

  -- The id is built-in, someone else's, or not a saved collection.
  if not found then
    raise exception 'collection_not_found';
  end if;

  perform affirmations.ensure_affirmations(v_auth_id, p_items);

  delete from collection_items where collection_id = p_id;
  perform affirmations.fill_collection(p_id, p_items);

  return affirmations.collection_json(v_collection);
end;
$$;

create or replace function public.affirmations_delete_collection(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  -- Sessions saved as it become unsaved (saved_collection_id is set null).
  delete from collections where id = p_id and owner_id = v_auth_id and kind = 'saved';
  -- Deleting what is already gone is fine: the app retries writes.
  return jsonb_build_object('id', p_id, 'deleted', found);
end;
$$;

-- Records a session: p_items is what was heard ([{id, text, own}], the
-- affirmations that started, in order; at least one). p_source_collection_id
-- is the collection it was played from (one the user can see); without one,
-- p_queue is everything that was queued (a typed prompt's generated
-- affirmations, Favorites as played), heard or not. The id
-- is the app's; recording the same id again changes nothing, so the app can
-- retry. Only the newest 500 stay.
drop function if exists public.affirmations_record_session(uuid, text, jsonb, double precision, int, uuid);

create or replace function public.affirmations_record_session(
  p_id uuid,
  p_title text,
  p_items jsonb,
  p_played_at double precision,
  p_minutes_listened int default 0,
  p_source_collection_id uuid default null,
  p_queue jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := left(btrim(coalesce(p_title, '')), 200);
  v_short_title text;
  v_source collections%rowtype;
  v_source_id uuid;
  v_heard_id uuid := gen_random_uuid();
  v_session sessions%rowtype;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'empty_session';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'session_too_long';
  end if;
  if p_queue is not null and (
    jsonb_typeof(p_queue) <> 'array' or jsonb_array_length(p_queue) > 200
  ) then
    raise exception 'invalid_queue';
  end if;

  if exists (select 1 from sessions where id = p_id) then
    select * into v_session from sessions where id = p_id and user_id = v_auth_id;
    if not found then
      raise exception 'session_not_found';
    end if;
    return affirmations.session_json(v_session);
  end if;

  if v_title = '' then
    v_title := 'Your session';
  end if;
  v_short_title := left(v_title, 80);

  perform affirmations.ensure_affirmations(v_auth_id, p_items);

  -- Only a collection the user can see and play from.
  select * into v_source
  from collections
  where id = p_source_collection_id
    and (kind = 'builtin' or (owner_id = v_auth_id and kind in ('saved', 'favorites')));

  if found then
    v_source_id := v_source.id;
  elsif p_queue is not null and jsonb_array_length(p_queue) > 0 then
    perform affirmations.ensure_affirmations(v_auth_id, p_queue);
    v_source_id := gen_random_uuid();
    insert into collections (id, owner_id, kind, title, icon, tint)
    values (v_source_id, v_auth_id, 'prompt', v_short_title, 'sparkles', 'lavender');
    perform affirmations.fill_collection(v_source_id, p_queue);
  end if;

  insert into collections (id, owner_id, kind, title, icon, tint)
  values (
    v_heard_id, v_auth_id, 'session', v_short_title,
    coalesce(v_source.icon, 'sparkles'), coalesce(v_source.tint, 'lavender')
  );
  perform affirmations.fill_collection(v_heard_id, p_items);

  insert into sessions (id, user_id, title, collection_id, source_collection_id, played_at, minutes_listened)
  values (
    p_id, v_auth_id, v_title, v_heard_id, v_source_id,
    coalesce(to_timestamp(p_played_at), now()),
    greatest(coalesce(p_minutes_listened, 0), 0)
  )
  returning * into v_session;

  perform affirmations.trim_sessions(v_auth_id);

  return affirmations.session_json(v_session);
end;
$$;

grant execute on function public.affirmations_record_session(uuid, text, jsonb, double precision, int, uuid, jsonb) to authenticated;

-- Saves a session as one of the user's collections, once: the whole source
-- (a built-in in p_language, a saved collection, Favorites, or everything a
-- typed prompt generated), else what was heard. p_id is the app's id for the
-- new collection; saving again returns the collection already saved.
create or replace function public.affirmations_save_session(
  p_session_id uuid,
  p_id uuid,
  p_title text,
  p_icon text,
  p_tint text,
  p_language text default 'en'
)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_title text := btrim(coalesce(p_title, ''));
  v_session sessions%rowtype;
  v_source collections%rowtype;
  v_collection collections%rowtype;
begin
  select * into v_session from sessions where id = p_session_id and user_id = v_auth_id for update;
  if not found then
    raise exception 'session_not_found';
  end if;

  if v_session.saved_collection_id is not null then
    select * into v_collection from collections where id = v_session.saved_collection_id;
    return affirmations.collection_json(v_collection);
  end if;

  if v_title = '' or char_length(v_title) > 80 then
    raise exception 'invalid_title';
  end if;
  if coalesce(p_icon, '') = '' or char_length(p_icon) > 60
     or coalesce(p_tint, '') = '' or char_length(p_tint) > 30 then
    raise exception 'invalid_style';
  end if;
  if (select count(*) from collections where owner_id = v_auth_id and kind = 'saved') >= 100 then
    raise exception 'too_many_collections';
  end if;
  if exists (select 1 from collections where id = p_id) then
    raise exception 'collection_exists';
  end if;

  insert into collections (id, owner_id, kind, title, icon, tint)
  values (p_id, v_auth_id, 'saved', v_title, p_icon, p_tint)
  returning * into v_collection;

  select * into v_source from collections where id = v_session.source_collection_id;

  if v_source.kind = 'builtin' then
    insert into collection_items (collection_id, position, affirmation_id)
    select p_id, row_number() over (order by i.position), i.affirmation_id
    from collection_items i
    join affirmations a on a.id = i.affirmation_id
    where i.collection_id = v_source.id
      and a.language = affirmations.builtin_language(v_source.id, p_language)
    limit 200;
  else
    insert into collection_items (collection_id, position, affirmation_id)
    select p_id, row_number() over (order by i.position), i.affirmation_id
    from collection_items i
    where i.collection_id = coalesce(v_source.id, v_session.collection_id)
    limit 200;
  end if;

  update sessions set saved_collection_id = p_id where id = p_session_id;

  return affirmations.collection_json(v_collection);
end;
$$;

grant execute on function public.affirmations_save_session(uuid, uuid, text, text, text, text) to authenticated;

-- Deletes a session with its `session` collection, and its typed prompt's
-- `prompt` collection when nothing else plays from it. A collection saved
-- from it stays.
create or replace function public.affirmations_delete_session(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_session sessions%rowtype;
begin
  select * into v_session from sessions where id = p_id and user_id = v_auth_id;
  if not found then
    -- Deleting what is already gone is fine: the app retries writes.
    return jsonb_build_object('id', p_id, 'deleted', false);
  end if;
  delete from collections where id = v_session.collection_id and owner_id = v_auth_id;
  delete from collections c
  where c.id = v_session.source_collection_id and c.owner_id = v_auth_id and c.kind = 'prompt'
    and not exists (select 1 from sessions s where s.source_collection_id = c.id);
  return jsonb_build_object('id', p_id, 'deleted', true);
end;
$$;

-- Hearts (adds to the front of Favorites) or un-hearts one affirmation
-- ({id, text, own}). Repeating either is harmless.
create or replace function public.affirmations_set_favorite(p_affirmation jsonb, p_liked boolean)
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_id uuid := (p_affirmation ->> 'id')::uuid;
  v_favorites uuid;
begin
  if v_id is null then
    raise exception 'invalid_affirmation';
  end if;
  v_favorites := affirmations.favorites_id(v_auth_id);
  if p_liked then
    perform affirmations.ensure_affirmations(v_auth_id, jsonb_build_array(p_affirmation));
    if not exists (select 1 from collection_items where collection_id = v_favorites and affirmation_id = v_id) then
      if (select count(*) from collection_items where collection_id = v_favorites) >= 1000 then
        raise exception 'too_many_favorites';
      end if;
      insert into collection_items (collection_id, position, affirmation_id)
      select v_favorites, coalesce(min(position), 1) - 1, v_id
      from collection_items where collection_id = v_favorites;
    end if;
  else
    delete from collection_items where collection_id = v_favorites and affirmation_id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'liked', p_liked);
end;
$$;

-- One-time upload of the hearts an older build kept on the phone (texts only,
-- newest first), now into Favorites after the hearts already there. A text
-- already a favorite is skipped, and past 1,000 the rest are dropped.
create or replace function public.affirmations_import_favorites(p_texts text[])
returns jsonb
language plpgsql security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
  v_favorites uuid := affirmations.favorites_id(v_auth_id);
  v_room int := greatest(1000 - (select count(*) from collection_items where collection_id = v_favorites), 0);
  v_last int := (select coalesce(max(position), 0) from collection_items where collection_id = v_favorites);
begin
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
        select 1 from collection_items i join affirmations a on a.id = i.affirmation_id
        where i.collection_id = v_favorites and a.text = deduped.text
      )
    ) t
    where t.rank <= v_room
  ),
  created as (
    insert into affirmations (id, owner_id, text, source)
    select id, v_auth_id, text, 'generated' from pending
    returning id
  )
  insert into collection_items (collection_id, position, affirmation_id)
  select v_favorites, v_last + p.rank, p.id
  from pending p
  join created c on c.id = p.id;

  return affirmations.collection_items_json(v_favorites);
end;
$$;
