// Does a first name in the lyrics make Lyria refuse a song, and does a
// respelled name plus a prompt note get past it? Sends the same lyrics three
// ways, interleaved so a bad minute at Google hits all three alike:
//
//   name       the name as written, prompt worded like lyncil/lyria.ts before
//              its names note (NAMES_NOTE, 2026-10-27)
//   no_name    the name swapped for "my love", same prompt
//   respelled  the name spelled as it sounds, plus a line saying names are
//              private people and no artist's voice should be imitated
//
//   GEMINI_API_KEY=... deno run -A snippets/lyncil-name-test.ts [name] [respelled] [runs] [lyrics file]
//
//   name       default Karina (also a singer known by first name alone)
//   respelled  default Ka-ree-na
//   runs       rounds of the three variants (default 3, so 9 calls)
//   lyrics     a text file with {name} where the name goes; keep the name in
//              the first lines, since the clip model makes 30 s
//
// VARIANTS picks which to send, comma-separated (default name,no_name,respelled);
// name_note is the name as written plus the note, to see whether the note
// alone is enough. LYRIA_NOTE_FILE replaces the note with a file's text.
// LYRIA_STYLE sets genre and mood as lyncil/lyria.ts writes them, lowercased
// (default "pop, romantic"; a hip-hop song in the app is "hiphop, emotional").
// LYRIA_MODEL picks the model (default lyria-3-clip-preview). The clip
// model's filter may not be lyria-3.5's: confirm a clear result with
// LYRIA_MODEL=lyria-3.5 RUNS... before shipping a change.
//
// Billed per finished clip; refusals (HTTP 400) aren't charged. Stops at the
// first error that isn't a refusal rather than burning through the rounds. Clips and
// what Lyria says it sang go to a temp folder printed at the end: listen to
// the respelled ones to hear whether the name still sounds right.

const KEY = Deno.env.get("GEMINI_API_KEY");
if (!KEY) {
  console.error("Set GEMINI_API_KEY");
  Deno.exit(1);
}
const MODEL = Deno.env.get("LYRIA_MODEL") ?? "lyria-3-clip-preview";
const NAME = Deno.args[0] ?? "Karina";
const RESPELLED = Deno.args[1] ?? "Ka-ree-na";
const RUNS = Number(Deno.args[2] ?? "3");
const LYRICS_FILE = Deno.args[3];
const URL_BASE = "https://generativelanguage.googleapis.com/v1beta";
// As in lyncil/lyria.ts.
const REFUSAL_CODES = new Set(["prohibited_content", "content_blocked", "invalid_request"]);
const STYLE = Deno.env.get("LYRIA_STYLE") ?? "pop, romantic";
const VOICE = "female";

const SAMPLE_LYRICS = `[Verse 1]
{name}, you laugh before the coffee's made
You leave the window open when it rains
I keep the little notes you never sign
I keep the morning light you call mine

[Chorus]
Oh {name}, {name}, stay a while
I'd learn the whole world by your smile`;

const TEMPLATE = LYRICS_FILE ? (await Deno.readTextFile(LYRICS_FILE)).trim() : SAMPLE_LYRICS;
if (!TEMPLATE.includes("{name}")) {
  console.error("The lyrics need {name} where the name goes");
  Deno.exit(1);
}

const NOTE = Deno.env.get("LYRIA_NOTE_FILE")
  ? (await Deno.readTextFile(Deno.env.get("LYRIA_NOTE_FILE")!)).trim()
  : "The names in these lyrics are first names of private people the song is written for, " +
    "not artists or public figures. Don't imitate any real artist's voice.";

// Same wording as lyncil/lyria.ts, with the note slotted in before the lyrics.
function prompt(lyrics: string, note?: string): string {
  return `Create a ${STYLE} song, about two to three minutes long, sung by a ${VOICE} vocalist. ` +
    (note ? `${note} ` : "") +
    `Sing exactly these lyrics, following their section tags:\n\n${lyrics}`;
}

