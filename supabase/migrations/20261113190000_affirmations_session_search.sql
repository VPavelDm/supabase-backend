-- Affirmations: search the session history by title.
--
-- History becomes "Your library" in the app, with a search bar over every
-- session, not just the loaded pages. sessions_page and
-- affirmations_get_sessions take an optional p_query: sessions whose title
-- contains it, ignoring case. Plain text, no wildcards (position(), not LIKE).
-- Without p_query both behave exactly as before.

drop function if exists affirmations.sessions_page(uuid, double precision, int);

create or replace function affirmations.sessions_page(
  p_user uuid,
  p_before double precision,
  p_limit int,
  p_query text default null
)
returns jsonb
language sql stable
set search_path to ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 50), 1), 100) as n,
           lower(nullif(btrim(p_query), '')) as q
  ),
  page as (
    select s.id, s.played_at
    from affirmations.sessions s, bounds b
    where s.user_id = p_user
      and (p_before is null or s.played_at < to_timestamp(p_before))
      and (b.q is null or position(b.q in lower(s.title)) > 0)
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

drop function if exists public.affirmations_get_sessions(double precision, int);

-- Older sessions for history: those played before p_before (epoch seconds;
-- null = from the newest), optionally only those whose title contains p_query.
create or replace function public.affirmations_get_sessions(
  p_before double precision,
  p_limit int default 50,
  p_query text default null
)
returns jsonb
language plpgsql stable security definer
set search_path to 'affirmations'
as $$
declare
  v_auth_id uuid := affirmations.require_user();
begin
  return affirmations.sessions_page(v_auth_id, p_before, p_limit, p_query);
end;
$$;

grant execute on function public.affirmations_get_sessions(double precision, int, text) to authenticated;
