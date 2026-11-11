# Hejka — chapter 1 lessons

14 lesson files + `trail.json`. Schema follows the Hutarka lesson guide, with the changes below.

## Files

- The lessons themselves are in the `lingo` tables (see [`../README.md`](../README.md)); they were
  imported from the chapter 1 JSON files that used to sit here.
- `trail-plan.json` — all chapters incl. Extra; units of chapters 2–12 have empty `lessons` until written. Not for the app yet.

## Schema changes vs the Hutarka guide

1. **Taught language key is `pl`, not `en`.** Every text object: `pl` (required) + the learner languages `en es fr de it pt ru uk be tr zh zh-Hant ja ar hi`.
   Plain-string fields are Polish: `example`, `task.build`, `task.choose`, `distractors`, `gap`, `gapWrong`, `swap.frame`.

2. **Female variant (`_f`).** Onboarding asks the user's gender. Where a line differs for a female user, the text object has extra keys `pl_f` / `ru_f` / `uk_f` / `en_f` (only the ones that differ). App rule: if user = female and `X_f` exists → use `X_f`, else `X`.
   Covers both the boar's own lines (`Jestem tu nowy` → `nowa`) and lines addressed to the boar (`Co dla pana?` → `Co dla pani?`).
   For word cards there is also `example_f`. Pick the variant **before** splitting into tiles and matching `gap`.
   Used in: `poznajmy-sie`, `pan-i-pani`, `na-ty`, `po-polsku`.

3. **Tips (`tip`).** `{ "show": "auto" | "tap", "text": { <every learner language> } }` — no `pl`.
   - Lesson level, `show: "auto"` — one card before the scene.
   - On a phrase, `show: "tap"` — a hint icon during that phrase's exercises.

4. **Word cards show the dictionary form**, the example shows the scene form (`woda` / `Poproszę wodę.`). Example is still copied exactly from a scene line.

## Checks to do on device

- pl-PL voice exists (iOS / Android TTS); fallback if missing.
- Unicode NFC normalisation, so `ą ę ł ż ź ó ś ć ń` from JSON match the tiles.
- "Spell the word" with Polish letters.
- Polish quotes `„…”` in `co-to-znaczy` render fine.

## Content notes

- In dialogue `pan / pani` is lowercase (correct Polish); capital `Pan` is only for letters.
- Boar's name in `poznajmy-sie` is a placeholder: Kuba (male) / Ola (female). Replace after the mascot naming contest.
- Characters: owl = official / older lady (addressed as `pani`), fox = shop staff, dog = neighbour, rabbit = friend.
