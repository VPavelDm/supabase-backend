-- Lesson format 2: a lesson is the sequence of steps its teacher writes, and
-- the apps get one learner language per request.
--
-- * `lesson_steps`: one row per step, played in `position` order exactly as
--   written (tips, word cards, quizzes, phrase exercises, swaps, the scene and
--   "Your turn", in any order and as often as wanted). `kind` is free text:
--   the apps drop a step whose kind they don't know, so a new exercise needs
--   no migration. Data only that step uses lives on it (a fill-the-gap's gap
--   and wrong options, a build's extra tiles, a whole swap: frame, word,
--   sentence, wrong options, a tip's text); data several steps share (scenes,
--   words, phrases) lives on the lesson and the step points at it. A check
--   constraint makes every kind the apps know carry what it needs, since edits
--   are live. `step_words` lists the words of a `match_words` step (none: all
--   of the lesson's words).
-- * `scenes`: a lesson's conversations, so it can have more than one;
--   `scene_lines` belong to a scene now.
-- * `unit_steps` becomes `stumps`, so "steps" only means lesson steps, and a
--   unit holds at most three: the map art has three clearings.
--
-- The lesson-level tip, the swap drill (`lessons.swap_frame`, `swap_items`)
-- and the phrases' exercise data (`distractors`, `gap`, `gap_wrong`) move into
-- steps. Every existing lesson gets the steps the apps used to generate, in
-- the same order, with one fixed exercise per word and two per phrase, varied
-- across items.
--
-- lingo.content_bundle(app, learned, language) builds format 2: titles and
-- tips as plain strings in the learner's language, learned material as
-- {"<learned>": …, "<language>": …} (+ `_f` variants), "" for a missing
-- translation.
--
-- Idempotent like every migration here: the data move runs only while the old
-- columns exist.

-- Views and functions over the old shape go first: the old columns can't be
-- dropped while they read them.
drop view if exists lingo.content_texts;
drop function if exists lingo.content_bundle(text);
drop function if exists lingo.lesson_object(uuid);
drop function if exists lingo.text_object(uuid);

-- Trail ---------------------------------------------------------------------

alter table if exists lingo.unit_steps rename to stumps;
alter index if exists lingo.unit_steps_unit_idx rename to stumps_unit_idx;
do $$
begin
  if exists (select from pg_constraint where conname = 'unit_steps_lesson_id_fkey') then
    alter table lingo.stumps rename constraint unit_steps_lesson_id_fkey to stumps_lesson_id_fkey;
    alter table lingo.stumps rename constraint unit_steps_unit_id_fkey to stumps_unit_id_fkey;
    alter table lingo.stumps rename constraint unit_steps_pkey to stumps_pkey;
  end if;
end $$;

create or replace function lingo.limit_stumps()
returns trigger
language plpgsql
set search_path to 'lingo'
as $$
begin
  if (select count(*) from stumps where unit_id = new.unit_id) > 3 then
    raise exception 'A unit has three stumps: unit % already has three', new.unit_id
      using hint = 'Put the lesson in another unit, or replace one of this unit''s stumps.';
  end if;
  return null;
end;
$$;

drop trigger if exists stumps_limit on lingo.stumps;
create trigger stumps_limit
  after insert or update of unit_id on lingo.stumps
  for each row execute function lingo.limit_stumps();

-- Scenes, steps -------------------------------------------------------------

create table if not exists lingo.scenes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null
);
create index if not exists scenes_lesson_idx on lingo.scenes (lesson_id);
alter table lingo.scenes enable row level security;

alter table lingo.scene_lines add column if not exists scene_id uuid references lingo.scenes (id) on delete cascade;

create table if not exists lingo.lesson_steps (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lingo.lessons (id) on delete cascade,
  position int not null,
  kind text not null,
  -- What the step points at, among the lesson's shared material.
  scene_id uuid references lingo.scenes (id),
  word_id uuid references lingo.words (id),
  phrase_id uuid references lingo.phrases (id),
  -- What only this step uses: a tip's text, or a swap's word and sentence.
  text_id uuid references lingo.texts (id),
  sentence_id uuid references lingo.texts (id),
  -- In the learned language, never translated.
  frame text,
  gap text,
  wrong text[],
  extra text[],
  constraint lesson_steps_fields check (case kind
    when 'scene' then scene_id is not null
    when 'conversation' then scene_id is not null
    when 'tip' then text_id is not null
    when 'word_card' then word_id is not null
    when 'listen_pick' then word_id is not null
    when 'pick_meaning' then word_id is not null
    when 'say_in_english' then word_id is not null
    when 'spell' then word_id is not null
    when 'pick_translation' then phrase_id is not null
    when 'fill_gap' then phrase_id is not null and gap is not null and wrong is not null
    when 'spot_mistake' then phrase_id is not null and gap is not null and wrong is not null
    when 'build_phrase' then phrase_id is not null and extra is not null
    when 'listen_build' then phrase_id is not null and extra is not null
    when 'swap' then frame like '%{slot}%' and text_id is not null and sentence_id is not null and wrong is not null
    else true
  end)
);
create index if not exists lesson_steps_lesson_idx on lingo.lesson_steps (lesson_id);
alter table lingo.lesson_steps enable row level security;

