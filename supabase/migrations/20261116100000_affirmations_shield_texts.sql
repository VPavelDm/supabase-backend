-- Affirmations: texts for the App Blocker's shield screen.
--
-- When a blocked app opens, iOS shows a shield drawn by an extension of the
-- app. The extension has no network, so the app downloads this pool while it's
-- open and keeps it in its App Group; the extension picks a random card from it
-- (never the one shown last). The app bundles the same English set for phones
-- that haven't downloaded anything yet.
--
-- A card is a title (up to ~40 characters), a subtitle (~90) and the label of
-- the button that closes the blocked app (~15); the limits below are a little
-- looser so a translation can run longer. Cards are per language; the app falls
-- back to English. Turn a card off with is_active instead of deleting it.
--
-- No user data: nothing to add to erase-user.ts or delete-my-data.ts.
--
-- Idempotent like every migration here.

-- MARK: - Table

create table if not exists affirmations.shield_texts (
  id text primary key check (char_length(id) between 1 and 64),
  language text not null check (char_length(language) between 2 and 8),
  title text not null check (char_length(title) between 1 and 60),
  subtitle text not null check (char_length(subtitle) between 1 and 120),
  button text not null check (char_length(button) between 1 and 24),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shield_texts_language_idx
  on affirmations.shield_texts (language, sort_order) where is_active;

drop trigger if exists affirmations_set_updated_at on affirmations.shield_texts;
create trigger affirmations_set_updated_at
  before update on affirmations.shield_texts
  for each row execute function shared.set_updated_at();

alter table affirmations.shield_texts enable row level security;
revoke all on affirmations.shield_texts from public, anon, authenticated;

-- MARK: - Seed (the set bundled with the shield extension, every language)

insert into affirmations.shield_texts (id, language, title, subtitle, button, sort_order) values
  ('en.pause', 'en', 'A small pause', 'This app can wait. Take 30 seconds for yourself in Here first.', 'Back to calm', 0),
  ('en.later', 'en', 'Not right now', 'Your feed will still be there. This moment won''t.', 'Not now', 1),
  ('en.breath', 'en', 'Take a breath first', 'Thirty seconds of calm, then it''s all yours.', 'Back to calm', 2),
  ('en.autopilot', 'en', 'Opened this on autopilot?', 'Maybe, maybe not. Either way, breathe first.', 'Not now', 3),
  ('en.nothing', 'en', 'You''re allowed to do nothing', 'Sit with it for a minute. Nothing here needs you yet.', 'Back to calm', 4),
  ('en.endless', 'en', 'Still scrolling?', 'The scroll is endless. Your evening isn''t.', 'Not now', 5),
  ('en.attention', 'en', 'Easy does it', 'I choose what gets my attention.', 'Back to calm', 6),
  ('en.checkin', 'en', 'Check in with yourself', 'How do you feel? Ask yourself before the app tells you.', 'Not now', 7),
  ('ar.pause', 'ar', 'استراحة قصيرة', 'هذا التطبيق يمكنه الانتظار. امنح نفسك 30 ثانية في Here أولًا.', 'عُد إلى الهدوء', 0),
  ('ar.later', 'ar', 'ليس الآن، ربما لاحقًا', 'سيبقى موجزك في مكانه. أما هذه اللحظة فلن تبقى.', 'ليس الآن', 1),
  ('ar.breath', 'ar', 'خذ نفسًا أولًا', 'ثلاثون ثانية من الهدوء، ثم كل شيء لك.', 'عُد إلى الهدوء', 2),
  ('ar.autopilot', 'ar', 'هل فتحته تلقائيًا دون تفكير؟', 'ربما نعم، وربما لا. في الحالتين، تنفّس أولًا.', 'ليس الآن', 3),
  ('ar.nothing', 'ar', 'لا بأس ألّا تفعل شيئًا', 'ابقَ هكذا دقيقة. لا شيء هنا يحتاجك بعد.', 'عُد إلى الهدوء', 4),
  ('ar.endless', 'ar', 'ما زلت تتصفّح؟', 'التمرير لا ينتهي. أما أمسيتك فتنتهي.', 'ليس الآن', 5),
  ('ar.attention', 'ar', 'على مهلك', 'أنا أختار ما يستحق انتباهي.', 'عُد إلى الهدوء', 6),
  ('ar.checkin', 'ar', 'اطمئن على نفسك', 'كيف تشعر؟ اسأل نفسك قبل أن يخبرك التطبيق.', 'ليس الآن', 7),
  ('de.pause', 'de', 'Eine kleine Pause', 'Diese App kann warten. Nimm dir zuerst 30 Sekunden für dich in Here.', 'Zurück zur Ruhe', 0),
  ('de.later', 'de', 'Nicht jetzt', 'Dein Feed ist später noch da. Dieser Moment nicht.', 'Jetzt nicht', 1),
  ('de.breath', 'de', 'Erst mal durchatmen', 'Dreißig Sekunden Ruhe, dann gehört alles dir.', 'Zurück zur Ruhe', 2),
  ('de.autopilot', 'de', 'Auf Autopilot geöffnet?', 'Vielleicht, vielleicht auch nicht. So oder so: Erst mal atmen.', 'Jetzt nicht', 3),
  ('de.nothing', 'de', 'Du darfst auch mal nichts tun', 'Bleib eine Minute dabei. Noch braucht dich hier nichts.', 'Zurück zur Ruhe', 4),
  ('de.endless', 'de', 'Immer noch am Scrollen?', 'Der Feed ist endlos. Dein Abend nicht.', 'Jetzt nicht', 5),
  ('de.attention', 'de', 'Ganz in Ruhe', 'Ich entscheide, was meine Aufmerksamkeit bekommt.', 'Zurück zur Ruhe', 6),
  ('de.checkin', 'de', 'Hör kurz in dich hinein', 'Wie fühlst du dich? Frag dich selbst, bevor die App es dir sagt.', 'Jetzt nicht', 7),
  ('es.pause', 'es', 'Una pequeña pausa', 'Esta app puede esperar. Tómate primero 30 segundos para ti en Here.', 'Mejor la calma', 0),
  ('es.later', 'es', 'Ahora mismo no', 'Tu feed seguirá ahí. Este momento, no.', 'Ahora no', 1),
  ('es.breath', 'es', 'Primero, respira', 'Treinta segundos de calma y luego todo es tuyo.', 'Mejor la calma', 2),
  ('es.autopilot', 'es', '¿La abriste en piloto automático?', 'Quizá sí, quizá no. Sea como sea, primero respira.', 'Ahora no', 3),
  ('es.nothing', 'es', 'Puedes no hacer nada', 'Quédate así un minuto. Aquí nada te necesita todavía.', 'Mejor la calma', 4),
  ('es.endless', 'es', '¿Sigues haciendo scroll?', 'El scroll es infinito. Tu noche, no.', 'Ahora no', 5),
  ('es.attention', 'es', 'Con calma', 'Yo elijo qué recibe mi atención.', 'Mejor la calma', 6),
  ('es.checkin', 'es', 'Conecta contigo', '¿Cómo te sientes? Pregúntatelo antes de que la app te lo diga.', 'Ahora no', 7),
  ('fr.pause', 'fr', 'Une petite pause', 'Cette app peut attendre. Prends d''abord 30 secondes pour toi dans Here.', 'Retour au calme', 0),
  ('fr.later', 'fr', 'Pas tout de suite', 'Ton fil sera toujours là. Ce moment, non.', 'Pas maintenant', 1),
  ('fr.breath', 'fr', 'Respire d''abord', 'Trente secondes de calme, et ensuite tout est à toi.', 'Retour au calme', 2),
  ('fr.autopilot', 'fr', 'Ouverte en pilote automatique ?', 'Peut-être, peut-être pas. Dans tous les cas, respire d''abord.', 'Pas maintenant', 3),
  ('fr.nothing', 'fr', 'Tu as le droit de ne rien faire', 'Reste avec ça une minute. Rien ici n''a encore besoin de toi.', 'Retour au calme', 4),
  ('fr.endless', 'fr', 'Toujours en train de scroller ?', 'Le scroll est sans fin. Ta soirée, non.', 'Pas maintenant', 5),
  ('fr.attention', 'fr', 'Tout en douceur', 'Je choisis ce qui mérite mon attention.', 'Retour au calme', 6),
  ('fr.checkin', 'fr', 'Prends des nouvelles de toi', 'Comment te sens-tu ? Demande-le-toi avant que l''app ne te le dise.', 'Pas maintenant', 7),
  ('it.pause', 'it', 'Una piccola pausa', 'Questa app può aspettare. Prima prenditi 30 secondi per te in Here.', 'Prima la calma', 0),
  ('it.later', 'it', 'Non adesso', 'Il tuo feed sarà ancora lì. Questo momento no.', 'Non ora', 1),
  ('it.breath', 'it', 'Prima un respiro', 'Trenta secondi di calma, poi è tutto tuo.', 'Prima la calma', 2),
  ('it.autopilot', 'it', 'Aperta col pilota automatico?', 'Forse sì, forse no. In ogni caso, prima respira.', 'Non ora', 3),
  ('it.nothing', 'it', 'Puoi anche non fare niente', 'Resta così per un minuto. Qui niente ha ancora bisogno di te.', 'Prima la calma', 4),
  ('it.endless', 'it', 'Ancora a scorrere?', 'Lo scroll è infinito. La tua serata no.', 'Non ora', 5),
  ('it.attention', 'it', 'Con calma', 'Scelgo io a cosa dare la mia attenzione.', 'Prima la calma', 6),
  ('it.checkin', 'it', 'Ascoltati un attimo', 'Come ti senti? Chiedilo a te stesso prima che te lo dica l''app.', 'Non ora', 7),
  ('ja.pause', 'ja', 'ちょっとひと休み', 'このアプリは待ってくれます。まずは Here で、自分のための30秒を。', '心を整える', 0),
  ('ja.later', 'ja', '今じゃなくても大丈夫', 'フィードはなくなりません。でも、この瞬間は今だけです。', 'あとで', 1),
  ('ja.breath', 'ja', 'まずはひと呼吸', '30秒だけ穏やかに。そのあとは、ご自由に。', '心を整える', 2),
  ('ja.autopilot', 'ja', 'なんとなく開いた？', 'そうかもしれないし、違うかも。どちらにしても、まずは深呼吸。', 'あとで', 3),
  ('ja.nothing', 'ja', '何もしなくていいんです', '少しのあいだ、そのままで。ここにはまだ、急ぐことは何もありません。', '心を整える', 4),
  ('ja.endless', 'ja', 'まだスクロール中？', 'スクロールに終わりはなくても、あなたの夜には終わりがあります。', 'あとで', 5),
  ('ja.attention', 'ja', 'ゆっくりでいい', '何に心を向けるかは、私が選びます。', '心を整える', 6),
  ('ja.checkin', 'ja', '自分に問いかけてみて', '今の気分は？アプリに言われる前に、自分に聞いてみましょう。', 'あとで', 7),
  ('ko.pause', 'ko', '잠깐 쉬어 가요', '이 앱은 기다려 줄 거예요. 먼저 Here에서 나를 위한 30초를 가져요.', '평온으로 돌아가기', 0),
  ('ko.later', 'ko', '지금은 말고요', '피드는 그대로 있을 거예요. 하지만 이 순간은 지나가요.', '나중에', 1),
  ('ko.breath', 'ko', '먼저 숨 한번 쉬어요', '30초만 평온하게. 그다음엔 마음껏 즐기세요.', '평온으로 돌아가기', 2),
  ('ko.autopilot', 'ko', '무심코 열었나요?', '그럴 수도, 아닐 수도 있죠. 어느 쪽이든 먼저 숨을 쉬어요.', '나중에', 3),
  ('ko.nothing', 'ko', '아무것도 안 해도 괜찮아요', '잠시 그대로 머물러 보세요. 아직 여기엔 서두를 일이 없어요.', '평온으로 돌아가기', 4),
  ('ko.endless', 'ko', '아직 스크롤 중인가요?', '스크롤은 끝이 없지만, 당신의 저녁은 끝이 있어요.', '나중에', 5),
  ('ko.attention', 'ko', '천천히 해도 괜찮아요', '나는 무엇에 마음을 둘지 스스로 선택합니다.', '평온으로 돌아가기', 6),
  ('ko.checkin', 'ko', '나에게 안부를 물어요', '지금 기분이 어때요? 앱이 알려 주기 전에 스스로에게 물어보세요.', '나중에', 7),
  ('nl.pause', 'nl', 'Een kleine pauze', 'Deze app kan wachten. Neem eerst 30 seconden voor jezelf in Here.', 'Terug naar rust', 0),
  ('nl.later', 'nl', 'Nu even niet', 'Je feed is er straks nog. Dit moment niet.', 'Niet nu', 1),
  ('nl.breath', 'nl', 'Eerst even ademhalen', 'Dertig seconden rust, en dan is het helemaal van jou.', 'Terug naar rust', 2),
  ('nl.autopilot', 'nl', 'Op de automatische piloot geopend?', 'Misschien, misschien niet. Hoe dan ook: eerst ademhalen.', 'Niet nu', 3),
  ('nl.nothing', 'nl', 'Je mag ook even niets doen', 'Blijf er een minuut bij. Niets hier heeft je nu al nodig.', 'Terug naar rust', 4),
  ('nl.endless', 'nl', 'Nog steeds aan het scrollen?', 'Scrollen is eindeloos. Je avond niet.', 'Niet nu', 5),
  ('nl.attention', 'nl', 'Rustig aan', 'Ik kies waar mijn aandacht naartoe gaat.', 'Terug naar rust', 6),
  ('nl.checkin', 'nl', 'Even inchecken bij jezelf', 'Hoe voel je je? Vraag het jezelf voordat de app het je vertelt.', 'Niet nu', 7),
  ('pt-BR.pause', 'pt-BR', 'Uma pequena pausa', 'Este app pode esperar. Antes, tire 30 segundos para você no Here.', 'Voltar à calma', 0),
  ('pt-BR.later', 'pt-BR', 'Agora não é a hora', 'Seu feed vai continuar lá. Este momento, não.', 'Agora não', 1),
  ('pt-BR.breath', 'pt-BR', 'Respire fundo primeiro', 'Trinta segundos de calma, e depois é tudo seu.', 'Voltar à calma', 2),
  ('pt-BR.autopilot', 'pt-BR', 'Abriu isso no piloto automático?', 'Talvez sim, talvez não. De qualquer jeito, respire primeiro.', 'Agora não', 3),
  ('pt-BR.nothing', 'pt-BR', 'Você pode não fazer nada', 'Fique assim por um minuto. Nada aqui precisa de você ainda.', 'Voltar à calma', 4),
  ('pt-BR.endless', 'pt-BR', 'Ainda rolando a tela?', 'A rolagem não tem fim. Sua noite tem.', 'Agora não', 5),
  ('pt-BR.attention', 'pt-BR', 'Vá com calma', 'Eu escolho o que merece a minha atenção.', 'Voltar à calma', 6),
  ('pt-BR.checkin', 'pt-BR', 'Olhe para dentro', 'Como você se sente? Pergunte-se antes que o app diga por você.', 'Agora não', 7),
  ('pt-PT.pause', 'pt-PT', 'Uma pequena pausa', 'Esta app pode esperar. Primeiro, tira 30 segundos para ti no Here.', 'Voltar à calma', 0),
  ('pt-PT.later', 'pt-PT', 'Agora não é a hora', 'O teu feed vai continuar lá. Este momento, não.', 'Agora não', 1),
  ('pt-PT.breath', 'pt-PT', 'Respira fundo primeiro', 'Trinta segundos de calma e depois é tudo teu.', 'Voltar à calma', 2),
  ('pt-PT.autopilot', 'pt-PT', 'Abriste isto em piloto automático?', 'Talvez sim, talvez não. Seja como for, respira primeiro.', 'Agora não', 3),
  ('pt-PT.nothing', 'pt-PT', 'Podes não fazer nada', 'Fica assim um minuto. Por agora, nada aqui precisa de ti.', 'Voltar à calma', 4),
  ('pt-PT.endless', 'pt-PT', 'Ainda a deslizar o ecrã?', 'O feed não tem fim. A tua noite tem.', 'Agora não', 5),
  ('pt-PT.attention', 'pt-PT', 'Com calma', 'Eu escolho o que merece a minha atenção.', 'Voltar à calma', 6),
  ('pt-PT.checkin', 'pt-PT', 'Olha para dentro', 'Como te sentes? Pergunta-te antes que a app o diga por ti.', 'Agora não', 7),
  ('ru.pause', 'ru', 'Маленькая пауза', 'Это приложение подождёт. Сначала удели себе 30 секунд в Here.', 'К спокойствию', 0),
  ('ru.later', 'ru', 'Может, не сейчас?', 'Лента никуда не денется. А этот момент пройдёт.', 'Не сейчас', 1),
  ('ru.breath', 'ru', 'Сначала сделай вдох', 'Тридцать секунд спокойствия — а потом всё твоё.', 'К спокойствию', 2),
  ('ru.autopilot', 'ru', 'Открыто на автопилоте?', 'Может, да, а может, и нет. В любом случае сначала подыши.', 'Не сейчас', 3),
  ('ru.nothing', 'ru', 'Можно ничего не делать', 'Побудь так минутку. Здесь пока ничто не требует твоего внимания.', 'К спокойствию', 4),
  ('ru.endless', 'ru', 'Всё ещё листаешь?', 'Лента бесконечна. Твой вечер — нет.', 'Не сейчас', 5),
  ('ru.attention', 'ru', 'Не спеши', 'Я выбираю, чему отдавать своё внимание.', 'К спокойствию', 6),
  ('ru.checkin', 'ru', 'Прислушайся к себе', 'Как ты себя чувствуешь? Спроси себя раньше, чем это скажет приложение.', 'Не сейчас', 7),
  ('tr.pause', 'tr', 'Küçük bir mola', 'Bu uygulama bekleyebilir. Önce Here''da kendine 30 saniye ayır.', 'Sakinliğe dön', 0),
  ('tr.later', 'tr', 'Şimdi sırası değil', 'Akışın yine orada olacak. Bu an ise olmayacak.', 'Şimdi değil', 1),
  ('tr.breath', 'tr', 'Önce bir nefes al', 'Otuz saniye sakinlik, sonra hepsi senin.', 'Sakinliğe dön', 2),
  ('tr.autopilot', 'tr', 'Bunu otomatik pilotta mı açtın?', 'Belki evet, belki hayır. Her durumda önce nefes al.', 'Şimdi değil', 3),
  ('tr.nothing', 'tr', 'Hiçbir şey yapmamak serbest', 'Bir dakika böyle kal. Buradaki hiçbir şeyin henüz sana ihtiyacı yok.', 'Sakinliğe dön', 4),
  ('tr.endless', 'tr', 'Hâlâ kaydırıyor musun?', 'Kaydırmanın sonu yok. Akşamının var.', 'Şimdi değil', 5),
  ('tr.attention', 'tr', 'Yavaş yavaş', 'Dikkatimi neye vereceğimi ben seçerim.', 'Sakinliğe dön', 6),
  ('tr.checkin', 'tr', 'Kendini dinle', 'Nasıl hissediyorsun? Uygulama söylemeden önce kendine sor.', 'Şimdi değil', 7),
  ('zh-Hans.pause', 'zh-Hans', '稍作停顿', '这个 App 可以等等。先在 Here 给自己 30 秒。', '回归平静', 0),
  ('zh-Hans.later', 'zh-Hans', '现在先不用', '你的信息流不会消失，但此刻转瞬即逝。', '暂不', 1),
  ('zh-Hans.breath', 'zh-Hans', '先深呼吸一下', '平静 30 秒，然后尽情使用。', '回归平静', 2),
  ('zh-Hans.autopilot', 'zh-Hans', '是不是下意识就打开了？', '也许是，也许不是。无论如何，先呼吸一下。', '暂不', 3),
  ('zh-Hans.nothing', 'zh-Hans', '什么都不做也没关系', '静静待一会儿。这里还没有什么需要你。', '回归平静', 4),
  ('zh-Hans.endless', 'zh-Hans', '还在刷吗？', '刷屏没有尽头，你的夜晚却有。', '暂不', 5),
  ('zh-Hans.attention', 'zh-Hans', '慢慢来', '我选择把注意力放在哪里。', '回归平静', 6),
  ('zh-Hans.checkin', 'zh-Hans', '问问自己', '你感觉如何？在 App 告诉你之前，先问问自己。', '暂不', 7),
  ('zh-Hant.pause', 'zh-Hant', '稍微停一下', '這個 App 可以等等。先在 Here 給自己 30 秒。', '回到平靜', 0),
  ('zh-Hant.later', 'zh-Hant', '現在先不要', '你的動態不會消失，但這一刻不會重來。', '暫時不要', 1),
  ('zh-Hant.breath', 'zh-Hant', '先深呼吸一下', '平靜 30 秒，接下來就隨你。', '回到平靜', 2),
  ('zh-Hant.autopilot', 'zh-Hant', '是不是不自覺就打開了？', '也許是，也許不是。無論如何，先呼吸。', '暫時不要', 3),
  ('zh-Hant.nothing', 'zh-Hant', '什麼都不做也沒關係', '靜靜待一會兒。這裡還沒有什麼需要你。', '回到平靜', 4),
  ('zh-Hant.endless', 'zh-Hant', '還在滑嗎？', '滑動沒有盡頭，你的夜晚卻有。', '暫時不要', 5),
  ('zh-Hant.attention', 'zh-Hant', '慢慢來', '我選擇將注意力放在哪裡。', '回到平靜', 6),
  ('zh-Hant.checkin', 'zh-Hant', '問問自己', '你感覺如何？在 App 告訴你之前，先問問自己。', '暫時不要', 7)
on conflict (id) do update set
  language = excluded.language,
  title = excluded.title,
  subtitle = excluded.subtitle,
  button = excluded.button,
  sort_order = excluded.sort_order;

-- MARK: - Read

-- Every active card in every language; the app keeps them all, so the shield can
-- follow the phone's language without another download.
create or replace function public.affirmations_get_shield_texts()
returns table (id text, language text, title text, subtitle text, button text)
language plpgsql security definer
set search_path to 'affirmations'
as $$
begin
  perform affirmations.require_user();
  return query
    select t.id, t.language, t.title, t.subtitle, t.button
    from shield_texts t
    where t.is_active
    order by t.language, t.sort_order, t.id;
end;
$$;

revoke all on function public.affirmations_get_shield_texts() from public, anon, authenticated;
grant execute on function public.affirmations_get_shield_texts() to authenticated;
