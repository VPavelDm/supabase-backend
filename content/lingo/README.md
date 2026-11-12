# Lesson content

The Lingo apps' lessons live in tables on the shared Supabase project (schema `lingo`) and are read
live: `lingo/content` (`supabase/functions/lingo/content.ts`) calls
`lingo.content_bundle(<app>, <learned language>, <learner language>)`, which builds the JSON
described below from the rows. An app fetches it on a splash at every launch, and again when the
learner picks another language, and keeps the last bundle per language on disk for when the
backend can't be reached.

**Edits are live.** There is no publish step: a saved row reaches every learner at their next
launch. Check the result after changing content, and fix what it reports right away:

```bash
deno run --allow-run --allow-read --allow-write content/lingo/check.ts hutarka --linked
```

A broken edit (a text without its learned-language row, say) can make the bundle unreadable:
installs with lessons on disk keep using them, but a fresh install shows "couldn't load your
lessons" until it is fixed. The database refuses the worst mistakes outright: a step missing what
its kind needs, a fourth stump in a unit, deleting a word, phrase or scene a step uses, or a lesson
that is on the trail.

## The tables

| Table | One row per | Notes |
|---|---|---|
| `texts` | piece of text a learner sees | Just an id and the app; the words are in `translations`. |
| `translations` | text and language | `value`, plus `value_female` where a female learner sees something else (Hejka). The learned language (`en` in Hutarka, `pl` in Hejka) is a row like any other. |
| `chapters` | chapter | `slug`, `position`, `title_id`. |
| `units` | map in a chapter | `position`, `map` (`forest`, `meadow`, `farm`), `title_id`. |
| `stumps` | stump on a map | `position`, `lesson_id`; no lesson means the chapter's checkpoint. At most 3 per unit: every map has three clearings. |
| `lessons` | lesson | `slug` (the id the apps know), `partner`, `title_id`, `subtitle_id`. |
| `scenes` | conversation in a lesson | A lesson can have several. |
| `scene_lines` | line of a scene | `speaker`, `text_id`, and on the boar's lines `task_kind` (`build`, `choose`) + `task_options`. |
| `words` | new word | `text_id`, `example` (+ `example_female`): the scene line it comes from. |
| `phrases` | phrase | `text_id`, and `tip_id` for a hint shown during every exercise on it. |
| `lesson_steps` | step of a lesson | What the learner does, in `position` order. See below. |
| `step_words` | word of a `match_words` step | None: the step matches all the lesson's words. |

**Order** is `position` within the parent, lowest first. Positions step by 10, so a new row goes
between two others without renumbering (15 between 10 and 20).

**Drafts.** Only lessons that a stump points to are sent, so a new lesson can be written in full
before it goes on the trail.

**The trail is everyone's progress.** A learner's progress is the number of stumps they have
finished, so adding a stump anywhere but after the last one, removing one or reordering them moves
every learner's boar to a different lesson. Add lessons at the end; fix text in place. A lesson's
`slug` is what the apps' progress, reports and speech cache use, so changing it is a removal plus
an addition.

### Steps

A lesson plays its steps in order, exactly as written: tips anywhere, a word card again after a
quiz, two scenes, anything. Data only a step uses is on the step; data several steps share (scenes,
words, phrases) is on the lesson and the step points at it.

| `kind` | What the learner does | Columns |
|---|---|---|
| `tip` | Reads a note on a card | `text_id` (learner languages only) |
| `scene` | Watches and hears a scene | `scene_id` |
| `conversation` | "Your turn": the scene again, saying the boar's lines | `scene_id` |
| `word_card` | Meets a word | `word_id` |
| `listen_pick` | Hears the word, picks it among the lesson's words | `word_id` |
| `pick_meaning` | Sees the word, picks its meaning | `word_id` |
| `say_in_english` | Sees the meaning, picks the word | `word_id` |
| `spell` | Builds the word from its letters (one word, 8 letters at most) | `word_id` |
| `match_words` | Matches words to meanings | `step_words`, or all the lesson's words |
| `pick_translation` | Sees the phrase, picks its meaning | `phrase_id` |
| `fill_gap` | Picks the word missing from the phrase | `phrase_id`, `gap`, `wrong` |
| `spot_mistake` | Taps the wrong word in the phrase (best with 4+ words) | `phrase_id`, `gap`, `wrong` |
| `build_phrase` | Builds the phrase from tiles plus extra ones | `phrase_id`, `extra` |
| `listen_build` | Hears the phrase, builds it from tiles | `phrase_id`, `extra` |
| `swap` | Fills a frame's slot with the right word | `frame` (with `{slot}`), `text_id` (the word), `sentence_id`, `wrong` |

**Premium steps.** `lesson_steps.premium` marks a step only Premium learners play; free learners
get a locked card there, with Unlock (the paywall) and Skip, which counts as neither right nor
wrong. Set it per step: any kind can be either. It started (2026-11-12) as true on every `swap`,
`listen_build`, `spell`, `conversation`, `say_in_english` and `spot_mistake` step in both apps; new
steps are free until marked. The bundle sends `"premium": true` on those steps only. A checkpoint
step keeps the flag of the lesson step it was taken from.

