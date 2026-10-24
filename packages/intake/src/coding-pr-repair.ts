import type { Db, PgBoss } from "pg-boss";
import type { CodingRun } from "./coding-types.ts";
import type { PullRequestState } from "./github.ts";
import { prFailureKey, type PrChecks } from "./github-pr-checks.ts";
import { currentCoding, queueCodingChanges } from "./coding.ts";
import { repositories, repositoryIndex } from "./coding-repositories.ts";
import { ownsPublication } from "./publication-metadata.ts";

// Called in the observation transaction: observing a failure and queuing its revision are atomic.
export async function queuePrRepair(
  boss: PgBoss,
  db: Db,
  current: CodingRun,
  observed: CodingRun,
  pr: PullRequestState,
  checks: PrChecks,
) {
  const key = prFailureKey(checks);
  if (!key || pr.state !== "OPEN") return checks.error ?? null;
  const latest = await db.executeSql(
    "SELECT id FROM code_assist.coding_run WHERE planning_id=$1 AND version=$2 AND status<>'superseded' ORDER BY created_at DESC LIMIT 1",
    [current.planning_id, current.version],
  );
  if (latest.rows[0]?.id !== current.id) return null;
  const state = repositories(current)[repositoryIndex(observed)];
  if (
    checks.commit !== state.commit ||
    pr.headRefOid !== state.commit ||
    pr.headRefName !== current.branch ||
    pr.isCrossRepository !== false ||
    !ownsPublication(pr.body ?? "", current.id)
  )
    return "PR checks failed, but the PR head, branch, or publication ownership no longer matches the saved candidate. Reconcile the PR before requesting a repair; no code was changed.";
  if (checks.error || !checks.failureArtifact)
    return (
      checks.error ??
      "PR checks failed without diagnostic evidence. Repair waits for failure evidence."
    );
  if (!current.workspace_id || current.workspace_cleaned_at)
    return "PR checks failed, but the saved coding workspace is unavailable. Restore the workspace before requesting a repair.";
  if (!(await currentCoding(db, current)))
    return "PR checks failed, but this run no longer has current plan approval. Review the current ticket scope before repairing.";
  if (
    current.change_requests?.some(
      (r) => r.prCi?.key === key && r.prCi.repository === state.name,
    )
  )
    return "This exact PR-check failure already has a recorded repair request. Inspect its outcome; another observation will not repeat the same repair.";
  await queueCodingChanges(
    boss,
    db,
    current.issue_id,
    current.id,
    current.current_step_id,
    `Diagnose failing CI on the current ${state.name} PR (${pr.url}), head ${checks.commit}. Read the complete saved evidence in /work/evidence/pr-ci-failure.json. Fix only defects within the approved feature and this repository. Preserve the checks and approved behavior; do not bypass tests, alter organization policy, credentials, IAM, deployment controls, or unrelated scope. Environmental/transient failures with no justified code correction require needs_direction with a concrete diagnosis. Do not rerun GitHub workflows or deploy. Repeat required validation and browser acceptance; independent review must verify the correction before the controller updates this same PR.`,
    "github-check-monitor",
    "pr_ci",
    {
      repository: state.name,
      commit: checks.commit,
      key,
      artifact: checks.failureArtifact,
    },
  );
  return null;
}