create table if not exists lingo.step_words (
  step_id uuid not null references lingo.lesson_steps (id) on delete cascade,
  word_id uuid not null references lingo.words (id),
  position int not null,
  primary key (step_id, word_id)
);
alter table lingo.step_words enable row level security;

-- The move ------------------------------------------------------------------

do $$
declare
  v_lesson record;
  v_scene uuid;
  v_learned text;
  v_pos int;
  v_i int;
  v_item record;
  v_formats text[];
  v_kind text;
begin
  -- Only while the old shape is there: a re-run finds the columns gone.
  if not exists (
    select from information_schema.columns
    where table_schema = 'lingo' and table_name = 'phrases' and column_name = 'gap'
  ) then
    return;
  end if;

  for v_lesson in select * from lingo.lessons order by app, slug loop
    -- The learned language, for the swap's wrong options and the exercise picks.
    v_learned := case v_lesson.app when 'hutarka' then 'en' when 'hejka' then 'pl' end;
    if v_learned is null then
      raise exception 'No learned language for app %', v_lesson.app;
    end if;

    insert into lingo.scenes (lesson_id, position) values (v_lesson.id, 10) returning id into v_scene;
    execute 'update lingo.scene_lines set scene_id = $1 where lesson_id = $2' using v_scene, v_lesson.id;

    v_pos := 0;

    if v_lesson.tip_id is not null then
      v_pos := v_pos + 10;
      insert into lingo.lesson_steps (lesson_id, position, kind, text_id)
      values (v_lesson.id, v_pos, 'tip', v_lesson.tip_id);
    end if;

    v_pos := v_pos + 10;
    insert into lingo.lesson_steps (lesson_id, position, kind, scene_id) values (v_lesson.id, v_pos, 'scene', v_scene);

    for v_item in select * from lingo.words where lesson_id = v_lesson.id order by position, id loop
      v_pos := v_pos + 10;
      insert into lingo.lesson_steps (lesson_id, position, kind, word_id) values (v_lesson.id, v_pos, 'word_card', v_item.id);
    end loop;

    -- One quiz per word, the format varied across the words; spelling only
    -- for a short single word.
    v_i := 0;
    for v_item in
      select w.id, t.value from lingo.words w
      join lingo.translations t on t.text_id = w.text_id and t.language = v_learned
      where w.lesson_id = v_lesson.id order by w.position, w.id
    loop
      v_formats := array['listen_pick', 'pick_meaning', 'say_in_english'];
      if position(' ' in v_item.value) = 0 and char_length(v_item.value) <= 8 then
        v_formats := array_append(v_formats, 'spell');
      end if;
      v_kind := v_formats[(v_i % array_length(v_formats, 1)) + 1];
      v_pos := v_pos + 10;
      insert into lingo.lesson_steps (lesson_id, position, kind, word_id) values (v_lesson.id, v_pos, v_kind, v_item.id);
      v_i := v_i + 1;
    end loop;

    -- Two exercises per phrase: recognise it, then produce it. Spotting the
    -- wrong word only in a phrase of four words or more.
    v_i := 0;
    for v_item in
      execute 'select p.id, p.gap, p.gap_wrong, p.distractors, t.value from lingo.phrases p
               join lingo.translations t on t.text_id = p.text_id and t.language = $1
               where p.lesson_id = $2 order by p.position, p.id'
      using v_learned, v_lesson.id
    loop
      v_formats := array['fill_gap', 'pick_translation'];
      if array_length(string_to_array(v_item.value, ' '), 1) >= 4 then
        v_formats := array_append(v_formats, 'spot_mistake');
      end if;
      v_kind := v_formats[(v_i % array_length(v_formats, 1)) + 1];
      v_pos := v_pos + 10;
      insert into lingo.lesson_steps (lesson_id, position, kind, phrase_id, gap, wrong)
      values (v_lesson.id, v_pos, v_kind, v_item.id,
              case when v_kind <> 'pick_translation' then v_item.gap end,
              case when v_kind <> 'pick_translation' then v_item.gap_wrong end);
      v_kind := (array['build_phrase', 'listen_build'])[(v_i % 2) + 1];
      v_pos := v_pos + 10;
      insert into lingo.lesson_steps (lesson_id, position, kind, phrase_id, extra)
      values (v_lesson.id, v_pos, v_kind, v_item.id, v_item.distractors);
      v_i := v_i + 1;
    end loop;

    -- The swap drill: one step per item, its wrong options the other items' words.
    for v_item in
      execute 'select i.id, i.word_id, i.sentence_id from lingo.swap_items i
               where i.lesson_id = $1 order by i.position, i.id'
      using v_lesson.id
    loop
      v_pos := v_pos + 10;
      execute 'insert into lingo.lesson_steps (lesson_id, position, kind, text_id, sentence_id, frame, wrong)
               select $1, $2, ''swap'', $3, $4, l.swap_frame,
                 (select array_agg(t.value order by o.position, o.id) from lingo.swap_items o
                  join lingo.translations t on t.text_id = o.word_id and t.language = $5
                  where o.lesson_id = $1 and o.id <> $6)
               from lingo.lessons l where l.id = $1'
      using v_lesson.id, v_pos, v_item.word_id, v_item.sentence_id, v_learned, v_item.id;
    end loop;

    v_pos := v_pos + 10;
    insert into lingo.lesson_steps (lesson_id, position, kind, scene_id) values (v_lesson.id, v_pos, 'conversation', v_scene);
  end loop;

  alter table lingo.scene_lines alter column scene_id set not null;
  alter table lingo.scene_lines drop column lesson_id;
  drop table lingo.swap_items;
  alter table lingo.lessons drop column tip_id, drop column swap_frame;
  alter table lingo.phrases drop column distractors, drop column gap, drop column gap_wrong;
