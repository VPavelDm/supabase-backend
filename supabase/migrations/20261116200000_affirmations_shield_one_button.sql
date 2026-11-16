-- Affirmations: one button label on every shield card.
--
-- The shield has a single button, which closes the blocked app (the way to
-- unlock is in each card's text). Half the cards labelled it "Not now"; now
-- every card uses its language's "Back to calm", the label the other half
-- already had. Titles and subtitles are unchanged. The bundled copy in
-- AppBlockerShieldConfiguration/ShieldTexts.json matches.
--
-- Idempotent: it sets each card's button by id.

update affirmations.shield_texts as t
set button = v.button
from (values
  ('en.later', 'Back to calm'),
  ('en.autopilot', 'Back to calm'),
  ('en.endless', 'Back to calm'),
  ('en.checkin', 'Back to calm'),
  ('ar.later', 'عُد إلى الهدوء'),
  ('ar.autopilot', 'عُد إلى الهدوء'),
  ('ar.endless', 'عُد إلى الهدوء'),
  ('ar.checkin', 'عُد إلى الهدوء'),
  ('de.later', 'Zurück zur Ruhe'),
  ('de.autopilot', 'Zurück zur Ruhe'),
  ('de.endless', 'Zurück zur Ruhe'),
  ('de.checkin', 'Zurück zur Ruhe'),
  ('es.later', 'Mejor la calma'),
  ('es.autopilot', 'Mejor la calma'),
  ('es.endless', 'Mejor la calma'),
  ('es.checkin', 'Mejor la calma'),
  ('fr.later', 'Retour au calme'),
  ('fr.autopilot', 'Retour au calme'),
  ('fr.endless', 'Retour au calme'),
  ('fr.checkin', 'Retour au calme'),
  ('it.later', 'Prima la calma'),
  ('it.autopilot', 'Prima la calma'),
  ('it.endless', 'Prima la calma'),
  ('it.checkin', 'Prima la calma'),
  ('ja.later', '心を整える'),
  ('ja.autopilot', '心を整える'),
  ('ja.endless', '心を整える'),
  ('ja.checkin', '心を整える'),
  ('ko.later', '평온으로 돌아가기'),
  ('ko.autopilot', '평온으로 돌아가기'),
  ('ko.endless', '평온으로 돌아가기'),
  ('ko.checkin', '평온으로 돌아가기'),
  ('nl.later', 'Terug naar rust'),
  ('nl.autopilot', 'Terug naar rust'),
  ('nl.endless', 'Terug naar rust'),
  ('nl.checkin', 'Terug naar rust'),
  ('pt-BR.later', 'Voltar à calma'),
  ('pt-BR.autopilot', 'Voltar à calma'),
  ('pt-BR.endless', 'Voltar à calma'),
  ('pt-BR.checkin', 'Voltar à calma'),
  ('pt-PT.later', 'Voltar à calma'),
  ('pt-PT.autopilot', 'Voltar à calma'),
  ('pt-PT.endless', 'Voltar à calma'),
  ('pt-PT.checkin', 'Voltar à calma'),
  ('ru.later', 'К спокойствию'),
  ('ru.autopilot', 'К спокойствию'),
  ('ru.endless', 'К спокойствию'),
  ('ru.checkin', 'К спокойствию'),
  ('tr.later', 'Sakinliğe dön'),
  ('tr.autopilot', 'Sakinliğe dön'),
  ('tr.endless', 'Sakinliğe dön'),
  ('tr.checkin', 'Sakinliğe dön'),
  ('zh-Hans.later', '回归平静'),
  ('zh-Hans.autopilot', '回归平静'),
  ('zh-Hans.endless', '回归平静'),
  ('zh-Hans.checkin', '回归平静'),
  ('zh-Hant.later', '回到平靜'),
  ('zh-Hant.autopilot', '回到平靜'),
  ('zh-Hant.endless', '回到平靜'),
  ('zh-Hant.checkin', '回到平靜')
) as v (id, button)
where t.id = v.id;
