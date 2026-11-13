// Does `userHoldsAppData` (supabase/functions/_shared/erase-user.ts) still know
// every per-user table and bucket on the shared project? Run it before every
// `supabase functions deploy`, after `supabase db push`, from the repo root:
//
//   deno run --allow-run=supabase --allow-read snippets/check-account-tables.ts [--linked | --local | --db-url <url>]
//
// --linked (the default) reads the production catalog through the CLI; it
// only reads. --local reads your local stack, for a migration not yet pushed.
// --erase-user <file> checks another copy of erase-user.ts (default: the
// working tree's).
//
// Why it matters: deleting data in one app deletes the auth user unless
// another app still holds something of theirs, and every per-user table
// cascades from auth.users. A table missing from the list is wiped without
// warning when the same person deletes their data in a different app; a
// listed table missing from the database makes every app's delete-my-data
// fail at the account step.
//
// Every table in an app schema (any schema but Supabase's own) must be:
//   - listed: named in userHoldsAppData;
//   - covered: reached through a not-null, on-delete-cascade foreign key from a
//     covered or listed table, so its rows can't outlive a row the list sees
//     (lyncil.songs under lyncil.profiles). A table that points at auth.users
//     itself is never covered this way: it has to be listed;
//   - or in NOT_PER_USER below, with the reason.
// Storage buckets: listed in the function's bucket_id filter, or in
// SHARED_BUCKETS. Exit code 1 when anything is undecided or contradictory.

import { parseArgs } from "jsr:@std/cli@1/parse-args";

const LINGO_CATALOG = "the Lingo course, the same for every learner";
const TREDDY = "keyed by the Threads account; Treddy never creates Supabase users";

/** Tables that hold nothing of a Supabase user's, and why. */
const NOT_PER_USER: Record<string, string> = {
  "lingo.chapters": LINGO_CATALOG,
  "lingo.lesson_steps": LINGO_CATALOG,
  "lingo.lessons": LINGO_CATALOG,
  "lingo.phrases": LINGO_CATALOG,
  "lingo.scene_lines": LINGO_CATALOG,
  "lingo.scenes": LINGO_CATALOG,
  "lingo.step_words": LINGO_CATALOG,
  "lingo.stumps": LINGO_CATALOG,
  "lingo.texts": LINGO_CATALOG,
  "lingo.translations": LINGO_CATALOG,
  "lingo.units": LINGO_CATALOG,
  "lingo.words": LINGO_CATALOG,
  "lyncil.store_products": "the App Store product catalog",
  "public.app_config": "app configuration, one row per app",
  "shared.offer_rules": "offer configuration shared by the apps",
  "shared.offer_seasons": "offer configuration shared by the apps",
  "treddy.accounts": TREDDY,
  "treddy.ai_usage": TREDDY,
  "treddy.devices": TREDDY,
  "treddy.job_runs": "Treddy's scheduler log",
  "treddy.mcp_clients": TREDDY,
  "treddy.mcp_grants": TREDDY,
  "treddy.mcp_pairings": TREDDY,
  "treddy.posts": TREDDY,
};

/** Buckets keyed by content, not by user. */
const SHARED_BUCKETS: Record<string, string> = {
  "affirmations-tts-cache": "clips keyed by a hash of their text",
  "lingo-tts-cache": "clips keyed by a hash of their text",
};

const SUPABASE_SCHEMAS = [
  "auth", "cron", "extensions", "graphql", "graphql_public", "information_schema",
  "net", "pgbouncer", "realtime", "storage", "supabase_functions", "supabase_migrations",
  "vault", "_realtime", "_analytics",
];

const ERASE_USER = "supabase/functions/_shared/erase-user.ts";

// ── What the function checks ──

function listedInEraseUser(source: string): { tables: Set<string>; buckets: Set<string> } {
  const start = source.indexOf("async function userHoldsAppData");
  const end = source.indexOf("as in_use", start);
  if (start < 0 || end < 0) throw new Error(`userHoldsAppData not found in ${ERASE_USER}`);
  const body = source.slice(start, end);
  const tables = new Set(
    [...body.matchAll(/\bfrom\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/g)]
      .map((m) => `${m[1]}.${m[2]}`)
      .filter((t) => t !== "storage.objects"),
  );
  const buckets = new Set<string>();
  for (const filter of body.matchAll(/bucket_id\s+in\s*\(([^)]*)\)/g)) {
    for (const id of filter[1].matchAll(/'([^']+)'/g)) buckets.add(id[1]);
  }
  return { tables, buckets };
}

// ── What the database has ──

interface ForeignKey {
  child: string;
  parent: string;
  cascade: boolean;
  notNull: boolean;
}

interface Catalog {
  tables: string[];
  fks: ForeignKey[];
  buckets: string[];
}

const CATALOG_SQL = `
with app as (
  select oid, nspname from pg_namespace
  where nspname not like 'pg\\_%' and nspname <> all (array[${SUPABASE_SCHEMAS.map((s) => `'${s}'`).join(",")}])
), rel as (
  select c.oid, n.nspname || '.' || c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
)
select json_build_object(
  'tables', coalesce((select json_agg(n.nspname || '.' || c.relname order by 1)
    from pg_class c join app n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition), '[]'::json),
  'fks', coalesce((select json_agg(json_build_object(
      'child', child.name, 'parent', parent.name,
      'cascade', k.confdeltype = 'c',
      'notNull', (select bool_and(a.attnotnull) from pg_attribute a
                  where a.attrelid = k.conrelid and a.attnum = any (k.conkey))))
    from pg_constraint k
    join rel child on child.oid = k.conrelid
    join rel parent on parent.oid = k.confrelid
    where k.contype = 'f' and k.connamespace in (select oid from app)), '[]'::json),
  'buckets', coalesce((select json_agg(id order by id) from storage.buckets), '[]'::json)
) as catalog`;