end $$;

create index if not exists scene_lines_scene_idx on lingo.scene_lines (scene_id);
drop index if exists lingo.scene_lines_lesson_idx;

-- Building format 2 ----------------------------------------------------------

-- Text in the learner's language only: titles, subtitles, tips. "" when missing.
create or replace function lingo.native_text(p_text_id uuid, p_language text)
returns text
language sql stable
set search_path to 'lingo'
as $$
  select coalesce((select value from translations where text_id = p_text_id and language = p_language), '')
$$;

-- Learned material: {"<learned>": …, "<language>": …}, plus `<code>_f` where a
-- female learner sees something else. "" when missing.
create or replace function lingo.material(p_text_id uuid, p_learned text, p_language text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_build_object(
      p_learned, coalesce(max(value) filter (where language = p_learned), ''),
      p_language, coalesce(max(value) filter (where language = p_language), ''))
    || coalesce(jsonb_object_agg(language || '_f', value_female)
         filter (where value_female is not null and language in (p_learned, p_language)), '{}'::jsonb)
  from translations
  where text_id = p_text_id
$$;

-- Positions of shared material within its lesson, counted from 0 in the order
-- the bundle lists it. Null in, null out.
create or replace function lingo.scene_index(p_scene_id uuid) returns int
language sql stable strict set search_path to 'lingo' as $$
  select count(*)::int from scenes o join scenes s on s.id = p_scene_id
  where o.lesson_id = s.lesson_id and (o.position, o.id) < (s.position, s.id)
$$;

create or replace function lingo.word_index(p_word_id uuid) returns int
language sql stable strict set search_path to 'lingo' as $$
  select count(*)::int from words o join words w on w.id = p_word_id
  where o.lesson_id = w.lesson_id and (o.position, o.id) < (w.position, w.id)
$$;

create or replace function lingo.phrase_index(p_phrase_id uuid) returns int
language sql stable strict set search_path to 'lingo' as $$
  select count(*)::int from phrases o join phrases p on p.id = p_phrase_id
  where o.lesson_id = p.lesson_id and (o.position, o.id) < (p.position, p.id)
$$;

-- One step: its kind and whatever of its fields are set. A swap's word is
-- learned material; any other step's text is in the learner's language.
create or replace function lingo.step_object(p_step_id uuid, p_learned text, p_language text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', st.kind,
    'scene', scene_index(st.scene_id),
    'word', case when st.kind = 'swap' then material(st.text_id, p_learned, p_language)
                 else to_jsonb(word_index(st.word_id)) end,
    'words', (select jsonb_agg(word_index(sw.word_id) order by sw.position, sw.word_id)
              from step_words sw where sw.step_id = st.id),
    'phrase', phrase_index(st.phrase_id),
    'text', case when st.kind <> 'swap' and st.text_id is not null
                 then to_jsonb(native_text(st.text_id, p_language)) end,
    'sentence', case when st.sentence_id is not null then material(st.sentence_id, p_learned, p_language) end,
    'frame', st.frame,
    'gap', st.gap,
    'wrong', to_jsonb(st.wrong),
    'extra', to_jsonb(st.extra)
  ))
  from lesson_steps st
  where st.id = p_step_id
$$;

