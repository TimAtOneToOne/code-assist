import type { Db, PgBoss } from "pg-boss";
import type { CodingRun } from "./coding-types.ts";
import type { PullRequestState } from "./github.ts";
import {
  aggregateStatus,
  repositories,
  repositoryIndex,
} from "./coding-repositories.ts";
import {
  mainWorkflowStatus,
  mainFailureKey,
  type MainWorkflows,
} from "./github-workflows.ts";
import { codingRun, queueMainRepair } from "./coding.ts";
import { recordIntakeEvent } from "./intake-events.ts";

export async function recordRepositoryObservation(
  boss: PgBoss,
  db: Db,
  current: CodingRun,
  run: CodingRun,
  checkedAt: Date,
  observation:
    { pr: PullRequestState; main?: MainWorkflows } | { error: string },
) {
  const states = repositories(current).map((r) => ({ ...r }));
  const state = states[repositoryIndex(run)];
  if (
    state.pr_url !== run.pr_url ||
    (state.github_checked_at && new Date(state.github_checked_at) >= checkedAt)
  )
    return false;
  if ("error" in observation) {
    state.github_checked_at = checkedAt;
    state.github_error = observation.error;
  } else {
    const { pr, main } = observation;
    if (state.merged_at && pr.state !== "MERGED") return false;
    state.status =
      pr.state === "MERGED"
        ? main
          ? mainWorkflowStatus(main)
          : "awaiting_main"
        : pr.state === "CLOSED"
          ? "pr_closed"
          : "pr_open";
    state.github_checked_at = checkedAt;
    state.github_error =
      main?.evidenceError ??
      (pr.state === "MERGED" && pr.baseRefName !== "main"
        ? "Done requires a merge into main and successful main workflows."
        : null);
    state.merged_at = pr.state === "MERGED" ? pr.mergedAt : null;
    state.merge_commit = pr.state === "MERGED" ? pr.mergeCommit!.oid : null;
    state.pr_closed_at = pr.state === "OPEN" ? null : pr.closedAt;
    state.main_workflows = main ?? null;
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status='superseded' WHERE parent_run_id=$1 AND pr_url IS NULL AND status<>'superseded' AND repair->>'repository'=$2 AND ($3::text IS NULL OR repair_key<>$3)",
      [run.id, state.name, main ? mainFailureKey(main) : null],
    );
  }
  const status = aggregateStatus(states);
  await db.executeSql(
    "UPDATE code_assist.coding_run SET repositories=$2,status=$3,github_checked_at=$4,github_error=$5 WHERE id=$1",
    [
      run.id,
      JSON.stringify(states),
      status,
      checkedAt,
      states
        .map((r) => (r.github_error ? r.name + ": " + r.github_error : ""))
        .filter(Boolean)
        .join("\n") || null,
    ],
  );
  if (status !== current.status)
    await recordIntakeEvent(
      boss,
      db,
      run.issue_id,
      status === "done"
        ? "coding_done"
        : status === "main_failed"
          ? "coding_main_failed"
          : status === "pr_closed"
            ? "coding_pr_closed"
            : "coding_main_waiting",
      { codingId: run.id, repository: state.name, prUrl: state.pr_url },
      ["done", "main_failed", "pr_closed"].includes(status),
    );
  await queueMainRepair(boss, db, await codingRun(db, run.id));
  return true;
}
