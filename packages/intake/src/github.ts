import { readPrChecks, type PrChecks } from "./github-pr-checks.ts";
import { queuePrRepair } from "./coding-pr-repair.ts";
import { repositories } from "./coding-repositories.ts";
import { recordRepositoryObservation } from "./github-repositories.ts";
import {
  failedMainWorkflows,
  mainFailureKey,
  mainWorkflowStatus,
  parseMainWorkflows,
  type MainWorkflows,
} from "./github-workflows.ts";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import {
  codingTransaction,
  CodingConflict,
  codingRun,
  queueMainRepair,
  type CodingRun,
} from "./coding.ts";
import { executeCoding } from "./coding-runtime.ts";
import { recordIntakeEvent } from "./intake-events.ts";

export const githubQueue = "github-pr-refresh";
type RefreshRequest = { runId?: string };
export type PullRequestState = {
  headRefOid?: string;
  headRefName?: string;
  isCrossRepository?: boolean;
  body?: string;
  url: string;
  baseRefName: string;
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
    typeof pr.baseRefName !== "string" ||
    !pr.baseRefName ||
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
  observation:
    | { pr: PullRequestState; main?: MainWorkflows; checks?: PrChecks }
    | { error: string },
) {
  if ("pr" in observation) {
    parsePullRequest(observation.pr, run.pr_url!);
    if (
      observation.checks &&
      (observation.pr.state !== "OPEN" ||
        observation.checks.commit !== observation.pr.headRefOid)
    )
      throw new Error("PR checks require the observed open PR head.");
    if (observation.main) {
      if (
        observation.pr.state !== "MERGED" ||
        observation.pr.baseRefName !== "main"
      )
        throw new Error("Main workflows require a merge into main.");
      parseMainWorkflows(
        [{ workflow_runs: observation.main.runs }],
        new URL(run.pr_url!).pathname.split("/").slice(1, 3).join("/"),
        observation.pr.mergeCommit!.oid,
      );
    }
  }
  return codingTransaction(boss, async (db) => {
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
    const { rows: completed } = await db.executeSql(
      "SELECT id FROM code_assist.intake_event WHERE issue_id=$1 AND type='issue_completed_by_owner' LIMIT 1",
      [run.issue_id],
    );
    if (completed.length) return false;
    const { rows } = await db.executeSql(
      "SELECT * FROM code_assist.coding_run WHERE id=$1 FOR UPDATE",
      [run.id],
    );
    const current = rows[0] as CodingRun | undefined;
    // A PR observation fetched before a revision must not replace its active coding state.
    if (
      current &&
      (current.current_step_id !== run.current_step_id ||
        ![
          "pr_open",
          "pr_closed",
          "awaiting_main",
          "main_running",
          "main_failed",
          "done",
        ].includes(current.status))
    )
      return false;
    if (current?.repositories)
      return recordRepositoryObservation(
        boss,
        db,
        current,
        run,
        checkedAt,
        observation,
      );
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
    if (current.merged_at && pr.state !== "MERGED") return false;
    const status =
      pr.state === "MERGED"
        ? observation.main
          ? mainWorkflowStatus(observation.main)
          : "awaiting_main"
        : pr.state === "CLOSED"
          ? "pr_closed"
          : "pr_open";
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status=$2,github_checked_at=$3,github_error=$8,merged_at=$4,merge_commit=$5,pr_closed_at=$6,main_workflows=$7 WHERE id=$1",
      [
        run.id,
        status,
        checkedAt,
        pr.state === "MERGED" ? pr.mergedAt : null,
        pr.state === "MERGED" ? pr.mergeCommit!.oid : null,
        pr.state === "OPEN" ? null : pr.closedAt,
        observation.main ? JSON.stringify(observation.main) : null,
        observation.main?.evidenceError ??
          (pr.state === "MERGED" && pr.baseRefName !== "main"
            ? `This PR merged into ${pr.baseRefName}, not main. A main merge and successful main workflows are required for Done.`
            : null),
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
            : status === "awaiting_main" || status === "main_running"
              ? "coding_main_waiting"
              : status === "pr_closed"
                ? "coding_pr_closed"
                : "coding_pr_reopened",
        {
          codingId: run.id,
          prUrl: pr.url,
          mergeCommit: pr.mergeCommit?.oid ?? null,
          mergedAt: pr.mergedAt,
          closedAt: pr.closedAt,
          mainWorkflows: observation.main ?? null,
        },
        ["done", "pr_closed", "main_failed"].includes(status),
      );
    // A rerun or recovery invalidates unpublished repairs of the previous failure.
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status='superseded' WHERE parent_run_id=$1 AND pr_url IS NULL AND status<>'superseded' AND ($2::text IS NULL OR repair_key<>$2)",
      [run.id, observation.main ? mainFailureKey(observation.main) : null],
    );
    if (observation.checks) {
      const error = await queuePrRepair(
        boss,
        db,
        await codingRun(db, run.id),
        run,
        pr,
        observation.checks,
      );
      await db.executeSql(
        "UPDATE code_assist.coding_run SET pr_checks=$2,github_error=$3 WHERE id=$1",
        [run.id, JSON.stringify(observation.checks), error],
      );
      if (error && error !== current.github_error)
        await recordIntakeEvent(
          boss,
          db,
          run.issue_id,
          "coding_pr_checks_blocked",
          { codingId: run.id, prUrl: pr.url, reason: error },
          true,
        );
    }
    await queueMainRepair(boss, db, await codingRun(db, run.id));
    return true;
  });
}

