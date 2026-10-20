import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { codingTransaction, CodingConflict, type CodingRun } from "./coding.ts";
import { executeCoding } from "./coding-runtime.ts";
import { recordIntakeEvent } from "./intake-events.ts";

export const githubQueue = "github-pr-refresh";
type RefreshRequest = { runId?: string };
export type PullRequestState = {
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: string | null;
  closedAt: string | null;
  mergeCommit: { oid: string } | null;
};
const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export function parsePullRequest(
  value: unknown,
  expectedUrl: string,
): PullRequestState {
  const pr = value as PullRequestState;
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(
      expectedUrl,
    ) ||
    !pr ||
    pr.url !== expectedUrl ||
    !["OPEN", "CLOSED", "MERGED"].includes(pr.state) ||
    (pr.state === "MERGED" &&
      (!validDate(pr.mergedAt) ||
        !/^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid ?? ""))) ||
    (pr.state === "CLOSED" && !validDate(pr.closedAt))
  )
    throw new Error("GitHub returned an invalid pull request state.");
  return pr;
}

export async function initializeGitHub(boss: PgBoss) {
  await boss.createQueue(githubQueue, { retryLimit: 0 });
}

export async function requestGitHubRefresh(
  boss: PgBoss,
  issueId?: string,
  runId?: string,
) {
  if (runId || issueId) {
    const { rows } = await boss
      .getDb()
      .executeSql(
        "SELECT id FROM code_assist.coding_run WHERE id=$1 AND issue_id=$2 AND pr_url IS NOT NULL",
        [runId, issueId],
      );
    if (!rows.length)
      throw new CodingConflict(
        "This ticket has no matching published pull request.",
      );
  }
  const id = await boss.send(githubQueue, runId ? { runId } : {});
  if (!id) throw new Error("Could not queue the GitHub refresh.");
  return id;
}

export async function recordGitHubObservation(
  boss: PgBoss,
  run: CodingRun,
  checkedAt: Date,
  observation: { pr: PullRequestState } | { error: string },
) {
  if ("pr" in observation) parsePullRequest(observation.pr, run.pr_url!);
  return codingTransaction(boss, async (db) => {
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
    const { rows } = await db.executeSql(
      "SELECT * FROM code_assist.coding_run WHERE id=$1 FOR UPDATE",
      [run.id],
    );
    const current = rows[0] as CodingRun | undefined;
    if (
      !current ||
      current.pr_url !== run.pr_url ||
      (current.github_checked_at &&
        new Date(current.github_checked_at) >= checkedAt)
    )
      return false;
    if ("error" in observation) {
      await db.executeSql(
        "UPDATE code_assist.coding_run SET github_checked_at=$2,github_error=$3 WHERE id=$1",
        [run.id, checkedAt, observation.error],
      );
      return true;
    }
    const pr = observation.pr;
    // A merged PR cannot be reopened; delayed observations must not undo completion.
    if (current.status === "done" && pr.state !== "MERGED") return false;
    const status =
      pr.state === "MERGED"
        ? "done"
        : pr.state === "CLOSED"
          ? "pr_closed"
          : "pr_open";
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status=$2,github_checked_at=$3,github_error=NULL,merged_at=$4,merge_commit=$5,pr_closed_at=$6 WHERE id=$1",
      [
        run.id,
        status,
        checkedAt,
        pr.state === "MERGED" ? pr.mergedAt : null,
        pr.state === "MERGED" ? pr.mergeCommit!.oid : null,
        pr.state === "OPEN" ? null : pr.closedAt,
      ],
    );
    if (status !== current.status)
      await recordIntakeEvent(
        boss,
        db,
        run.issue_id,
        status === "done"
          ? "coding_done"
          : status === "pr_closed"
            ? "coding_pr_closed"
            : "coding_pr_reopened",
        {
          codingId: run.id,
          prUrl: pr.url,
          mergeCommit: pr.mergeCommit?.oid ?? null,
          mergedAt: pr.mergedAt,
          closedAt: pr.closedAt,
        },
        status !== "pr_open",
      );
    return true;
  });
}

type Reader = (
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
) => Promise<PullRequestState>;
const readGitHub: Reader = async (run, signal, log) => {
  const url = run.pr_url!;
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(
      url,
    )
  )
    throw new Error("Invalid GitHub PR URL.");
  return parsePullRequest(
    JSON.parse(
      await executeCoding(
        "/opt/homebrew/bin/gh",
        [
          "pr",
          "view",
          url,
          "--json",
          "url,state,mergedAt,mergeCommit,closedAt",
        ],
        signal,
        log,
      ),
    ),
    url,
  );
};

export async function refreshGitHub(
  boss: PgBoss,
  request: RefreshRequest,
  signal: AbortSignal,
  jobId: string,
  read: Reader = readGitHub,
) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      request.runId
        ? "SELECT * FROM code_assist.coding_run WHERE id=$1 AND pr_url IS NOT NULL"
        : "SELECT * FROM code_assist.coding_run WHERE pr_url IS NOT NULL AND status<>'done' ORDER BY created_at,id",
      request.runId ? [request.runId] : [],
    );
  let failures = 0;
  for (const run of rows as CodingRun[]) {
    signal.throwIfAborted();
    const log = createLogger("github").child({
      job_id: jobId,
      attempt_id: jobId,
      ticket_id: run.identifier,
    });
    const checkedAt = new Date();
    let pr: PullRequestState;
    try {
      pr = await read(run, signal, log);
    } catch {
      signal.throwIfAborted();
      const error =
        "GitHub refresh failed. The previous PR state is preserved. Check the GitHub logs and retry.";
      await recordGitHubObservation(boss, run, checkedAt, { error });
      log.event("error", "github.refresh_failed", error, { coding_id: run.id });
      failures++;
      continue;
    }
    await recordGitHubObservation(boss, run, checkedAt, { pr });
    log.event("info", "github.refreshed", "Pull request state checked", {
      coding_id: run.id,
      pr_state: pr.state,
      pr_url: pr.url,
    });
  }
  if (failures)
    throw new Error(`${failures} GitHub pull request check(s) failed.`);
}

export async function registerGitHubWorker(
  boss: PgBoss,
  shutdown: AbortSignal,
) {
  await boss.schedule(githubQueue, "*/5 * * * *", {});
  await boss.work<RefreshRequest>(githubQueue, async ([job]) => {
    await refreshGitHub(
      boss,
      job.data,
      AbortSignal.any([shutdown, job.signal]),
      job.id,
    );
  });
}
