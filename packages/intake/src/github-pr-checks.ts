import { createHash } from "node:crypto";
import { executeCoding } from "./coding-runtime.ts";
import type { CodingRun } from "./coding-types.ts";
import type { PullRequestState } from "./github.ts";

export type PrCheck = {
  id: number;
  kind: "check" | "status" | "workflow";
  attempt?: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string | null;
  completedAt: string | null;
};
export type PrChecks = {
  commit: string;
  checks: PrCheck[];
  failureArtifact?: string;
  error?: string;
};
const failed = new Set([
  "failure",
  "error",
  "timed_out",
  "action_required",
  "startup_failure",
]);
export function failedPrChecks(value: PrChecks) {
  return value.checks.filter(
    (c) => c.status === "completed" && failed.has(c.conclusion ?? ""),
  );
}
export function prFailureKey(value: PrChecks) {
  const ids = failedPrChecks(value)
    .map(
      (c) =>
        `${c.kind}:${c.id}:${c.attempt ?? 0}:${c.conclusion}:${c.completedAt}`,
    )
    .sort();
  return ids.length
    ? createHash("sha256")
        .update(JSON.stringify([value.commit, ids]))
        .digest("hex")
    : null;
}
function safeUrl(value: unknown): string | null {
  if (!value) return null;
  const url = new URL(String(value));
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Invalid PR check URL.");
  return url.href;
}
export function parsePrChecks(
  checkPages: unknown,
  statusPages: unknown,
  commit: string,
): PrChecks {
  if (
    !/^[a-f0-9]{40}$/.test(commit) ||
    !Array.isArray(checkPages) ||
    !Array.isArray(statusPages)
  )
    throw new Error("Invalid PR check response.");
  const checks: PrCheck[] = [];
  for (const page of checkPages) {
    if (!Array.isArray(page?.check_runs))
      throw new Error("Incomplete check-run response.");
    for (const check of page.check_runs) {
      if (
        check.head_sha !== commit ||
        !Number.isSafeInteger(check.id) ||
        check.id <= 0 ||
        typeof check.name !== "string" ||
        !check.name ||
        typeof check.status !== "string" ||
        (check.status === "completed" && typeof check.conclusion !== "string")
      )
        throw new Error(
          "Check run does not match the PR head or completion evidence.",
        );
      checks.push({
        id: check.id,
        kind: "check",
        name: check.name,
        status: check.status,
        conclusion: check.conclusion ?? null,
        url: safeUrl(check.html_url ?? check.details_url),
        completedAt: check.completed_at ?? null,
      });
    }
  }
  for (const page of statusPages) {
    if (page?.sha !== commit || !Array.isArray(page.statuses))
      throw new Error("Commit statuses do not match the PR head.");
    for (const status of page.statuses) {
      if (
        !Number.isSafeInteger(status.id) ||
        status.id <= 0 ||
        typeof status.context !== "string" ||
        !status.context ||
        !["pending", "success", "failure", "error"].includes(status.state)
      )
        throw new Error("Invalid commit status.");
      checks.push({
        id: status.id,
        kind: "status",
        name: status.context,
        status: status.state === "pending" ? "pending" : "completed",
        conclusion: status.state === "pending" ? null : status.state,
        url: safeUrl(status.target_url),
        completedAt: status.updated_at ?? null,
      });
    }
  }
  return { commit, checks };
}

