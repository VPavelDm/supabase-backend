# Lesson content

The Lingo apps' lessons live in tables on the shared Supabase project (schema `lingo`, migration
`20261111140000_lingo_lesson_tables.sql`) and are read live: `lingo/content`
(`supabase/functions/lingo/content.ts`) calls `lingo.content_bundle(<app>)`, which builds the JSON
described below from the rows. An app fetches it on a splash at every launch and keeps the last
bundle on disk for when the backend can't be reached.

**Edits are live.** There is no publish step: a saved row reaches every learner at their next
launch. Check the result after changing content, and fix what it reports right away:

```bash
deno run --allow-run --allow-read --allow-write content/lingo/check.ts hutarka --linked
```

A broken edit (a text without its learned-language row, say) makes the bundle unreadable: installs
that have lessons on disk keep using them, but a fresh install shows "couldn't load your lessons"
until it is fixed.

## The tables

| Table | One row per | Notes |
|---|---|---|
| `texts` | piece of text a learner sees | Just an id and the app; the words are in `translations`. |
| `translations` | text and language | `value`, plus `value_female` where a female learner sees something else (Hejka). The learned language (`en` in Hutarka, `pl` in Hejka) is a row like any other. |
| `chapters` | chapter | `slug`, `position`, `title_id`. |
| `units` | map in a chapter | `position`, `map` (`forest`, `meadow`, `farm`), `title_id`. |
| `unit_steps` | stump on a map | `position`, `lesson_id`; no lesson means the chapter's checkpoint. At most 3 per unit: the database refuses a fourth (every map has three clearings). |
| `lessons` | lesson | `slug` (the id the apps know), `partner`, `title_id`, `subtitle_id`, `tip_id`, `swap_frame`. |
| `scene_lines` | line of a lesson's scene | `speaker`, `text_id`, `task_kind` + `task_options` on the boar's lines. |
| `words` | new word | `text_id`, `example` (+ `example_female`). |
| `phrases` | phrase | `text_id`, `distractors`, `gap`, `gap_wrong`, `tip_id`. |
| `swap_items` | swap drill item | `word_id`, `sentence_id`. |

Plain-string fields (`example`, `task_options`, `distractors`, `gap`, `gap_wrong`, `swap_frame`)
are in the learned language and never translated.

**Order** is `position` within the parent, lowest first. Positions step by 10, so a new row goes
between two others without renumbering (15 between 10 and 20).

**Drafts.** Only lessons that a unit step points to are sent, so a new lesson can be written in
full before it goes on the trail.

**The trail is everyone's progress.** A learner's progress is the number of stumps they have
finished, so adding a step anywhere but after the last one, removing one or reordering them moves
every learner's boar to a different lesson. Add lessons at the end; fix text in place. A lesson that
a step points to can't be deleted. A lesson's `slug` is what the apps' progress and speech cache
use, so changing it is a removal plus an addition.

### Searching

`lingo.content_texts` lists every text in use with where it sits:

```sql
select * from lingo.content_texts where value ilike '%please%';
select lesson, part, position, value from lingo.content_texts
  where app = 'hejka' and language = 'tr' order by lesson, part, position;
```

To change a text, update its `translations` row by `text_id` and `language`. To see a whole
lesson the way the app gets it: `select lingo.content_bundle('hutarka')->'lessons'->'hello';`

## The bundle format

What `lingo.content_bundle` builds and the apps decode: `{ "trail": …, "lessons": { "<slug>": … } }`.
The rules below are what `check.ts` enforces. Below, `en` stands for the learned language: `pl` in
Hejka. Hejka's extra fields (`tip`, `_f` variants) are described in [`hejka/README.md`](hejka/README.md);
the app asks the learner's gender in onboarding only when the lessons have `_f` variants. The plan
for Hejka's later chapters is in [`hejka/trail-plan.json`](hejka/trail-plan.json). Format examples
of a whole trail and lesson are in [`examples/`](examples), and
[`Hutarka-lesson-writing-guide.pdf`](Hutarka-lesson-writing-guide.pdf) is the guide for lesson
writers.

### Text

Every piece of text is an object keyed by language code:

```json
{ "en": "Can I have a coffee, please?", "ru": "Можно мне кофе, пожалуйста?", "es": "¿Me pone un café, por favor?" }
```

