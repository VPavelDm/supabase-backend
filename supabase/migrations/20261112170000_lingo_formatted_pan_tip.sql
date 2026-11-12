-- Hejka's "pan / pani" tip as a list instead of a paragraph: a short lead, one line per form of
-- address, then the verb, with the Polish words in **bold**. The apps render `**bold**` and line
-- breaks in tips from this release on (iOS `Text(tip:)`, Android `tipText`); older builds show the
-- asterisks, which only Hejka's testers have (Hejka isn't released yet). The note on a capital
-- "Pan" in letters is dropped: it's the least useful part for a beginner.
--
-- Tip of lesson hejka/pan-i-pani (text 3a8e4841-8476-52b6-8052-762ae4208ce0), every language.

update lingo.translations set value = v.value
from (values
  ('en', $t$Address strangers with:
**pan** — a man
**pani** — a woman
**państwo** — a group

The verb takes the “he/she” form: **Czy ma pan…?**$t$),
  ('uk', $t$До незнайомих звертаються:
**pan** — до чоловіка
**pani** — до жінки
**państwo** — до групи

Дієслово — як з «він/вона»: **Czy ma pan…?**$t$),
  ('ru', $t$К незнакомым обращаются:
**pan** — к мужчине
**pani** — к женщине
**państwo** — к группе

Глагол — как с «он/она»: **Czy ma pan…?**$t$),
  ('be', $t$Да незнаёмых звяртаюцца:
**pan** — да мужчыны
**pani** — да жанчыны
**państwo** — да групы

Дзеяслоў — як з «ён/яна»: **Czy ma pan…?**$t$),
  ('es', $t$A los desconocidos se les habla de:
**pan** — a un hombre
**pani** — a una mujer
**państwo** — a un grupo

El verbo va en tercera persona, como con usted: **Czy ma pan…?**$t$),
  ('fr', $t$On s'adresse à un inconnu avec :
**pan** — à un homme
**pani** — à une femme
**państwo** — à un groupe

Le verbe se met à la forme « il/elle » : **Czy ma pan…?**$t$),
  ('de', $t$So spricht man Fremde an:
**pan** — einen Mann
**pani** — eine Frau
**państwo** — eine Gruppe

Das Verb steht in der „er/sie“-Form: **Czy ma pan…?**$t$),
  ('it', $t$Agli sconosciuti ci si rivolge con:
**pan** — a un uomo
**pani** — a una donna
**państwo** — a un gruppo

Il verbo va alla terza persona, come con il Lei: **Czy ma pan…?**$t$),
  ('pt', $t$Aos desconhecidos trata-se por:
**pan** — a um homem
**pani** — a uma mulher
**państwo** — a um grupo

O verbo vai na terceira pessoa, como com «o senhor»: **Czy ma pan…?**$t$),
  ('tr', $t$Yabancılara şöyle hitap edilir:
**pan** — erkeğe
**pani** — kadına
**państwo** — gruba

Fiil “o” biçiminde olur: **Czy ma pan…?**$t$),
  ('zh', $t$称呼陌生人：
**pan** — 男士
**pani** — 女士
**państwo** — 一群人

动词用“他/她”的形式：**Czy ma pan…?**$t$),
  ('zh-Hant', $t$稱呼陌生人：
**pan** — 男士
**pani** — 女士
**państwo** — 一群人

動詞要用「他／她」的形式：**Czy ma pan…?**$t$),
  ('ja', $t$知らない人への呼びかけ：
**pan** — 男性
**pani** — 女性
**państwo** — グループ

動詞は「彼・彼女」の形を使います：**Czy ma pan…?**$t$),
  ('ar', $t$يُخاطَب الغرباء بـ:
**pan** — للرجل
**pani** — للمرأة
**państwo** — لمجموعة

ويأتي الفعل بصيغة «هو/هي»: **Czy ma pan…?**$t$),
  ('hi', $t$अजनबियों को ऐसे संबोधित करते हैं:
**pan** — पुरुष
**pani** — महिला
**państwo** — समूह

क्रिया “वह” वाले रूप में होती है: **Czy ma pan…?**$t$)
) as v (language, value)
where lingo.translations.text_id = '3a8e4841-8476-52b6-8052-762ae4208ce0'
  and lingo.translations.language = v.language;
