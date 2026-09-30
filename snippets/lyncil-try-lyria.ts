// Try Google Lyria by ear before wiring it into the app: one song from real
// Lyncil-style lyrics, saved next to this file, plus the one thing the Lyria
// docs don't say — whether the Interactions API accepts `background: true`
// for Lyria (lyncil/lyria.ts falls back to a synchronous call if it doesn't).
//
//   GEMINI_API_KEY=... deno run -A snippets/lyncil-try-lyria.ts [voice] [lyrics file] [style]
//
//   voice   male | female | instrumental (default female)
//   lyrics  a text file with your lyrics, [Verse]/[Chorus] tags welcome
//           (default: the Wildfire Season sample below)
//   style   genre and mood, e.g. "pop, romantic" (default "rock, emotional")
//
// Costs one song ($0.08 on lyria-3.5). Billing must be on for the key's
// project: Lyria has no free tier.

const KEY = Deno.env.get("GEMINI_API_KEY");
if (!KEY) {
  console.error("Set GEMINI_API_KEY");
  Deno.exit(1);
}
const MODEL = Deno.env.get("LYRIA_MODEL") ?? "lyria-3.5";
const VOICE = Deno.args[0] ?? "female";
const LYRICS_FILE = Deno.args[1];
const STYLE = Deno.args[2] ?? "rock, emotional";
const URL_BASE = "https://generativelanguage.googleapis.com/v1beta";

const SAMPLE_LYRICS = `[Verse 1]
Static on the radio, engine running hot
Headlights on a highway that forgot what it forgot
I've got a pocket full of matches and a reason to be gone
Every mile's a promise that I'm finally moving on

[Chorus]
It's wildfire season, I'm burning through the doubt
Every word you buried, I'm gonna scream it out
Let the whole horizon know what this feels like
It's wildfire season and I'm finally alight`;

const LYRICS = LYRICS_FILE ? (await Deno.readTextFile(LYRICS_FILE)).trim() : SAMPLE_LYRICS;

// Same wording as lyncil/lyria.ts, so what you hear is what the app gets.
const input = VOICE === "instrumental"
  ? `Create an instrumental ${STYLE} track, about two minutes long. No vocals.`
  : `Create a ${STYLE} song, about two to three minutes long, sung by a ${VOICE} vocalist. ` +
    `Sing exactly these lyrics, following their section tags:\n\n${LYRICS}`;

async function call(path: string, body?: unknown) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-goog-api-key": KEY!, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { res, json: await res.json().catch(() => ({})) };
}

function audioOf(interaction: any): { data: string; mime_type?: string } | null {
  const blocks = (interaction.steps ?? [])
    .filter((step: any) => step.type === "model_output")
    .flatMap((step: any) => step.content ?? [])
    .filter((block: any) => block.type === "audio" && block.data);
  return blocks.at(-1) ?? null;
}

const started = Date.now();
const seconds = () => ((Date.now() - started) / 1000).toFixed(1);

let interaction: any;
const first = await call("/interactions", { model: MODEL, input, background: true });
if (first.res.ok) {
  console.log(`background mode: accepted (id ${first.json.id}, status ${first.json.status})`);
  interaction = first.json;
  while (!["completed", "failed", "cancelled", "incomplete"].includes(interaction.status)) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const polled = await call(`/interactions/${encodeURIComponent(first.json.id)}`);
    if (!polled.res.ok) {
      console.error(`poll failed: HTTP ${polled.res.status}`, JSON.stringify(polled.json));
      Deno.exit(1);
    }
    interaction = polled.json;
    console.log(`  ${seconds()} s: ${interaction.status}`);
  }
} else {
  console.log(`background mode: refused (HTTP ${first.res.status}) ${JSON.stringify(first.json.error ?? first.json)}`);
  console.log("trying a synchronous call…");
  const sync = await call("/interactions", { model: MODEL, input });
  if (!sync.res.ok) {
    console.error(`sync call failed: HTTP ${sync.res.status}`, JSON.stringify(sync.json));
    Deno.exit(1);
  }
  interaction = sync.json;
}

const audio = audioOf(interaction);
if (!audio) {
  console.error(`no audio in the response (status ${interaction.status})`, JSON.stringify(interaction.error ?? {}));
  Deno.exit(1);
}
const extension = audio.mime_type === "audio/wav" ? "wav" : "mp3";
const file = new URL(`./lyria-${VOICE}-${Date.now()}.${extension}`, import.meta.url);
const binary = atob(audio.data);
const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
await Deno.writeFile(file, bytes);
console.log(`done in ${seconds()} s → ${file.pathname} (${(bytes.length / 1e6).toFixed(1)} MB, ${audio.mime_type})`);

const lyrics = (interaction.steps ?? [])
  .filter((step: any) => step.type === "model_output")
  .flatMap((step: any) => step.content ?? [])
  .filter((block: any) => block.type === "text")
  .map((block: any) => block.text)
  .join("\n");
if (lyrics) console.log(`\nwhat Lyria says it sang:\n${lyrics}`);