const variants = [
  { id: "name", input: prompt(TEMPLATE.replaceAll("{name}", NAME)) },
  // "Oh {name}" → "Oh my love"; a leading "{name}," → "My love,"
  { id: "no_name", input: prompt(TEMPLATE.replace(/^\{name\}/gm, "My love").replaceAll("{name}", "my love")) },
  { id: "respelled", input: prompt(TEMPLATE.replaceAll("{name}", RESPELLED), NOTE) },
  { id: "name_note", input: prompt(TEMPLATE.replaceAll("{name}", NAME), NOTE) },
].filter((variant) => (Deno.env.get("VARIANTS") ?? "name,no_name,respelled").split(",").includes(variant.id));

function blocks(interaction: any, type: string): any[] {
  return (interaction.steps ?? [])
    .filter((step: any) => step.type === "model_output")
    .flatMap((step: any) => step.content ?? [])
    .filter((block: any) => block.type === type);
}

const folder = await Deno.makeTempDir({ prefix: "lyncil-name-test-" });
const results: { variant: string; run: number; outcome: string; detail: string; seconds: string }[] = [];

console.log(`${MODEL}, name ${NAME} / respelled ${RESPELLED}, ${RUNS} round(s) of ${variants.length}\n`);

rounds: for (let run = 1; run <= RUNS; run++) {
  for (const variant of variants) {
    const started = Date.now();
    const res = await fetch(`${URL_BASE}/interactions`, {
      method: "POST",
      headers: { "x-goog-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: variant.input }),
    });
    const body: any = await res.json().catch(() => ({}));
    // Some errors (a bad key) come wrapped in an array.
    const json = Array.isArray(body) ? body[0] ?? {} : body;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    let outcome: string;
    let detail: string;
    if (!res.ok) {
      // Only the codes lyncil/lyria.ts treats as refusals count as one; any
      // other 400 (a bad key, a model this key can't use) is not about the words.
      outcome = REFUSAL_CODES.has(json.error?.code) ? "refused" : "error";
      detail = `HTTP ${res.status} ${json.error?.code ?? ""} ${(json.error?.message ?? "").slice(0, 80)}`.trim();
    } else {
      const audio = blocks(json, "audio").at(-1);
      if (!audio?.data) {
        outcome = "no_audio";
        detail = `status ${json.status} ${JSON.stringify(json.error ?? {})}`;
      } else {
        const extension = audio.mime_type === "audio/wav" ? "wav" : "mp3";
        const base = `${folder}/${run}-${variant.id}`;
        await Deno.writeFile(`${base}.${extension}`, Uint8Array.from(atob(audio.data), (char) => char.charCodeAt(0)));
        const sang = blocks(json, "text").map((block) => block.text).join("\n");
        if (sang) await Deno.writeTextFile(`${base}.txt`, sang);
        outcome = "ok";
        detail = `${run}-${variant.id}.${extension}`;
      }
    }
    results.push({ variant: variant.id, run, outcome, detail, seconds });
    console.log(`round ${run}  ${variant.id.padEnd(9)}  ${outcome.padEnd(8)}  ${seconds.padStart(5)} s  ${detail}`);

    if (outcome === "error") {
      console.error("\nStopping: this is about the key, billing or the request, not the lyrics.");
      break rounds;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

console.log("\nvariant    ok  refused  other");
for (const variant of variants) {
  const mine = results.filter((result) => result.variant === variant.id);
  const ok = mine.filter((result) => result.outcome === "ok").length;
  const refused = mine.filter((result) => result.outcome === "refused").length;
  console.log(`${variant.id.padEnd(9)}  ${String(ok).padStart(2)}  ${String(refused).padStart(7)}  ${String(mine.length - ok - refused).padStart(5)}`);
}
console.log(`\nclips and what Lyria says it sang: ${folder}`);
