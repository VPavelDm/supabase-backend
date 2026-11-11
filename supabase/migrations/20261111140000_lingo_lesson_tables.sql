-- The Lingo apps' lessons as tables, edited in place (Table Editor or SQL)
-- and read live: lingo/content calls lingo.content_bundle(app) on every
-- request, which builds the JSON the apps decode. There is no publish step,
-- so a saved row reaches every learner at their next launch. Run
-- content/lingo/check.ts after edits: it builds the bundle and runs the
-- format checks on it.
--
-- Replaces lingo.lesson_content (one stored JSON body per file). The content
-- itself is inserted by the next migration.
--
-- Every piece of text a learner sees is a row in `texts`, with one
-- `translations` row per language: the learned language (`en` in Hutarka,
-- `pl` in Hejka) is just another row. Positions order rows within their
-- parent and need not be consecutive, so an item can go between two others
-- (position 15 between 10 and 20). A lesson that no unit step points to is a
-- draft: it is kept but not sent to the apps.
--
-- Idempotent like every migration here — the shared project is long-lived
-- and re-runs happen.

create schema if not exists lingo;

drop table if exists lingo.lesson_content;

create table if not exists lingo.texts (
  id uuid primary key default gen_random_uuid(),
  app text not null
);

create table if not exists lingo.translations (
  text_id uuid not null references lingo.texts (id) on delete cascade,
  -- `en`, `pl`, `zh-Hant`, …: the learned language or a learner's language.
  language text not null,
  value text not null,
  -- The same text for a female learner, only where it differs (Hejka).
  value_female text,
  updated_at timestamptz not null default now(),
  primary key (text_id, language)
);

create table if not exists lingo.lessons (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  -- The lesson's id in the apps: their progress and speech cache use it, so
  -- renaming a lesson is a removal plus an addition.
  slug text not null,
  -- Who the boar talks to in the scene.
  partner text not null check (partner in ('fox', 'owl', 'dog', 'rabbit')),
  title_id uuid not null references lingo.texts (id),
  subtitle_id uuid not null references lingo.texts (id),
  -- Shown on a card before the scene; learner languages only.
  tip_id uuid references lingo.texts (id),
  -- The swap drill's phrase, with `{slot}` where each swap item's word goes.
  swap_frame text not null check (swap_frame like '%{slot}%'),
  unique (app, slug)
);

create table if not exists lingo.chapters (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  slug text not null,
  position int not null,
  title_id uuid not null references lingo.texts (id),
  unique (app, slug)
);

create table if not exists lingo.units (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references lingo.chapters (id) on delete cascade,
  position int not null,
  map text not null check (map in ('forest', 'meadow', 'farm')),
  title_id uuid not null references lingo.texts (id)
);

-- The stumps of a unit's map, bottom first. A step without a lesson is the
-- chapter's checkpoint, which the apps build from the chapter's lessons. A
-- lesson on the trail cannot be deleted: take its step out first.
create table if not exists lingo.unit_steps (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references lingo.units (id) on delete cascade,
  position int not null,
  lesson_id uuid references lingo.lessons (id)
);

create table if not exists lingo.scene_lines (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null,
  speaker text not null check (speaker in ('boar', 'other')),
  text_id uuid not null references lingo.texts (id),
  -- The boar's lines only: what the learner does in "Your turn". `build`:
  -- extra tiles mixed into the line's words; `choose`: wrong replies.
  task_kind text check (task_kind in ('build', 'choose')),
  task_options text[],
  check ((task_kind is null) = (task_options is null))
);

create table if not exists lingo.words (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null,
  text_id uuid not null references lingo.texts (id),
  -- The scene line it comes from, in the learned language, exactly.
  example text not null,
  example_female text
);

create table if not exists lingo.phrases (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null,
  text_id uuid not null references lingo.texts (id),
  -- Extra tiles when building it; the word blanked out; wrong fillers.
  distractors text[] not null,
  gap text not null,
  gap_wrong text[] not null,
  -- Behind a hint button during the phrase's exercises; learner languages only.
  tip_id uuid references lingo.texts (id)
);

create table if not exists lingo.swap_items (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null,
  word_id uuid not null references lingo.texts (id),
  sentence_id uuid not null references lingo.texts (id)
);

create index if not exists translations_value_idx on lingo.translations (language, value);
create index if not exists units_chapter_idx on lingo.units (chapter_id);
create index if not exists unit_steps_unit_idx on lingo.unit_steps (unit_id);
create index if not exists scene_lines_lesson_idx on lingo.scene_lines (lesson_id);
create index if not exists words_lesson_idx on lingo.words (lesson_id);
create index if not exists phrases_lesson_idx on lingo.phrases (lesson_id);
create index if not exists swap_items_lesson_idx on lingo.swap_items (lesson_id);

drop trigger if exists translations_updated_at on lingo.translations;
create trigger translations_updated_at before update on lingo.translations
  for each row execute function shared.set_updated_at();

-- Not exposed through PostgREST (api.schemas stays public + graphql_public):
-- the route reads them over the direct connection. RLS on as a
-- belt-and-braces guard, same as lingo.ai_usage.
alter table lingo.texts enable row level security;
alter table lingo.translations enable row level security;
alter table lingo.lessons enable row level security;
alter table lingo.chapters enable row level security;
alter table lingo.units enable row level security;
alter table lingo.unit_steps enable row level security;
alter table lingo.scene_lines enable row level security;
alter table lingo.words enable row level security;
alter table lingo.phrases enable row level security;
alter table lingo.swap_items enable row level security;

