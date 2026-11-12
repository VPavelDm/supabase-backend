-- Hejka's "pan / pani" tip: its three forms of address become list items ("- " at the start of
-- the line), which the apps draw indented behind a bullet (iOS `Text(tip:)`, Android `tipText`).
-- Builds without list support show the plain "- pan — …", still readable.
--
-- Those lines are the only ones that start with "**"; the lead and the verb line don't.
-- Tip of lesson hejka/pan-i-pani (text 3a8e4841-8476-52b6-8052-762ae4208ce0), every language.

update lingo.translations
set value = regexp_replace(value, '^\*\*', '- **', 'gn')
where text_id = '3a8e4841-8476-52b6-8052-762ae4208ce0'
  and value !~ '(^|\n)- \*\*';
