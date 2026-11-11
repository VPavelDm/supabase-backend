-- Gives back the fill-the-gap exercise of the 30 phrases that lost it in format 2.
--
-- The bundled lesson files had a gap and two wrong fillers on every phrase, and the app picked
-- fill the gap, pick the translation or spot the mistake at random. Format 2 kept one fixed
-- exercise per phrase; where that was pick the translation, the phrase's gap was dropped with
-- the old phrase columns. Each comes back as a fill_gap step between the phrase's
-- pick_translation and listen_build steps, taken from the last bundled lesson files
-- (Hutarka iOS repo, commit 4954e7c~1).
--
-- Lessons only get longer: no step is moved or removed, so no learner's place on the trail
-- changes. A phrase that already has a step with this gap is skipped, so a rerun adds nothing.

do $$
declare
  r record;
  v_lesson uuid;
  v_phrase uuid;
  v_after int;
  v_next int;
  v_added int := 0;
begin
  for r in select * from (values
    ('hutarka', 'a-little-english', 'Do you speak Spanish?', 'speak', array['speaks', 'talk']),
    ('hutarka', 'call-me', 'Nice to meet you.', 'meet', array['meat', 'meets']),
    ('hutarka', 'do-you-have', 'Do you have a city map?', 'Do', array['Does', 'Are']),
    ('hutarka', 'dont-understand', 'Could you say that again more slowly?', 'slowly', array['slowing', 'slower']),
    ('hutarka', 'excuse-me', 'No problem.', 'No', array['Not', 'Any']),
    ('hutarka', 'hello', 'Thank you, you too!', 'too', array['to', 'two']),
    ('hutarka', 'hi', 'Good, and you?', 'and', array['or', 'but']),
    ('hutarka', 'id-like', 'Anything else?', 'else', array['other', 'more']),
    ('hutarka', 'nice-to-meet-you', 'My name is Alex.', 'is', array['are', 'am']),
    ('hutarka', 'numbers', 'And then?', 'then', array['than', 'them']),
    ('hutarka', 'please', 'You''re welcome!', 'welcome', array['welcomed', 'welcomes']),
    ('hutarka', 'thank-you', 'Yes, thanks!', 'thanks', array['thank', 'thanked']),
    ('hutarka', 'what-does-it-mean', 'How do you spell it?', 'spell', array['spells', 'spelling']),
    ('hutarka', 'what-time', 'It''s five o''clock.', 'o''clock', array['clock', 'o''clocks']),
    ('hejka', 'co-to-znaczy', 'Jak to się pisze?', 'pisze', array['piszę', 'pisać']),
    ('hejka', 'czesc', 'Dobrze, a u ciebie?', 'ciebie', array['ty', 'tobie']),
    ('hejka', 'dziekuje', 'Nie ma za co!', 'ma', array['jest', 'mam']),
    ('hejka', 'dzien-dobry', 'Dziękuję, nawzajem!', 'nawzajem', array['razem', 'naprawdę']),
    ('hejka', 'ktora-godzina', 'Jest piąta.', 'piąta', array['pięć', 'piąty']),
    ('hejka', 'liczby', 'A dalej?', 'dalej', array['daleko', 'dalszy']),
    ('hejka', 'na-ty', 'Bardzo mi miło.', 'miło', array['miły', 'miła']),
    ('hejka', 'nie-rozumiem', 'Może pani powtórzyć wolniej?', 'wolniej', array['wolno', 'szybciej']),
    ('hejka', 'pan-i-pani', 'Czy ma pan mapę miasta?', 'pan', array['pani', 'ty']),
    ('hejka', 'po-polsku', 'Mówię trochę po polsku.', 'trochę', array['dużo', 'mało']),
    ('hejka', 'po-polsku', 'Uczę się polskiego.', 'polskiego', array['polski', 'polsku']),
    ('hejka', 'poprosze', 'Coś jeszcze?', 'jeszcze', array['już', 'więcej']),
    ('hejka', 'poznajmy-sie', 'Mam na imię Kuba.', 'Mam', array['Masz', 'Jestem']),
    ('hejka', 'poznajmy-sie', 'Mieszkam w Warszawie.', 'Warszawie', array['Warszawa', 'Warszawę']),
    ('hejka', 'prosze', 'Proszę bardzo!', 'bardzo', array['dużo', 'dobrze']),
    ('hejka', 'przepraszam', 'Nic nie szkodzi.', 'szkodzi', array['szkoda', 'szkodzę'])
  ) as t(app, lesson, phrase, gap, wrong)
  loop
    select l.id, p.id into v_lesson, v_phrase
      from lingo.lessons l
      join lingo.phrases p on p.lesson_id = l.id
      join lingo.translations tr on tr.text_id = p.text_id
     where l.app = r.app and l.slug = r.lesson
       and tr.language = case r.app when 'hutarka' then 'en' else 'pl' end
       and tr.value = r.phrase;
    if v_phrase is null then
      raise exception 'gap steps: no phrase % in %/%', r.phrase, r.app, r.lesson;
    end if;

    continue when exists (
      select 1 from lingo.lesson_steps
       where phrase_id = v_phrase and kind in ('fill_gap', 'spot_mistake') and gap = r.gap
    );

    -- Right after the phrase's pick_translation step, before its listen_build step.
    select max(position) into v_after
      from lingo.lesson_steps where phrase_id = v_phrase and kind = 'pick_translation';
    if v_after is null then
      raise exception 'gap steps: no pick_translation step for % in %/%', r.phrase, r.app, r.lesson;
    end if;
    select min(position) into v_next
      from lingo.lesson_steps where lesson_id = v_lesson and position > v_after;
    if v_next is not null and v_next - v_after < 2 then
      raise exception 'gap steps: no room after position % in %/%', v_after, r.app, r.lesson;
    end if;

    insert into lingo.lesson_steps (lesson_id, position, kind, phrase_id, gap, wrong)
    values (v_lesson, coalesce(v_after + (v_next - v_after) / 2, v_after + 10), 'fill_gap',
            v_phrase, r.gap, r.wrong);
    v_added := v_added + 1;
  end loop;
  raise notice 'gap steps: added %', v_added;
end
$$;