export async function readPrChecks(
  run: CodingRun,
  pr: PullRequestState,
  signal: AbortSignal,
  log: Parameters<typeof executeCoding>[3],
  execute = executeCoding,
): Promise<PrChecks> {
  const commit = pr.headRefOid;
  if (!commit || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error("PR head is missing.");
  const repository = new URL(pr.url).pathname.split("/").slice(1, 3).join("/");
  const gh = (args: string[]) =>
    execute("/opt/homebrew/bin/gh", args, signal, log);
  const api = async (path: string, paginate = false) =>
    JSON.parse(
      await gh(["api", ...(paginate ? ["--paginate", "--slurp"] : []), path]),
    );
  const checkPages = await api(
    `repos/${repository}/commits/${commit}/check-runs?filter=latest&per_page=100`,
    true,
  );
  const statusPages = await api(
    `repos/${repository}/commits/${commit}/status?per_page=100`,
    true,
  );
  const result = parsePrChecks(checkPages, statusPages, commit);
  const workflowPages = await api(
    `repos/${repository}/actions/runs?head_sha=${commit}&branch=${encodeURIComponent(pr.headRefName ?? "")}&per_page=100`,
    true,
  );
  for (const page of workflowPages) {
    if (!Array.isArray(page.workflow_runs))
      throw new Error("Incomplete workflow response.");
    for (const workflow of page.workflow_runs) {
      if (
        workflow.head_sha !== commit ||
        workflow.head_branch !== pr.headRefName
      )
        throw new Error("Workflow does not match the PR head and branch.");
      if (!["push", "pull_request"].includes(workflow.event)) continue;
      if (
        !Number.isSafeInteger(workflow.id) ||
        !Number.isSafeInteger(workflow.run_attempt) ||
        workflow.html_url !==
          `https://github.com/${repository}/actions/runs/${workflow.id}`
      )
        throw new Error("Invalid PR workflow identity.");
      result.checks.push({
        id: workflow.id,
        kind: "workflow",
        attempt: workflow.run_attempt,
        name: workflow.name,
        status: workflow.status,
        conclusion: workflow.conclusion,
        url: workflow.html_url,
        completedAt: workflow.updated_at,
      });
    }
  }
  const workflowEvidence = async (id: string, observed?: PrCheck) => {
    const metadata = await api(`repos/${repository}/actions/runs/${id}`);
    if (
      metadata.head_sha !== commit ||
      metadata.head_branch !== pr.headRefName ||
      metadata.repository?.full_name !== repository ||
      !Number.isSafeInteger(metadata.run_attempt) ||
      (observed !== undefined &&
        (metadata.run_attempt !== observed.attempt ||
          metadata.status !== observed.status ||
          metadata.conclusion !== observed.conclusion))
    )
      throw new Error(
        "Workflow logs do not match the PR head, branch and attempt.",
      );
    const jobs = await api(
      `repos/${repository}/actions/runs/${id}/attempts/${metadata.run_attempt}/jobs?per_page=100`,
      true,
    );
    if (!jobs.every((page: { jobs?: unknown[] }) => Array.isArray(page.jobs)))
      throw new Error("Incomplete workflow job response.");
    const hasLogs = jobs.some((page: { jobs: { conclusion: string }[] }) =>
      page.jobs.some((job) =>
        ["failure", "timed_out"].includes(job.conclusion),
      ),
    );
    const output = hasLogs
      ? await gh([
          "run",
          "view",
          id,
          "--repo",
          repository,
          "--attempt",
          String(metadata.run_attempt),
          "--log-failed",
        ])
      : "No failed job logs; inspect workflow metadata, check output and annotations.";
    return { workflow: metadata, jobs, output };
  };
  if (!failedPrChecks(result).length) return result;
  try {
    const evidence: unknown[] = [];
    for (const check of failedPrChecks(result)) {
      if (check.kind === "workflow") {
        evidence.push({
          check,
          ...(await workflowEvidence(String(check.id), check)),
        });
        continue;
      }
      if (check.kind === "status") {
        evidence.push({
          check,
          details: statusPages
            .flatMap((p: { statuses: { id: number }[] }) => p.statuses)
            .find((s: { id: number }) => s.id === check.id),
        });
        continue;
      }
      const details = await api(`repos/${repository}/check-runs/${check.id}`);
      if (
        details.head_sha !== commit ||
        details.id !== check.id ||
        details.conclusion !== check.conclusion ||
        details.completed_at !== check.completedAt
      )
        throw new Error("The failed check changed during evidence collection.");
      const annotations = await api(
        `repos/${repository}/check-runs/${check.id}/annotations?per_page=100`,
        true,
      );
      const actionUrl = details.details_url
        ? new URL(details.details_url)
        : null;
      const action =
        actionUrl?.origin === "https://github.com" &&
        actionUrl.pathname.startsWith(`/${repository}/actions/runs/`)
          ? actionUrl.pathname.match(/\/actions\/runs\/(\d+)(?:\/|$)/)?.[1]
          : undefined;
      let workflow: unknown;
      let output: string | undefined;
      if (action && details.app?.slug === "github-actions") {
        // Workflow-level evidence owns its complete job logs; this entry retains check annotations.
        if (
          !failedPrChecks(result).some(
            (c) => c.kind === "workflow" && String(c.id) === action,
          )
        ) {
          const evidence = await workflowEvidence(action);
          workflow = evidence.workflow;
          output = evidence.output;
        }
      }
      evidence.push({ check, details, annotations, workflow, output });
    }
    result.failureArtifact = log.payload(
      "github.pr_failure",
      "Open PR check failure evidence",
      { repository, prUrl: pr.url, commit, evidence },
      "error",
    ).artifact_id;
  } catch (error) {
    signal.throwIfAborted();
    result.error =
      "PR checks failed, but complete diagnostics could not be collected. Inspect GitHub logs for access, missing logs, or a changed check; repair waits for usable evidence.";
    log.payload(
      "github.pr_evidence_failed",
      result.error,
      { error, prUrl: pr.url, commit },
      "error",
    );
  }
  return result;
}
