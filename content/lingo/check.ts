// Builds an app's bundle from the lingo tables exactly as lingo/content sends
// it, and runs the format checks (check-lessons.py) on it. Edits are live, so
// run it after changing content, and fix what it reports before learners
// launch into it. Run from the repo root:
//
//   deno run --allow-run --allow-read --allow-write content/lingo/check.ts <hutarka|hejka> --linked
//   deno run --allow-run --allow-read --allow-write content/lingo/check.ts <hutarka|hejka> --local
//
// (--db-url <postgres url> targets any database.) Reads only; goes through
// `supabase db query`, so it needs the CLI logged in and linked.

import { parseArgs } from "jsr:@std/cli@1/parse-args";

const APPS = ["hutarka", "hejka"];
const args = parseArgs(Deno.args, { boolean: ["local", "linked"], string: ["db-url"] });

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const app = String(args._[0] ?? "");
if (!APPS.includes(app)) fail(`Usage: check.ts <${APPS.join("|")}> --local|--linked|--db-url <url>`);
const targets = [args.local && ["--local"], args.linked && ["--linked"], args["db-url"] && ["--db-url", args["db-url"]]]
  .filter(Boolean) as string[][];
if (targets.length !== 1) fail("Pass exactly one of --local, --linked and --db-url <url>");

const out = await new Deno.Command("supabase", {
  args: ["db", "query", ...targets[0], "--output-format", "json", `select lingo.content_bundle('${app}') as bundle`],
  stdout: "piped",
  stderr: "piped",
}).output();
const text = new TextDecoder().decode(out.stdout);
if (!out.success) fail(`supabase db query failed: ${new TextDecoder().decode(out.stderr)}${text}`);
const parsed = JSON.parse(text);
const rows = Array.isArray(parsed) ? parsed : parsed.rows;
const bundle = typeof rows[0].bundle === "string" ? JSON.parse(rows[0].bundle) : rows[0].bundle;

const file = await Deno.makeTempFile({ prefix: `lingo-${app}-`, suffix: ".json" });
try {
  await Deno.writeTextFile(file, JSON.stringify(bundle));
  const check = await new Deno.Command("python3", {
    args: [new URL("./check-lessons.py", import.meta.url).pathname, app, file],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  Deno.exit(check.code);
} finally {
  await Deno.remove(file).catch(() => {});
}