- `en` is required. In lesson content it is the English being learned; the other keys are what it
  means in the learner's language.
- Language codes: `es fr de it pt ru uk be pl tr zh zh-Hant ja ar hi`.
- A missing language falls back to English, so a lesson can ship with a few translations and get the
  rest later.
- Titles in `trail.json` and a lesson's `title`/`subtitle` use the same shape; there `en` is just the
  English name.

Lists of wrong answers and extra tiles (`distractors`, `wrong`, `gapWrong`) are plain English
strings: they are never translated.

### trail

```json
{
  "chapters": [
    {
      "id": "first-steps",
      "title": { "en": "First steps", "ru": "Первые шаги" },
      "units": [
        {
          "title": { "en": "Eating out", "ru": "В кафе" },
          "map": "meadow",
          "lessons": ["cafe", "restaurant", "the-bill"]
        }
      ]
    }
  ]
}
```

| Field | Notes |
|---|---|
| `chapters[].id` | Unique, lowercase with dashes. |
| `units` | 5 per chapter. |
| `units[].map` | Map art: `forest`, `meadow` or `farm` (more as art is added). |
| `units[].lessons` | 3 lesson ids, bottom stump first. In the last unit, the third is the word `checkpoint`. |

### The checkpoint

The last stump of every chapter is a review, built by the app: it picks 6 words and 4 phrases from
the chapter's lessons at random and runs them through the word quiz and the phrase exercises, with
no scene, word cards, swap or conversation. Nothing to write for it; just put `checkpoint` in its
place. A chapter is 14 lessons plus the checkpoint.

### A lesson

A lesson runs in five stages: the scene, new words, phrases, swap, then the learner's turn in the
scene. The file has one section per stage.

| Field | What it is | Rules |
|---|---|---|
| `id` | Same as the file name. | Unique across all lessons. |
| `title`, `subtitle` | Name and one-line goal, shown on the trail's card. | Text objects. |
| `with` | Who the boar talks to: `fox`, `owl`, `dog` or `rabbit`. | |
| `scene` | The conversation, line by line. | 4–8 lines, starting with the other speaker. |
| `scene[].speaker` | `boar` or `other`. | |
| `scene[].text` | The line. | Text object. |
| `scene[].task` | Boar lines only: what the learner does in "Your turn". | Every boar line has one. |
| `task.build` | Build the line from its words plus these extra tiles. | 2 words not in the line. |
| `task.choose` | Pick the line among these wrong replies. | 2 sentences that look close but are wrong. |
| `words` | New words and short expressions. | 4–6. |
| `words[].text` | The word. | Text object. |
| `words[].example` | The scene line it comes from. | Must be the English of a scene line, exactly. |
| `phrases` | Reusable chunks, learned whole. | 2–4. |
| `phrases[].text` | The phrase. | Text object; ideally a line, or part of one, from the scene. |
| `phrases[].distractors` | Extra tiles when building it. | 2 words not in the phrase. |
| `phrases[].gap` | The word blanked out in "fill the gap" and swapped in "spot the mistake". | One whole word of the phrase. |
| `phrases[].gapWrong` | Wrong options for the gap. | 2 words. |
| `swap.frame` | A phrase with `{slot}` where a word goes. | `{slot}` exactly once. |
| `swap.items[].word` | A word that fits the slot. | Text object; 3 items. |
| `swap.items[].sentence` | The frame with that word in. | Its `en` must equal the frame with the word filled in. |

Things the app works out on its own, so they are not in the file: splitting lines into tiles,
which words can be spelled letter by letter (single words of 8 letters or fewer), the "spot the
mistake" sentence (from `gap` and `gapWrong`), the word and phrase counts on the card, and which
exercises a session uses.

### Tips for writing

- Keep English short and natural: a beginner should be able to say every boar line.
- Write tiles as the learner will tap them: punctuation stays on the word (`please?`), so a
  distractor should not be a copy of a real tile.
- Wrong options should be wrong for one clear reason (`has` for `have`), not nonsense.
- Translate the meaning, not word for word: `Here you go` is `Вот, пожалуйста`, not `Здесь ты идёшь`.
- Words and phrases should come from the scene, so the learner meets them in context first.