-- A text object as the apps read it: {"en": "…", "ru": "…", "ru_f": "…"}.
create or replace function lingo.text_object(p_text_id uuid)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_object_agg(language, value)
    || coalesce(jsonb_object_agg(language || '_f', value_female)
                filter (where value_female is not null), '{}'::jsonb)
  from translations
  where text_id = p_text_id
$$;

-- One lesson as the apps read it (content/lingo/README.md). A tip's `show`
-- follows from where it sits: `auto` on the lesson, `tap` on a phrase.
create or replace function lingo.lesson_object(p_lesson_id uuid)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', l.slug,
    'title', text_object(l.title_id),
    'subtitle', text_object(l.subtitle_id),
    'with', l.partner,
    'tip', case when l.tip_id is not null
      then jsonb_build_object('show', 'auto', 'text', text_object(l.tip_id)) end,
    'scene', coalesce((
      select jsonb_agg(jsonb_build_object(
        'speaker', s.speaker,
        'text', text_object(s.text_id),
        'task', case when s.task_kind is not null
          then jsonb_build_object(s.task_kind, to_jsonb(s.task_options)) end
      ) order by s.position, s.id)
      from scene_lines s where s.lesson_id = l.id), '[]'::jsonb),
    'words', coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', text_object(w.text_id),
        'example', w.example,
        'example_f', w.example_female
      ) order by w.position, w.id)
      from words w where w.lesson_id = l.id), '[]'::jsonb),
    'phrases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'text', text_object(p.text_id),
        'distractors', to_jsonb(p.distractors),
        'gap', p.gap,
        'gapWrong', to_jsonb(p.gap_wrong),
        'tip', case when p.tip_id is not null
          then jsonb_build_object('show', 'tap', 'text', text_object(p.tip_id)) end
      ) order by p.position, p.id)
      from phrases p where p.lesson_id = l.id), '[]'::jsonb),
    'swap', jsonb_build_object(
      'frame', l.swap_frame,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'word', text_object(i.word_id),
          'sentence', text_object(i.sentence_id)
        ) order by i.position, i.id)
        from swap_items i where i.lesson_id = l.id), '[]'::jsonb)
    )
  ))
  from lessons l
  where l.id = p_lesson_id
$$;

-- What lingo/content sends an app: its trail and every lesson on it (drafts,
-- lessons no step points to, stay out). `checkpoint` stands for a step
-- without a lesson.
create or replace function lingo.content_bundle(p_app text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_build_object(
    'trail', jsonb_build_object('chapters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.slug,
        'title', text_object(c.title_id),
        'units', coalesce((
          select jsonb_agg(jsonb_build_object(
            'title', text_object(u.title_id),
            'map', u.map,
            'lessons', coalesce((
              select jsonb_agg(coalesce(l.slug, 'checkpoint') order by st.position, st.id)
              from unit_steps st left join lessons l on l.id = st.lesson_id
              where st.unit_id = u.id), '[]'::jsonb)
          ) order by u.position, u.id)
          from units u where u.chapter_id = c.id), '[]'::jsonb)
      ) order by c.position, c.id)
      from chapters c where c.app = p_app), '[]'::jsonb)),
    'lessons', coalesce((
      select jsonb_object_agg(l.slug, lesson_object(l.id))
      from lessons l
      where l.app = p_app
        and exists (
          select 1 from unit_steps st
          join units u on u.id = st.unit_id
          join chapters c on c.id = u.chapter_id
          where st.lesson_id = l.id and c.app = p_app)), '{}'::jsonb)
  )
$$;

-- Every text in use, with where it sits, for searching and filtering:
--   select * from lingo.content_texts where value ilike '%please%';
--   select * from lingo.content_texts where app = 'hejka' and language = 'tr' order by updated_at desc;
-- Edit the value in lingo.translations by its text_id and language.
create or replace view lingo.content_texts with (security_invoker = true) as
with placed as (
  select c.app, null::text as lesson, 'chapter title' as part, c.position, c.title_id as text_id
    from lingo.chapters c
  union all
  select c.app, null, 'unit title', c.position * 1000 + u.position, u.title_id
    from lingo.units u join lingo.chapters c on c.id = u.chapter_id
  union all
  select l.app, l.slug, 'title', 0, l.title_id from lingo.lessons l
  union all
  select l.app, l.slug, 'subtitle', 0, l.subtitle_id from lingo.lessons l
  union all
  select l.app, l.slug, 'tip', 0, l.tip_id from lingo.lessons l where l.tip_id is not null
  union all
  select l.app, l.slug, 'scene line', s.position, s.text_id
    from lingo.scene_lines s join lingo.lessons l on l.id = s.lesson_id
  union all
  select l.app, l.slug, 'word', w.position, w.text_id
    from lingo.words w join lingo.lessons l on l.id = w.lesson_id
  union all
  select l.app, l.slug, 'phrase', p.position, p.text_id
    from lingo.phrases p join lingo.lessons l on l.id = p.lesson_id
  union all
  select l.app, l.slug, 'phrase tip', p.position, p.tip_id
    from lingo.phrases p join lingo.lessons l on l.id = p.lesson_id where p.tip_id is not null
  union all
  select l.app, l.slug, 'swap word', i.position, i.word_id
    from lingo.swap_items i join lingo.lessons l on l.id = i.lesson_id
  union all
  select l.app, l.slug, 'swap sentence', i.position, i.sentence_id
    from lingo.swap_items i join lingo.lessons l on l.id = i.lesson_id
)
select p.app, p.lesson, p.part, p.position, t.language, t.value, t.value_female, t.updated_at, p.text_id
from placed p
join lingo.translations t on t.text_id = p.text_id;