/// The query's rows from `supabase db query --output-format json`. The CLI
/// prints a bare array of rows in a terminal and `{ rows: [...] }` when an
/// agent runs it, and can add notices (config warnings, update hints) around
/// either, so this takes the first JSON value that starts a line.
function queryRows(text: string): Record<string, unknown>[] {
  for (const match of text.matchAll(/^[[{]/gm)) {
    const value = balancedJson(text, match.index);
    if (value === undefined) continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.rows)) return parsed.rows;
    } catch {
      // Not JSON after all; try the next line.
    }
  }
  throw new Error(`no query result in the CLI's output:\n${text}`);
}

function balancedJson(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      depth++;
    } else if ((c === "}" || c === "]") && --depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return undefined;
}

async function readCatalog(target: string[]): Promise<Catalog> {
  const out = await new Deno.Command("supabase", {
    args: ["db", "query", ...target, "--output-format", "json", CATALOG_SQL],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (!out.success) {
    throw new Error(`supabase db query failed:\n${new TextDecoder().decode(out.stderr)}${text}`);
  }
  const catalog = queryRows(text)[0]?.catalog;
  if (catalog === undefined || catalog === null) throw new Error(`the catalog query returned no row:\n${text}`);
  return (typeof catalog === "string" ? JSON.parse(catalog) : catalog) as Catalog;
}

// ── The rules ──

async function main() {
  const args = parseArgs(Deno.args, { boolean: ["linked", "local"], string: ["db-url", "erase-user"] });
  const target = args.local ? ["--local"] : args["db-url"] ? ["--db-url", args["db-url"]] : ["--linked"];
  try {
    await check(target, args["erase-user"] ?? ERASE_USER);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(2);
  }
}

async function check(target: string[], eraseUserPath: string) {
  const listed = listedInEraseUser(await Deno.readTextFile(eraseUserPath));
  const db = await readCatalog(target);
  const inDb = new Set(db.tables);
  const errors: string[] = [];
  const warnings: string[] = [];

  const pointsAtUsers = new Set(db.fks.filter((k) => k.parent === "auth.users").map((k) => k.child));

  // Covered: rows that can only exist under a listed (or covered) row.
  const coveredBy = new Map<string, string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const k of db.fks) {
      if (coveredBy.has(k.child) || listed.tables.has(k.child) || pointsAtUsers.has(k.child)) continue;
      if (!k.cascade || !k.notNull) continue;
      if (listed.tables.has(k.parent) || coveredBy.has(k.parent)) {
        coveredBy.set(k.child, k.parent);
        grew = true;
      }
    }
  }

  for (const table of db.tables) {
    const reason = NOT_PER_USER[table];
    if (listed.tables.has(table)) {
      if (reason) warnings.push(`${table} is listed and also in NOT_PER_USER; drop it from NOT_PER_USER`);
      continue;
    }
    if (reason !== undefined) {
      if (pointsAtUsers.has(table)) {
        errors.push(`${table} is in NOT_PER_USER ("${reason}") but references auth.users: list it in userHoldsAppData`);
      }
      continue;
    }
    if (coveredBy.has(table)) continue;
    errors.push(
      pointsAtUsers.has(table)
        ? `${table} references auth.users but userHoldsAppData doesn't check it`
        : `${table} is undecided: add it to userHoldsAppData if it holds a user's rows, or to NOT_PER_USER with the reason`,
    );
  }

  for (const table of listed.tables) {
    if (!inDb.has(table)) {
      errors.push(
        `${table} is checked by userHoldsAppData but isn't in this database: apply its migration first, ` +
          `or every delete-my-data fails at the account step`,
      );
    }
  }
  for (const table of Object.keys(NOT_PER_USER)) {
    if (!inDb.has(table)) warnings.push(`${table} is in NOT_PER_USER but not in this database (dropped?)`);
  }

  for (const bucket of db.buckets) {
    if (!listed.buckets.has(bucket) && !SHARED_BUCKETS[bucket]) {
      errors.push(`bucket ${bucket} is undecided: add it to the bucket_id filter, or to SHARED_BUCKETS with the reason`);
    }
  }
  for (const bucket of listed.buckets) {
    if (!db.buckets.includes(bucket)) warnings.push(`bucket ${bucket} is checked but doesn't exist here`);
  }

  console.log(`Database: ${target.join(" ")}`);
  console.log(
    `${db.tables.length} tables: ${[...listed.tables].filter((t) => inDb.has(t)).length} listed, ` +
      `${coveredBy.size} covered through a listed parent, ` +
      `${db.tables.filter((t) => NOT_PER_USER[t] !== undefined && !listed.tables.has(t)).length} not per user. ` +
      `${db.buckets.length} buckets.`,
  );
  for (const [child, parent] of [...coveredBy].sort()) console.log(`  covered: ${child} (under ${parent})`);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`ERROR: ${e}`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} problem(s): don't deploy functions until they're fixed.`);
    Deno.exit(1);
  }
  console.log("\nOK: every per-user table and bucket is known to userHoldsAppData.");
}

if (import.meta.main) await main();