type Reader = (
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
) => Promise<PullRequestState>;
export const readGitHub: Reader = async (run, signal, log) => {
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
          "url,baseRefName,state,mergedAt,mergeCommit,closedAt,headRefOid,headRefName,isCrossRepository,body",
        ],
        signal,
        log,
      ),
    ),
    url,
  );
};

type MainReader = (
  run: CodingRun,
  pr: PullRequestState,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
) => Promise<MainWorkflows>;
const readMain: MainReader = async (run, pr, signal, log) => {
  const repository = new URL(pr.url).pathname.split("/").slice(1, 3).join("/");
  const commit = pr.mergeCommit!.oid;
  const gh = (args: string[]) =>
    executeCoding("/opt/homebrew/bin/gh", args, signal, log);
  const runs = parseMainWorkflows(
    JSON.parse(
      await gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/actions/runs?head_sha=${commit}&branch=main&event=push&per_page=100`,
      ]),
    ),
    repository,
    commit,
  );
  const main: MainWorkflows = { runs };
  const failed = failedMainWorkflows(main);
  if (failed.length) {
    if (
      run.main_workflows?.failureArtifact &&
      mainFailureKey(run.main_workflows) === mainFailureKey(main)
    ) {
      main.failureArtifact = run.main_workflows.failureArtifact;
    } else {
      try {
        const evidence = [];
        for (const workflow of failed) {
          const jobs = JSON.parse(
            await gh([
              "api",
              "--paginate",
              "--slurp",
              `repos/${repository}/actions/runs/${workflow.id}/attempts/${workflow.run_attempt}/jobs?per_page=100`,
            ]),
          );
          // Cancelled/skipped runs can have no failed-job logs. Job conclusions still explain the state.
          const hasFailedJobs = jobs.some(
            (page: { jobs: { conclusion: string }[] }) =>
              page.jobs.some((job) =>
                ["failure", "timed_out"].includes(job.conclusion),
              ),
          );
          const output = hasFailedJobs
            ? await gh([
                "run",
                "view",
                String(workflow.id),
                "--repo",
                repository,
                "--attempt",
                String(workflow.run_attempt),
                "--log-failed",
              ])
            : "No failed job logs; inspect job conclusions.";
          evidence.push({ workflow, jobs, output });
        }
        main.failureArtifact = log.payload(
          "github.main_failure",
          "Main workflow failure evidence",
          { repository, commit, evidence },
          "error",
        ).artifact_id;
      } catch {
        signal.throwIfAborted();
        main.evidenceError =
          "Main workflow failed, but its diagnostic logs could not be collected. Repair waits for failure evidence; the next GitHub check will try to read it again.";
        log.event("error", "github.evidence_failed", main.evidenceError, {
          coding_id: run.id,
        });
      }
    }
  }
  return main;
};

export async function refreshGitHub(
  boss: PgBoss,
  request: RefreshRequest,
  signal: AbortSignal,
  jobId: string,
  read: Reader = readGitHub,
  readWorkflows: MainReader = readMain,
  readChecks: typeof readPrChecks = readPrChecks,
) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      request.runId
        ? "SELECT * FROM code_assist.coding_run c WHERE id=$1 AND pr_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM code_assist.intake_event e WHERE e.issue_id=c.issue_id AND e.type='issue_completed_by_owner')"
        : "SELECT * FROM code_assist.coding_run c WHERE pr_url IS NOT NULL AND status<>'done' AND NOT EXISTS (SELECT 1 FROM code_assist.intake_event e WHERE e.issue_id=c.issue_id AND e.type='issue_completed_by_owner') ORDER BY created_at,id",
      request.runId ? [request.runId] : [],
    );
  let failures = 0;
  for (const parent of rows as CodingRun[]) {
    if (
      ![
        "pr_open",
        "pr_closed",
        "awaiting_main",
        "main_running",
        "main_failed",
        "done",
      ].includes(parent.status)
    )
      continue;
    for (const [index, state] of repositories(parent).entries()) {
      if (!state.pr_url) continue;
      const run: CodingRun = {
        ...parent,
        ...state,
        github_checked_at: state.github_checked_at
          ? new Date(state.github_checked_at)
          : null,
        merged_at: state.merged_at ? new Date(state.merged_at) : null,
        pr_closed_at: state.pr_closed_at ? new Date(state.pr_closed_at) : null,
        main_workflows: state.main_workflows ?? null,
        github_error: state.github_error ?? null,
        merge_commit: state.merge_commit ?? null,
        repository_index: index,
      };
      signal.throwIfAborted();
      const log = createLogger("github").child({
        job_id: jobId,
        attempt_id: jobId,
        ticket_id: run.identifier,
      });
      const checkedAt = new Date();
      let pr: PullRequestState;
      let main: MainWorkflows | undefined;
      let checks: PrChecks | undefined;
      try {
        pr = await read(run, signal, log);
        if (pr.state === "MERGED" && pr.baseRefName === "main")
          main = await readWorkflows(run, pr, signal, log);
        if (pr.state === "OPEN" && pr.headRefOid) {
          checks = await readChecks(run, pr, signal, log);
          const after = await read(run, signal, log);
          if (
            after.state !== "OPEN" ||
            after.headRefOid !== pr.headRefOid ||
            after.headRefName !== pr.headRefName ||
            after.body !== pr.body ||
            after.isCrossRepository !== pr.isCrossRepository ||
            after.baseRefName !== pr.baseRefName
          )
            continue;
        }
      } catch {
        signal.throwIfAborted();
        const error =
          "GitHub refresh failed. The previous PR/workflow state is preserved. Check the GitHub logs and retry.";
        await recordGitHubObservation(boss, run, checkedAt, { error });
        log.event("error", "github.refresh_failed", error, {
          coding_id: run.id,
        });
        failures++;
        continue;
      }
      await recordGitHubObservation(boss, run, checkedAt, { pr, main, checks });
      log.event("info", "github.refreshed", "Pull request state checked", {
        coding_id: run.id,
        pr_state: pr.state,
        pr_url: pr.url,
        main_status: main ? mainWorkflowStatus(main) : null,
        workflow_count: main?.runs.length ?? 0,
      });
    }
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
