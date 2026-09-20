// The autoposter. pg_cron calls this every minute (job `treddy-publish-due`);
// it claims due posts, publishes them to Threads, and notifies the account's
// devices about the outcome. Every run leaves a row in treddy.job_runs.

import { isCronCall, json, sql } from "./db.ts";
import { publishPost, ThreadsAPIError } from "./threads-api.ts";
import { notifyDevices } from "./notify.ts";
import { recordJobRun } from "./jobs.ts";

/// A row stuck in `publishing` means a previous run died mid-flight. The
/// post may or may not have reached Threads, and publishing is not
/// idempotent — surface it as failed instead of retrying blindly.
async function failInterruptedRuns(): Promise<void> {
  await sql`
    update treddy.posts
    set status = 'failed',
        error = 'Publishing was interrupted — check Threads before retrying.',
        updated_at = now()
    where status = 'publishing' and updated_at < now() - interval '10 minutes'`;
}

export async function handlePublishDue(req: Request): Promise<Response> {
  if (!await isCronCall(req)) return json({ error: "Unauthorized" }, 401);
  const startedAt = new Date();

  let published = 0;
  let failed = 0;
  try {
    await failInterruptedRuns();

    // Claiming flips the rows to `publishing` in one statement, so an
    // overlapping run (or a concurrent app sync) can't grab the same post.
    const due = await sql`
      update treddy.posts p
      set status = 'publishing', updated_at = now()
      from treddy.accounts a
      where p.threads_user_id = a.threads_user_id
        and not a.needs_reauth
        and p.id in (
          select id from treddy.posts
          where status = 'scheduled' and scheduled_at <= now()
          for update skip locked)
      returning p.id, p.text, p.threads_user_id, a.access_token`;

    for (const post of due) {
      try {
        const mediaID = await publishPost(post.access_token, post.text);
        await sql`
          update treddy.posts
          set status = 'published',
              published_media_id = ${mediaID},
              published_at = now(),
              error = null,
              updated_at = now()
          where id = ${post.id}`;
        published += 1;
        await notifyDevices(post.threads_user_id, "posted", post.text, {
          draftID: post.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The Graph code is the only thing that tells Meta's failures
        // apart; the stored error keeps just the sentence the user sees.
        const code = error instanceof ThreadsAPIError ? error.code : null;
        console.error("publish failed", post.id, code, message);
        await sql`
          update treddy.posts
          set status = 'failed', error = ${message}, updated_at = now()
          where id = ${post.id}`;
        if (error instanceof ThreadsAPIError && error.isAuthError) {
          await sql`
            update treddy.accounts
            set needs_reauth = true, updated_at = now()
            where threads_user_id = ${post.threads_user_id}`;
        }
        failed += 1;
        // The push carries the actual Threads error, so a failure is
        // diagnosable from the lock screen without digging through logs.
        await notifyDevices(post.threads_user_id, "failed", message, {
          draftID: post.id,
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordJobRun("publish-due", startedAt, published, failed, message);
    throw error;
  }

  // Only runs that did something are worth a row — this job fires every
  // minute and is usually a no-op.
  if (published > 0 || failed > 0) {
    await recordJobRun("publish-due", startedAt, published, failed);
  }
  return json({ published, failed });
}
