// Checks one app's lessons as the apps get them (format 2): builds the bundle
// from the lingo tables exactly as lingo/content does, checks every step and
// what it points at, and lists missing translations. Edits are live, so run
// it after changing content and fix what it reports. Run from the repo root:
//
//   deno run --allow-run --allow-read --allow-write content/lingo/check.ts <hutarka|hejka> --linked
//   deno run --allow-run --allow-read --allow-write content/lingo/check.ts <hutarka|hejka> --local
//
// (--db-url <postgres url> targets any database.) Reads only; goes through
// `supabase db query`, so it needs the CLI logged in and linked.
//
// The order of a lesson's steps is the teacher's call: nothing here judges it.
// A step kind this script doesn't know is reported as a note, since the apps
// drop such steps (a new exercise ships in an app build first).

import { parseArgs } from "jsr:@std/cli@1/parse-args";

// Per app: the language it teaches and the learner languages its lessons are
// translated into. Keep in step with each app's AppConfig.swift and apps.ts.
const APPS: Record<string, { learned: string; languages: string[] }> = {
  hutarka: { learned: "en", languages: ["es", "fr", "de", "it", "pt", "ru", "uk", "be", "pl", "tr", "zh", "zh-Hant", "ja", "ar", "hi"] },
  hejka: { learned: "pl", languages: ["en", "es", "fr", "de", "it", "pt", "ru", "uk", "be", "tr", "zh", "zh-Hant", "ja", "ar", "hi"] },
};
const KINDS = new Set([
  "tip", "scene", "conversation", "word_card", "match_words", "listen_pick", "pick_meaning", "say_in_english",
  "spell", "pick_translation", "fill_gap", "spot_mistake", "build_phrase", "listen_build", "swap",
]);
const CHARACTERS = new Set(["fox", "owl", "dog", "rabbit"]);
const PUNCTUATION = /^[.,!?;:“”"«»„…¿¡]+|[.,!?;:“”"«»„…¿¡]+$/g;

type Text = Record<string, string>;
interface Line { speaker: string; text: Text; task?: { build?: string[]; choose?: string[] } }
interface Step {
  kind: string; scene?: number; word?: number | Text; words?: number[]; phrase?: number; text?: string;
  sentence?: Text; frame?: string; gap?: string; wrong?: string[]; extra?: string[];
}
interface Lesson {
  id: string; title: string; subtitle: string; with: string; scenes: Line[][];
  words: { text: Text; example: string; example_f?: string }[]; phrases: { text: Text; tip?: string }[]; steps: Step[];
}
interface Bundle { chapters: { id: string; title: string; units: { title: string; map: string; lessons: string[] }[] }[]; lessons: Record<string, Lesson> }

const args = parseArgs(Deno.args, { boolean: ["local", "linked"], string: ["db-url"] });

function fail(message: string): never {
  console.error(message);
  Deno.exit(2);
}

const app = String(args._[0] ?? "");
const config = APPS[app] ?? fail(`Usage: check.ts <${Object.keys(APPS).join("|")}> --local|--linked|--db-url <url>`);
const targets = [args.local && ["--local"], args.linked && ["--linked"], args["db-url"] && ["--db-url", args["db-url"]]]
  .filter(Boolean) as string[][];
if (targets.length !== 1) fail("Pass exactly one of --local, --linked and --db-url <url>");

