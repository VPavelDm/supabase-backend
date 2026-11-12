-- Premium exercises: each lesson step says whether only Premium learners play it.
--
-- `premium` is set per step, so a teacher can open or close any single exercise. The bundle sends
-- `"premium": true` on those steps and nothing on the rest; app builds from before this flag read
-- only the fields they know, so they keep playing every step.
--
-- Free learners meet a locked card on a premium step, with Unlock (the paywall) and Skip. Builds
-- whose store is off lock nothing.
--
-- To start, the deeper practice is premium in both apps (decided 2026-11-12): swap, listen and
-- build, spell, the conversation turn, "how do you say it in …" (say_in_english) and spot the
-- mistake. Word cards, tips, scenes, picking meanings and translations, listen and pick, fill the
-- gap and build the phrase stay free. New steps are free until marked.

alter table lingo.lesson_steps
  add column if not exists premium boolean not null default false;

comment on column lingo.lesson_steps.premium is
  'Only Premium learners play this step; others get a locked card to unlock or skip.';

update lingo.lesson_steps
   set premium = true
 where kind in ('swap', 'listen_build', 'spell', 'conversation', 'say_in_english', 'spot_mistake')
   and not premium;

-- One step: its kind, whatever of its fields are set, and premium when it is.
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
    'extra', to_jsonb(st.extra),
    'premium', case when st.premium then true end
  ))
  from lesson_steps st
  where st.id = p_step_id
$$;
