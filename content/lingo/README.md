# Lesson content

The Lingo apps' lessons live here and are served from the shared Supabase project, not shipped
inside the apps: an app fetches its bundle on a splash at every launch through `lingo/content`
(`supabase/functions/lingo/content.ts`) and keeps it on disk for the launches when the backend
cannot be reached. A content fix reaches every learner at their next launch, with no App Store
release.

Content is JSON files you write and hand over; the app reads them as they are. Two kinds of file:

- **`trail.json`**: the map. Chapters → units (one map each) → lessons, by id. Only order and names.
  Each chapter ends with a checkpoint, which has no file (see below).
- **`lessons/<id>.json`**: one file per lesson, with everything taught in it.

Each app has its own folder, `trail.json` plus `lessons/`:

- **Hutarka** (teaches English): [`hutarka/`](hutarka). Chapter 1, "First steps", adapted from the
  Polish Hejka chapter 1.
- **Hejka** (teaches Polish): [`hejka/`](hejka). Chapter 1, "Pierwsze kroki". The text objects are
  keyed `pl` for the Polish being learned, with meanings in every language code below except `pl`
  (plus `en`), and the plain-string fields are Polish. Its extra fields (`tip`, `_f` variants for a
  female learner) are described in [`hejka/README.md`](hejka/README.md). The app asks the learner's
  gender in onboarding only when the lessons have `_f` variants, so Hutarka never asks. The plan
  for later chapters is in [`hejka/trail-plan.json`](hejka/trail-plan.json).

Below, `en` stands for the learned language: `pl` in Hejka. Check the content after every change:

```bash
python3 content/lingo/check-lessons.py            # both apps; or: … hutarka
```

The files in [`examples/`](examples) are format examples: `trail.json` and `lessons/cafe.json` (a
café lesson for a later chapter). [`Hutarka-lesson-writing-guide.pdf`](Hutarka-lesson-writing-guide.pdf)
is the guide handed to lesson writers.

## Publishing

Publishing writes an app's files to `lingo.lesson_content` (one row per file). Run from the repo
root; the script checks the content first, shows what changes against what is published, and with
`--linked` asks for a typed "publish" before writing:

```bash
deno run --allow-run --allow-read --allow-write --allow-env content/lingo/publish.ts hutarka --local
deno run --allow-run --allow-read --allow-write --allow-env content/lingo/publish.ts hutarka --linked
```

`--local` is the stack `supabase start` runs, which Debug builds on the simulator read from; nothing
shows in such a build until its app is published there. `--linked` is the shared project:
**production**, every installed copy of the app, which uses the new bundle from its next launch.

A learner's progress is a position on the trail (`trailProgress`, the number of finished stumps), so
the order of the trail is part of the contract with everyone who has started it: add lessons at
the end, fix text in place, and plan a reorder or removal (it moves every learner's boar). Lesson
ids are what the apps' progress records and the speech cache are keyed by, so renaming a lesson is
a removal plus an addition.

## Text

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

## trail.json

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

## lessons/&lt;id&gt;.json

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

## Tips for writing

- Keep English short and natural: a beginner should be able to say every boar line.
- Write tiles as the learner will tap them: punctuation stays on the word (`please?`), so a
  distractor should not be a copy of a real tile.
- Wrong options should be wrong for one clear reason (`has` for `have`), not nonsense.
- Translate the meaning, not word for word: `Here you go` is `Вот, пожалуйста`, not `Здесь ты идёшь`.
- Words and phrases should come from the scene, so the learner meets them in context first.
