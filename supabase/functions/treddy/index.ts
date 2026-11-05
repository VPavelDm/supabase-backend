// Treddy's slug in the shared project: every route lives under
//   https://<project>.supabase.co/functions/v1/treddy/<route>
// so this Supabase project can host several apps side by side. Deploys with
// JWT verification off (config.toml) — the app, Threads' OAuth redirect, and
// pg_cron all call it directly; each route carries its own auth.
//
// Secrets (app-prefixed so apps coexist; OPENAI_API_KEY works as a
// project-wide fallback):
//   TREDDY_OPENAI_API_KEY, TREDDY_APP_KEY (pre-link generate auth),
//   TREDDY_THREADS_APP_ID, TREDDY_THREADS_APP_SECRET,
//   TREDDY_APNS_TEAM_ID, TREDDY_APNS_KEY_ID + TREDDY_APNS_PRIVATE_KEY,
//   TREDDY_APNS_SANDBOX_KEY_ID + TREDDY_APNS_SANDBOX_PRIVATE_KEY,
//   TREDDY_MCP_PUBLIC_URL (the connector Worker's origin; unset = connector off)
//
// Autoposting lives in the `treddy` Postgres schema: the app registers via
// link (which also hands back what the server knows about a returning
// account), mirrors its drafts via sync, registers the phone for each of
// its accounts' pushes via device, pushes its settings via settings,
// removes everything via account, and pg_cron drives
// publish-due/refresh-tokens. voice-presets serves the ready-made voices the
// app offers for a new voice.
//
// MCP connector (Claude / ChatGPT suggest posts; the user approves them in
// the app): mcp (the server), oauth/* (its authorization server, reached
// through the workers/treddy-mcp Cloudflare Worker at TREDDY_MCP_PUBLIC_URL),
// mcp-pair/* and mcp-grants (the app confirms a login code and manages
// connected assistants).

import { router } from "../_shared/router.ts";
import { handleThreadsOAuth } from "./threads-oauth.ts";
import { handleLink } from "./link.ts";
import { handleSync } from "./sync.ts";
import { handleDevice } from "./device.ts";
import { handleSettings } from "./settings.ts";
import { handleDeleteAccount } from "./account.ts";
import { handleGenerate } from "./generate.ts";
import { handleVoicePresets } from "./voice-presets.ts";
import { handlePublishDue } from "./publish-due.ts";
import { handleRefreshTokens } from "./refresh-tokens.ts";
import { handleMCP } from "./mcp.ts";
import { handleAuthorizeStart, handleAuthorizeStatus, handleRegister, handleToken } from "./mcp-oauth.ts";
import { handleListGrants, handlePairApprove, handlePairLookup, handleRevokeGrant } from "./mcp-pair.ts";

Deno.serve(router("treddy", {
  "threads-oauth": { GET: handleThreadsOAuth },
  "link": { POST: handleLink },
  "sync": { POST: handleSync },
  "device": { POST: handleDevice },
  "settings": { POST: handleSettings },
  "account": { DELETE: handleDeleteAccount },
  "generate": { POST: handleGenerate },
  "voice-presets": { GET: handleVoicePresets },
  "publish-due": { POST: handlePublishDue },
  "refresh-tokens": { POST: handleRefreshTokens },
  "mcp": { POST: handleMCP },
  "oauth/register": { POST: handleRegister },
  "oauth/authorize-start": { POST: handleAuthorizeStart },
  "oauth/authorize-status": { POST: handleAuthorizeStatus },
  "oauth/token": { POST: handleToken },
  "mcp-pair/lookup": { POST: handlePairLookup },
  "mcp-pair/approve": { POST: handlePairApprove },
  "mcp-grants": { GET: handleListGrants, DELETE: handleRevokeGrant },
}));
