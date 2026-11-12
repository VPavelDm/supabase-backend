-- Premium lessons: a whole lesson only Premium learners can open.
--
-- Unlike a premium step (20261112120000), which a free learner still gets and the app draws
-- locked, a premium lesson never reaches a free learner: lingo/content asks Adapty whether the
-- caller has Premium and, when they don't, sends the lesson as a stub — its id, title, subtitle
-- and partner with `"locked": true` and nothing to play. The app shows it locked on the trail and
-- opens the paywall; after a purchase it asks for the lessons again and gets the whole lesson.
--
-- App builds from before `locked` read the stub as a lesson with no steps. Mark lessons premium
-- only once every build in use knows `locked` (iOS and Android from the premium-exercises
-- branches on), and never the trail's first lesson: onboarding plays it to everyone.
--
-- Nothing is premium until marked:
--   update lingo.lessons set premium = true where app = 'hejka' and slug = '…';

alter table lingo.lessons
  add column if not exists premium boolean not null default false;

comment on column lingo.lessons.premium is
  'Only Premium learners get this lesson; others get a locked stub (lingo.content_bundle).';

-- What a free learner gets for a premium lesson: enough to draw its stump, nothing to play.
create or replace function lingo.locked_lesson_object(p_lesson_id uuid, p_language text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_build_object(
    'id', l.slug,
    'title', native_text(l.title_id, p_language),
    'subtitle', native_text(l.subtitle_id, p_language),
    'with', l.partner,
    'locked', true,
    'scenes', '[]'::jsonb,
    'words', '[]'::jsonb,
    'phrases', '[]'::jsonb,
    'steps', '[]'::jsonb
  )
  from lessons l
  where l.id = p_lesson_id
$$;

-- Whether the app has any premium lesson on its trail, so lingo/content asks Adapty only then.
create or replace function lingo.has_premium_lessons(p_app text)
returns boolean
language sql stable
set search_path to 'lingo'
as $$
  select exists (
    select 1 from lessons l
    join stumps st on st.lesson_id = l.id
    join units u on u.id = st.unit_id
    join chapters c on c.id = u.chapter_id
    where l.premium and l.app = p_app and c.app = p_app)
$$;

-- The bundle as before, with `p_unlocked` saying whether the caller has Premium: without it,
-- premium lessons come as locked stubs. The three-argument form stays for anything calling it
-- as before and sends everything, as it always did.
create or replace function lingo.content_bundle(p_app text, p_learned text, p_language text, p_unlocked boolean)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_build_object(
    'chapters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.slug,
        'title', native_text(c.title_id, p_language),
        'units', coalesce((
          select jsonb_agg(jsonb_build_object(
            'title', native_text(u.title_id, p_language),
            'map', u.map,
            'lessons', coalesce((
              select jsonb_agg(coalesce(l.slug, 'checkpoint') order by st.position, st.id)
              from stumps st left join lessons l on l.id = st.lesson_id
              where st.unit_id = u.id), '[]'::jsonb)
          ) order by u.position, u.id)
          from units u where u.chapter_id = c.id), '[]'::jsonb)
      ) order by c.position, c.id)
      from chapters c where c.app = p_app), '[]'::jsonb),
    'lessons', coalesce((
      select jsonb_object_agg(l.slug, case
        when l.premium and not p_unlocked then locked_lesson_object(l.id, p_language)
        else lesson_object(l.id, p_learned, p_language) end)
      from lessons l
      where l.app = p_app
        and exists (
          select 1 from stumps st
          join units u on u.id = st.unit_id
          join chapters c on c.id = u.chapter_id
          where st.lesson_id = l.id and c.app = p_app)), '{}'::jsonb)
  )
$$;

create or replace function lingo.content_bundle(p_app text, p_learned text, p_language text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select lingo.content_bundle(p_app, p_learned, p_language, true)
$$;
