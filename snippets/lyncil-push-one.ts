// One push with your own words to one Lyncil user's phones, for a personal
// message (an apology after an outage, say). Run from the repo root on your
// Mac; it is deliberately not a backend route, because a route that sends
// any text would let whoever pulls the app key out of the binary message
// every user.
//
//   deno run --allow-run --allow-read --allow-env --allow-net \
//     snippets/lyncil-push-one.ts --user <uuid> --title "…" --body "…" \
//     --key-file ~/keys/AuthKey_XXXX.p8 --key-id XXXX [--send]
//
// Without --send it only shows what would go out. The text is sent as is
// (no loc keys), so write it in the user's language: the device's locale
// is printed. The production APNs key is the .p8 from the Apple Developer
// account (the same one in Supabase's LYNCIL_APNS_PRIVATE_KEY); the team id
// comes from --team-id or LYNCIL_APNS_TEAM_ID in supabase/functions/.env.
// Devices are read with the Supabase CLI (linked to the Lyncil project).
// Apple allows service messages like this; not promotions.

import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { type Device, makeAPNs } from "../supabase/functions/_shared/apns.ts";

const args = parseArgs(Deno.args, {
  string: ["user", "title", "body", "key-file", "key-id", "team-id"],
  boolean: ["send"],
});

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const user = (args.user ?? "").toLowerCase();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(user)) {
  fail("--user needs the full user id (uuid)");
}
const title = (args.title ?? "").trim();
const body = (args.body ?? "").trim();
if (!title || !body) fail("--title and --body are both needed");

async function teamID(): Promise<string> {
  if (args["team-id"]) return args["team-id"];
  const env = await Deno.readTextFile("supabase/functions/.env").catch(() => "");
  const line = env.split("\n").find((l) => l.startsWith("LYNCIL_APNS_TEAM_ID="));
  const value = line?.split("=").slice(1).join("=").replace(/^"|"$/g, "").trim();
  return value || fail("No team id: pass --team-id");
}

async function devices(): Promise<Device[]> {
  const sql = `select device_token, environment, locale from lyncil.devices where user_id = '${user}'`;
  const out = await new Deno.Command("supabase", {
    args: ["db", "query", "--linked", "--output-format", "json", sql],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout);
  if (!out.success) fail(`Device lookup failed: ${new TextDecoder().decode(out.stderr)}`);
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : parsed.rows) as Device[];
}

const found = await devices();
if (found.length === 0) fail("This user has no registered device (notifications not allowed).");

console.log(`User   ${user}`);
for (const device of found) {
  console.log(`Device ${device.environment}, locale ${device.locale}, token ${device.device_token.slice(0, 8)}…`);
}
console.log(`Title  ${title}  (${title.length} chars)`);
console.log(`Body   ${body}  (${body.length} chars)`);

if (!args.send) {
  console.log("\nNot sent. Add --send to send it.");
  Deno.exit(0);
}

const keyFile = args["key-file"] ?? fail("--key-file (the production .p8) is needed to send");
const keyID = args["key-id"] ?? fail("--key-id is needed to send");
Deno.env.set("LYNCIL_APNS_TEAM_ID", await teamID());
Deno.env.set("LYNCIL_APNS_KEY_ID", keyID);
Deno.env.set("LYNCIL_APNS_PRIVATE_KEY", await Deno.readTextFile(keyFile));

const apns = makeAPNs({ topic: "com.vaitsikhouskaya.ala.lyncil", secretPrefix: "LYNCIL" });
for (const device of found) {
  // An id the app doesn't route: a tap just opens the app, and Amplitude's
  // session_started.push_id still tells these sessions apart.
  const result = await apns.push(device, { title, body }, { push_id: "support_message" });
  console.log(`${device.environment} ${device.device_token.slice(0, 8)}…: ${result}`);
}
