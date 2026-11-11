// Publishes one app's lessons — content/lingo/<app>/trail.json and
// lessons/<id>.json — to lingo.lesson_content, where lingo/content serves
// them to every installed copy of the app. Run from the repo root:
//
//   deno run --allow-run --allow-read --allow-write --allow-env \
//     content/lingo/publish.ts <hutarka|hejka> --local      # the stack `supabase start` runs
//   deno run --allow-run --allow-read --allow-write --allow-env \
//     content/lingo/publish.ts <hutarka|hejka> --linked     # the shared project: PRODUCTION
//
// (--db-url <postgres url> instead targets any database, for trying it out.)
//
// It runs check-lessons.py first and stops at the first problem, then shows
// what would change (added, changed, removed files) against what is
// published and, with --linked, asks for a "publish" before writing. The
// write is one transaction: the app's rows are upserted and the ones whose
// file is gone are deleted, so a learner never fetches half a release.
//
// What publishing does to learners: every installed copy fetches the new
// bundle at its next launch and uses it from then on. Lessons are addressed by id and the
// trail's steps by position — `trailProgress` in the apps is "steps
// finished", a count — so REORDERING or REMOVING stumps silently moves every
// learner's boar to a different lesson; add lessons at the end of the trail,
// fix text in place, and treat a removal as something to plan.
//
// Publishing goes through `supabase db query` (the Management API with
// --linked, Docker with --local), like the other scripts here, so it needs
// the Supabase CLI logged in and linked to the project.

import { parseArgs } from "jsr:@std/cli@1/parse-args";

const APPS = ["hutarka", "hejka"];
const TRAIL_ID = "trail";
const SQL_TAG = "$lingo_body$";

const args = parseArgs(Deno.args, { boolean: ["local", "linked", "yes"], string: ["db-url"] });

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const app = String(args._[0] ?? "");
if (!APPS.includes(app)) fail(`Usage: publish.ts <${APPS.join("|")}> --local|--linked [--yes]`);
const targets = [args.local && "--local", args.linked && "--linked", args["db-url"] && "--db-url"].filter(Boolean);
if (targets.length !== 1) fail("Pass exactly one of --local (your stack), --linked (production) and --db-url <url> (any Postgres)");
// Where `supabase db query` writes: the same flags, so a scratch database works for trying the script.
const target: string[] = args["db-url"] ? ["--db-url", args["db-url"]] : [targets[0] as string];

const here = new URL(".", import.meta.url).pathname;
const folder = `${here}${app}/`;

// 1. The format checks: nothing broken reaches the apps.
const check = await new Deno.Command("python3", {
  args: [`${here}check-lessons.py`, app],
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!check.success) fail("check-lessons.py found problems; fix them first");

// 2. The files, hashed over their parsed JSON so reformatting a file is not a change.
interface Entry {
  id: string;
  body: unknown;
  checksum: string;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function entry(id: string, path: string): Promise<Entry> {
  const body = JSON.parse(await Deno.readTextFile(path));
  return { id, body, checksum: await sha256(JSON.stringify(body)) };
}

const entries: Entry[] = [await entry(TRAIL_ID, `${folder}trail.json`)];
for await (const file of Deno.readDir(`${folder}lessons`)) {
  if (!file.isFile || !file.name.endsWith(".json")) continue;
  const id = file.name.slice(0, -".json".length);
  if (id === TRAIL_ID) fail(`lessons/${file.name}: a lesson cannot be called ${TRAIL_ID}`);
  entries.push(await entry(id, `${folder}lessons/${file.name}`));
}
entries.sort((a, b) => a.id.localeCompare(b.id));
for (const { id, body } of entries) {
  if (JSON.stringify(body).includes(SQL_TAG)) fail(`${id}: contains the SQL quoting tag ${SQL_TAG}`);
}

// 3. What is published now, so the change is visible before it happens.
async function query(sqlText: string): Promise<Record<string, unknown>[]> {
  const out = await new Deno.Command("supabase", {
    args: ["db", "query", ...target, "--output-format", "json", sqlText],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout).trim();
  if (!out.success) fail(`supabase db query failed: ${new TextDecoder().decode(out.stderr)}${text}`);
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.rows ?? [];
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const published = await query(
  `select id, checksum from lingo.lesson_content where app = ${literal(app)}`,
) as { id: string; checksum: string }[];
const before = new Map(published.map((row) => [row.id, row.checksum]));
const added = entries.filter((e) => !before.has(e.id)).map((e) => e.id);
const changed = entries.filter((e) => before.has(e.id) && before.get(e.id) !== e.checksum).map((e) => e.id);
const removed = [...before.keys()].filter((id) => !entries.some((e) => e.id === id)).sort();

console.log(`\n${app} on ${args.linked ? "the shared project (PRODUCTION)" : args.local ? "the local stack" : args["db-url"]}:`);
console.log(`  ${entries.length - 1} lessons + the trail in ${folder}`);
console.log(`  added:   ${added.length ? added.join(", ") : "-"}`);
console.log(`  changed: ${changed.length ? changed.join(", ") : "-"}`);
console.log(`  removed: ${removed.length ? removed.join(", ") : "-"}`);
if (!added.length && !changed.length && !removed.length) {
  console.log("Nothing to publish: what is published matches the files.");
  Deno.exit(0);
}
if (removed.length || changed.includes(TRAIL_ID)) {
  console.log(
    "\n  The trail changes. Every learner's progress is a position on it: a reordered or\n" +
      "  removed stump moves their boar to a different lesson at their next launch.",
  );
}

if (args.linked && !args.yes) {
  const answer = prompt('\nType "publish" to write this to production, anything else to stop:');
  if (answer !== "publish") fail("Stopped; nothing was written.");
}

// 4. One statement, so it is one transaction (`supabase db query` runs a single
// command): upsert every file, then delete the rows whose file is gone.
const values = entries
  .map((e) =>
    `(${literal(app)}, ${literal(e.id)}, ${SQL_TAG}${JSON.stringify(e.body)}${SQL_TAG}::jsonb, ${literal(e.checksum)})`
  )
  .join(",\n");
const keep = entries.map((e) => literal(e.id)).join(", ");
const statement = `with published as (
  insert into lingo.lesson_content (app, id, body, checksum)
  values
${values}
  on conflict (app, id) do update
    set body = excluded.body, checksum = excluded.checksum, published_at = now()
    where lingo.lesson_content.checksum is distinct from excluded.checksum
  returning id
)
delete from lingo.lesson_content where app = ${literal(app)} and id not in (${keep})
`;
const sqlFile = await Deno.makeTempFile({ prefix: `lingo-${app}-`, suffix: ".sql" });
try {
  await Deno.writeTextFile(sqlFile, statement);
  const out = await new Deno.Command("supabase", {
    args: ["db", "query", ...target, "--file", sqlFile],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    fail(`Publishing failed: ${new TextDecoder().decode(out.stderr)}${new TextDecoder().decode(out.stdout)}`);
  }
} finally {
  await Deno.remove(sqlFile).catch(() => {});
}

const after = await query(
  `select count(*)::int as rows from lingo.lesson_content where app = ${literal(app)}`,
);
console.log(`\nPublished: ${after[0]?.rows ?? "?"} rows for ${app}. Learners get it at their next launch.`);