**Premium lessons.** `lessons.premium` marks a whole lesson only Premium learners get. Unlike a
premium step, its content never reaches a free learner: `lingo/content` asks Adapty whether the
caller has Premium (only when the app has a premium lesson on its trail) and otherwise sends the
lesson as a stub with `"locked": true` and empty `scenes`, `words`, `phrases` and `steps`. The apps
show it locked on the trail and open the paywall; after a purchase they ask again and get it whole.
When Adapty can't answer, everyone gets everything (logged as `no_adapty_key` or `adapty_failed`).
The trail's first lesson must stay free (onboarding plays it); `check.ts` checks the content as a
Premium learner gets it and lists the premium lessons. Mark lessons only once every app build in
use knows `locked`: older builds read a stub as a lesson with no steps.

The picking quizzes take their wrong options from the lesson's other words or phrases. `gap`,
`wrong`, `extra` and `frame` are in the learned language and never translated. A `kind` the apps
don't know is saved and sent, and an app that can't play it skips that step: a new exercise ships
in an app build first, then lessons can use it.

### Searching

`lingo.content_texts` lists every text in use with where it sits; `lingo.content_text_places` is
the same without the translations.

```sql
select * from lingo.content_texts where value ilike '%please%';
select lesson, part, position, value from lingo.content_texts
  where app = 'hejka' and language = 'tr' order by lesson, part, position;
```

To change a text, update its `translations` row by `text_id` and `language`. To see a lesson the
way the app gets it: `select lingo.content_bundle('hutarka', 'en', 'ru')->'lessons'->'hello';`

## The bundle (format 2)

The app sends `{ "format": 2, "language": "ru", "version": "…" }` and gets `{ "version": "…",
"unchanged": true }` when nothing changed, or:

```json
{
  "version": "3e9a7f02c4d15b86",
  "chapters": [
    { "id": "first-steps", "title": "Первые шаги",
      "units": [ { "title": "Приветствие", "map": "meadow", "lessons": ["hello", "hi", "nice-to-meet-you"] } ] }
  ],
  "lessons": {
    "hello": {
      "id": "hello", "title": "Доброе утро!", "subtitle": "Вежливо поздороваться и попрощаться", "with": "owl",
      "scenes": [[
        { "speaker": "other", "text": { "en": "Good morning! Off to work?", "ru": "Доброе утро! На работу?" } },
        { "speaker": "boar", "text": { "en": "Good morning! Yes, off to work.", "ru": "Доброе утро! Да, на работу." },
          "task": { "build": ["No,", "night"] } }
      ]],
      "words": [ { "text": { "en": "work", "ru": "работа" }, "example": "Good morning! Off to work?" } ],
      "phrases": [ { "text": { "en": "Have a nice day!", "ru": "Хорошего дня!" } } ],
      "steps": [
        { "kind": "scene", "scene": 0 },
        { "kind": "word_card", "word": 0 },
        { "kind": "tip", "text": "«Good morning» говорят примерно до полудня." },
        { "kind": "fill_gap", "phrase": 0, "gap": "Have", "wrong": ["Has", "Having"] },
        { "kind": "build_phrase", "phrase": 0, "extra": ["Has", "the"] },
        { "kind": "swap", "frame": "Have a nice {slot}!", "word": { "en": "evening", "ru": "вечер" },
          "sentence": { "en": "Have a nice evening!", "ru": "Хорошего вечера!" }, "wrong": ["weekend", "week"] },
        { "kind": "conversation", "scene": 0 }
      ]
    }
  }
}
```

- **Plain strings** are shown only in the learner's language: titles, subtitles, tips.
- **Objects** are learned material: the learned language (`en` in Hutarka, `pl` in Hejka) plus the
  learner's, and `<code>_f` where a female learner sees something else.
- **A missing translation** is sent as `""`; `check.ts` lists them.
- **Steps point at shared material by position**, counting from 0: `"word": 0` is the lesson's first
  word.
- **The checkpoint** (`checkpoint` in a unit's `lessons`) is built by the app from a sample of the
  chapter's steps.

Hejka's content notes are in [`hejka/README.md`](hejka/README.md); the plan for its later chapters
is in [`hejka/trail-plan.json`](hejka/trail-plan.json).
[`Hutarka-lesson-writing-guide.pdf`](Hutarka-lesson-writing-guide.pdf) is the guide for lesson
writers; the files in [`examples/`](examples) show the older one-file-per-lesson format.

## Tips for writing

- Keep English short and natural: a beginner should be able to say every boar line.
- Write tiles as the learner will tap them: punctuation stays on the word (`please?`), so an extra
  tile should not be a copy of a real one.
- Wrong options should be wrong for one clear reason (`has` for `have`), not nonsense.
- Translate the meaning, not word for word: `Here you go` is `Вот, пожалуйста`, not `Здесь ты идёшь`.
- Words and phrases should come from a scene, so the learner meets them in context first.