async function query(sqlText: string): Promise<Record<string, unknown>[]> {
  const out = await new Deno.Command("supabase", {
    args: ["db", "query", ...targets[0], "--output-format", "json", sqlText],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (!out.success) fail(`supabase db query failed: ${new TextDecoder().decode(out.stderr)}${text}`);
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.rows ?? [];
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const [{ bundle: raw }] = await query(
  `select lingo.content_bundle(${quote(app)}, ${quote(config.learned)}, ${quote(config.languages[0])}) as bundle`,
);
const bundle = (typeof raw === "string" ? JSON.parse(raw) : raw) as Bundle;

const problems: string[] = [];
const notes: string[] = [];
const L = config.learned;

/// The learned text a male learner sees, and a female one's where it differs.
function variants(text: Text): string[] {
  return [text[L] ?? "", ...(text[`${L}_f`] ? [text[`${L}_f`]] : [])];
}
const tiles = (line: string) => line.split(" ");
const bare = (token: string) => token.replace(PUNCTUATION, "");

// Trail
const listed: string[] = [];
bundle.chapters.forEach((chapter, c) => {
  chapter.units.forEach((unit, u) => {
    const where = `chapter ${c + 1} (${chapter.id}) unit ${u + 1}`;
    if (unit.lessons.length !== 3) problems.push(`${where}: has ${unit.lessons.length} stumps; a map has three`);
    unit.lessons.forEach((id, i) => {
      const isLast = u === chapter.units.length - 1 && i === unit.lessons.length - 1;
      if (id === "checkpoint") {
        if (!isLast) problems.push(`${where}: \`checkpoint\` only as the chapter's last stump`);
        return;
      }
      if (isLast) problems.push(`${where}: the chapter's last stump must be the checkpoint (a stump without a lesson)`);
      listed.push(id);
    });
  });
});
for (const id of new Set(listed.filter((id, i) => listed.indexOf(id) !== i))) problems.push(`trail: lesson ${id} is on it twice`);

// Lessons
for (const [id, lesson] of Object.entries(bundle.lessons)) {
  const p = (message: string) => problems.push(`${id}: ${message}`);
  if (!CHARACTERS.has(lesson.with)) p(`partner must be one of ${[...CHARACTERS].join(", ")}`);
  if (lesson.steps.length === 0) p("has no steps");

  const sceneLines = lesson.scenes.flat().flatMap((line) => variants(line.text));
  lesson.words.forEach((word, w) => {
    for (const example of [word.example, ...(word.example_f ? [word.example_f] : [])]) {
      if (!sceneLines.includes(example)) p(`word ${w + 1} "${word.text[L]}": example "${example}" is not a line of its scenes`);
    }
  });

  lesson.steps.forEach((step, s) => {
    const where = `step ${s + 1} (${step.kind})`;
    const sp = (message: string) => p(`${where}: ${message}`);
    if (!KINDS.has(step.kind)) {
      notes.push(`${id} ${where}: unknown kind, the apps skip this step`);
      return;
    }
    const word = typeof step.word === "number" ? lesson.words[step.word] : undefined;
    const phrase = step.phrase === undefined ? undefined : lesson.phrases[step.phrase];
    const scene = step.scene === undefined ? undefined : lesson.scenes[step.scene];

    switch (step.kind) {
      case "scene":
      case "conversation":
        if (!scene?.length) return sp("its scene has no lines");
        if (step.kind === "conversation") {
          scene.forEach((line, n) => {
            if (line.speaker !== "boar") return;
            const task = line.task;
            if (!task || (!task.build && !task.choose)) return sp(`the boar's line ${n + 1} needs a task (build or choose)`);
            for (const text of variants(line.text)) {
              if (task.build) {
                if (task.build.length === 0) sp(`line ${n + 1}: build needs extra tiles`);
                for (const tile of task.build) if (tiles(text).includes(tile)) sp(`line ${n + 1}: extra tile "${tile}" is a tile of the line`);
              }
              if (task.choose) {
                if (task.choose.length === 0) sp(`line ${n + 1}: choose needs wrong replies`);
                if (task.choose.includes(text)) sp(`line ${n + 1}: a wrong reply is the line itself`);
              }
            }
          });
        }
        return;
      case "tip":
        return;
      case "word_card":
      case "listen_pick":
      case "pick_meaning":
      case "say_in_english":
      case "spell":
        if (!word) return sp("points at no word");
        if (step.kind !== "word_card" && lesson.words.length < 2) sp("needs at least two words in the lesson for its options");
        if (step.kind === "spell") {
          for (const text of variants(word.text)) {
            if (text.includes(" ") || [...text].length > 8) sp(`"${text}" is too long to spell letter by letter (one word, 8 letters at most)`);
          }
        }
        return;
      case "match_words": {
        const words = step.words ?? lesson.words.map((_, i) => i);
        if (words.some((w) => !lesson.words[w])) sp("points at a word the lesson doesn't have");
        if (words.length < 2) sp("needs at least two words to match");
        return;
      }
      case "pick_translation":
        if (!phrase) return sp("points at no phrase");
        if (lesson.phrases.length < 2) sp("needs at least two phrases in the lesson for its options");
        return;
      case "fill_gap":
      case "spot_mistake":
        if (!phrase) return sp("points at no phrase");
        if (!step.wrong?.length) sp("needs wrong options");
        if (step.wrong?.includes(step.gap ?? "")) sp("a wrong option is the gap word itself");
        for (const text of variants(phrase.text)) {
          const matches = tiles(text).filter((t) => bare(t) === step.gap);
          if (matches.length !== 1) sp(`gap "${step.gap}" must be exactly one whole word of "${text}"`);
          if (step.kind === "spot_mistake" && tiles(text).length < 4) {
            notes.push(`${id} ${where}: "${text}" is short; finding the wrong word in it is a guess`);
          }
        }
        return;
      case "build_phrase":
      case "listen_build":
        if (!phrase) return sp("points at no phrase");
        if (!step.extra?.length) sp("needs extra tiles");
        for (const text of variants(phrase.text)) {
          for (const tile of step.extra ?? []) if (tiles(text).includes(tile)) sp(`extra tile "${tile}" is a tile of "${text}"`);
        }
        return;
      case "swap": {
        const frame = step.frame ?? "";
        if (frame.split("{slot}").length !== 2) sp("frame needs {slot} exactly once");
        const swapWord = typeof step.word === "object" ? step.word : undefined;
        if (!swapWord || !step.sentence) return sp("needs a word and a sentence");
        if (!step.wrong?.length) sp("needs wrong options");
        const words = variants(swapWord);
        variants(step.sentence).forEach((sentence, v) => {
          const filled = frame.replace("{slot}", words[Math.min(v, words.length - 1)]);
          if (sentence !== filled) sp(`sentence "${sentence}" is not the frame filled with its word ("${filled}")`);
        });
        if (step.wrong?.some((w) => words.includes(w))) sp("a wrong option is the word itself");
        return;
      }
    }
  });
}

// Missing translations, on the trail's texts only: drafts aren't sent yet.
const onTrail = Object.keys(bundle.lessons).map(quote).join(", ") || "''";
const learners = `array[${config.languages.map(quote).join(", ")}]`;
const missing = await query(`
  select p.lesson, p.part, p.position, string_agg(l.language, ' ' order by l.language) as languages
  from lingo.content_text_places p
  cross join lateral unnest(${learners} || case when p.learned then array[${quote(L)}] else array[]::text[] end) as l(language)
  where p.app = ${quote(app)} and (p.lesson is null or p.lesson in (${onTrail}))
    and not exists (select 1 from lingo.translations t where t.text_id = p.text_id and t.language = l.language)
  group by p.lesson, p.part, p.position, p.text_id
  order by p.lesson nulls first, p.part, p.position`);
for (const row of missing) {
  problems.push(`${row.lesson ?? "trail"} ${row.part} ${row.position}: missing ${row.languages}`);
}

console.log(`== ${app}`);
for (const note of notes) console.log(`note: ${note}`);
for (const problem of problems) console.log(problem);
console.log(`${problems.length} problem(s) in ${Object.keys(bundle.lessons).length} lessons`);
Deno.exit(problems.length ? 1 : 0);
