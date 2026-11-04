// The autoposter. pg_cron calls this every 5 minutes (job `treddy-publish-due`);
// it claims due posts, publishes them to Threads, and notifies the account's
// devices about the outcome. Posts the user posts themselves (`manual`) are
// never published here: at their time the devices get a "time to post" push
// instead, once. Every run leaves a row in treddy.job_runs.

import { isCronCall, json, sql } from "./db.ts";
import { publishPost, ThreadsAPIError } from "./threads-api.ts";
import { notifyDevices } from "./notify.ts";
import { recordJobRun } from "./jobs.ts";

/// A row stuck in `publishing` means a previous run died mid-flight. The
/// post being sent at that moment may or may not have reached Threads, and
/// publishing is not idempotent — surface it as failed instead of retrying
/// blindly. The chain's posts that were recorded as sent stay recorded.
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
  let reminded = 0;
  try {
    await failInterruptedRuns();

    // Marked before the push goes out, so an overlapping run can't remind
    // twice; a push that fails to send isn't retried.
    const reminders = await sql`
      update treddy.posts
      set reminded_at = now()
      where id in (
        select id from treddy.posts
        where status = 'scheduled' and manual and reminded_at is null and scheduled_at <= now()
        for update skip locked)
      returning id, text, threads_user_id`;
    // A reminder is the only signal a manual post gets, so one that reached
    // no device is recorded as a failure in job_runs.
    let unreached = 0;
    for (const post of reminders) {
      const delivered = await notifyDevices(post.threads_user_id, "reminder", post.text, {
        draftID: post.id,
      });
      if (delivered > 0) reminded += 1;
      else unreached += 1;
    }
    if (reminders.length > 0) {
      await recordJobRun("remind-due", startedAt, reminded, unreached);
    }

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
          where status = 'scheduled' and not manual and scheduled_at <= now()
          for update skip locked)
      returning p.id, p.text, p.follow_ups, p.part_media_ids, p.threads_user_id, a.access_token`;

    for (const post of due) {
      try {
        // A chain goes out post by post, each answering the one before.
        // One that stopped partway goes on after its last sent post, and
        // every post is recorded the moment it lands, so a failure further
        // on can't get it posted twice.
        const parts: string[] = [post.text, ...(post.follow_ups ?? [])];
        const sent: string[] = [...(post.part_media_ids ?? [])];
        for (const part of parts.slice(sent.length)) {
          const mediaID = await publishPost(post.access_token, part, sent.at(-1) ?? null);
          sent.push(mediaID);
          await sql`
            update treddy.posts
            set part_media_ids = ${sql.json(sent)},
                published_media_id = coalesce(published_media_id, ${sent[0]}),
                updated_at = now()
            where id = ${post.id}`;
        }
        await sql`
          update treddy.posts
          set status = 'published',
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
  return json({ published, failed, reminded });
}