create or replace function lingo.lesson_object(p_lesson_id uuid, p_learned text, p_language text)
returns jsonb
language sql stable
set search_path to 'lingo'
as $$
  select jsonb_build_object(
    'id', l.slug,
    'title', native_text(l.title_id, p_language),
    'subtitle', native_text(l.subtitle_id, p_language),
    'with', l.partner,
    'scenes', coalesce((
      select jsonb_agg(coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'speaker', sl.speaker,
          'text', material(sl.text_id, p_learned, p_language),
          'task', case when sl.task_kind is not null
            then jsonb_build_object(sl.task_kind, to_jsonb(sl.task_options)) end
        )) order by sl.position, sl.id)
        from scene_lines sl where sl.scene_id = s.id), '[]'::jsonb) order by s.position, s.id)
      from scenes s where s.lesson_id = l.id), '[]'::jsonb),
    'words', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'text', material(w.text_id, p_learned, p_language),
        'example', w.example,
        'example_f', w.example_female
      )) order by w.position, w.id)
      from words w where w.lesson_id = l.id), '[]'::jsonb),
    'phrases', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'text', material(p.text_id, p_learned, p_language),
        'tip', case when p.tip_id is not null then native_text(p.tip_id, p_language) end
      )) order by p.position, p.id)
      from phrases p where p.lesson_id = l.id), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(step_object(st.id, p_learned, p_language) order by st.position, st.id)
      from lesson_steps st where st.lesson_id = l.id), '[]'::jsonb)
  )
  from lessons l
  where l.id = p_lesson_id
$$;

-- What lingo/content sends: the app's chapters and every lesson on its trail
-- (lessons no stump points to are drafts and stay out), in one learner
-- language. `checkpoint` stands for a stump without a lesson.
create or replace function lingo.content_bundle(p_app text, p_learned text, p_language text)
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
      select jsonb_object_agg(l.slug, lesson_object(l.id, p_learned, p_language))
      from lessons l
      where l.app = p_app
        and exists (
          select 1 from stumps st
          join units u on u.id = st.unit_id
          join chapters c on c.id = u.chapter_id
          where st.lesson_id = l.id and c.app = p_app)), '{}'::jsonb)
  )
$$;

-- Searching ------------------------------------------------------------------

-- Every text in use and where it sits; `learned` marks learned material, which
-- needs the learned language as well as every learner language.
create or replace view lingo.content_text_places with (security_invoker = true) as
  select c.app, null::text as lesson, 'chapter title' as part, c.position, c.title_id as text_id, false as learned
    from lingo.chapters c
  union all
  select c.app, null, 'unit title', c.position * 1000 + u.position, u.title_id, false
    from lingo.units u join lingo.chapters c on c.id = u.chapter_id
  union all
  select l.app, l.slug, 'title', 0, l.title_id, false from lingo.lessons l
  union all
  select l.app, l.slug, 'subtitle', 0, l.subtitle_id, false from lingo.lessons l
  union all
  select l.app, l.slug, 'scene line', s.position * 1000 + sl.position, sl.text_id, true
    from lingo.scene_lines sl join lingo.scenes s on s.id = sl.scene_id join lingo.lessons l on l.id = s.lesson_id
  union all
  select l.app, l.slug, 'word', w.position, w.text_id, true
    from lingo.words w join lingo.lessons l on l.id = w.lesson_id
  union all
  select l.app, l.slug, 'phrase', p.position, p.text_id, true
    from lingo.phrases p join lingo.lessons l on l.id = p.lesson_id
  union all
  select l.app, l.slug, 'phrase tip', p.position, p.tip_id, false
    from lingo.phrases p join lingo.lessons l on l.id = p.lesson_id where p.tip_id is not null
  union all
  select l.app, l.slug, 'tip', st.position, st.text_id, false
    from lingo.lesson_steps st join lingo.lessons l on l.id = st.lesson_id
    where st.kind <> 'swap' and st.text_id is not null
  union all
  select l.app, l.slug, 'swap word', st.position, st.text_id, true
    from lingo.lesson_steps st join lingo.lessons l on l.id = st.lesson_id
    where st.kind = 'swap' and st.text_id is not null
  union all
  select l.app, l.slug, 'swap sentence', st.position, st.sentence_id, true
    from lingo.lesson_steps st join lingo.lessons l on l.id = st.lesson_id
    where st.sentence_id is not null;

-- The texts with their translations, for searching and filtering:
--   select * from lingo.content_texts where value ilike '%please%';
-- Edit the value in lingo.translations by its text_id and language.
create or replace view lingo.content_texts with (security_invoker = true) as
  select p.app, p.lesson, p.part, p.position, t.language, t.value, t.value_female, t.updated_at, p.text_id
  from lingo.content_text_places p
  join lingo.translations t on t.text_id = p.text_id;
