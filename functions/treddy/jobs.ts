// Every cron run leaves a row in treddy.job_runs, so autoposting health is
// one query away instead of a dig through function logs.

import { sql } from "./db.ts";

export async function recordJobRun(
  job: string,
  startedAt: Date,
  okCount: number,
  failCount: number,
  error?: string,
): Promise<void> {
  try {
    await sql`
      insert into treddy.job_runs (job, started_at, ok_count, fail_count, error)
      values (${job}, ${startedAt}, ${okCount}, ${failCount}, ${error ?? null})`;
  } catch (logError) {
    // Never let bookkeeping break the job itself.
    console.error("job run logging failed", job, logError);
  }
}
