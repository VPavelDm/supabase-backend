-- Affirmations: the library tells the app its Favorites collection's id.
--
-- Favorites became a collection in 20261113200000, but the app still knew it
-- by a placeholder id, so a session played from Favorites had no source and
-- offered to save Favorites as a copy. affirmations_get_library now returns
-- favorites_id, creating the (empty) Favorites collection on first load so the
-- app always has it; the app records Favorites plays with it as the source,
-- like any other collection. It is no longer `stable`: it may insert that row.
--
-- Idempotent like every migration here.

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
    'has_more_sessions', v_sessions -> 'has_more'
  );
end;
$$;
