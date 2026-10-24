import type { PrChecks } from "./github-pr-checks.ts";
import type { MainWorkflows } from "./github-workflows.ts";
import type { WorkspaceInput } from "./workspace.ts";
import type { PlanDocument, PlanReview } from "./planning-types.ts";
export type CodingKind =
  | "prepare"
  | "implement"
  | "checkpoint"
  | "collect"
  | "validate"
  | "review"
  | "publish";
export type CodingRepository = {
  pr_checks?: PrChecks | null;
  name: string;
  commit: string | null;
  baseCommit?: string;
  pr_url: string | null;
  status: CodingRun["status"];
  github_checked_at?: Date | string | null;
  github_error?: string | null;
  merged_at?: Date | string | null;
  merge_commit?: string | null;
  pr_closed_at?: Date | string | null;
  main_workflows?: MainWorkflows | null;
};
export type CodingRun = {
  pr_checks?: PrChecks | null;
  direction_responses?: CodingDirectionResponse[];
  change_requests?: CodingChangeRequest[];
  workspace_cleaned_at?: Date | null;
  workspace_cleanup_error?: string | null;
  repositories?: CodingRepository[] | null;
  repository_index?: number;
  id: string;
  issue_id: string;
  planning_id: string;
  version: number;
  input: WorkspaceInput;
  plan: PlanDocument;
  identifier: string;
  title: string;
  branch: string;
  status:
    | CodingKind
    | "failed"
    | "needs_direction"
    | "pr_open"
    | "pr_closed"
    | "awaiting_main"
    | "main_running"
    | "main_failed"
    | "done"
    | "superseded";
  current_step_id: string;
  workspace_id: string | null;
  commit: string | null;
  error: string | null;
  pr_url: string | null;
  github_checked_at: Date | null;
  github_error: string | null;
  merged_at: Date | null;
  merge_commit: string | null;
  pr_closed_at: Date | null;
  main_workflows: MainWorkflows | null;
  parent_run_id: string | null;
  repair_key: string | null;
  repair: {
    baseCommit: string;
    workflows: MainWorkflows;
    repository?: string;
  } | null;
  created_at: Date;
};
export type CodingDirectionResponse = {
  id: string;
  stepId: string;
  question: string;
  text: string;
  requestedBy: string;
  createdAt: string;
};
export type CodingChangeRequest = {
  kind?: "bring_in_main" | "pr_ci";
  prCi?: { repository: string; commit: string; key: string; artifact: string };
  id: string;
  text: string;
  requestedBy: string;
  createdAt: string;
  baseCommits: Record<string, string>;
  pullRequests: Record<string, string>;
};
export type CodingContinuation = {
  agentStepId: string;
  kind: "implement" | "review";
  result: Record<string, unknown>;
  browserCalls: string[];
};
export type CodingStep = {
  direction_response_id?: string | null;
  change_request_id?: string | null;
  job_retry_count?: number;
  continuation?: CodingContinuation | null;
  recovery_step_id?: string | null;
  repository_index?: number;
  input_commits?: Record<string, string | null> | null;
  id: string;
  run_id: string;
  job_id: string;
  kind: CodingKind;
  input_commit: string | null;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  worker_pid: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};
export type CodingDetail = CodingRun & { steps: CodingStep[] };
export const browserEvidenceRequiredMessage =
  "This agent attempt did not run the required browser checks. Saved code and evidence are preserved. Run Browser Checks to continue from this checkpoint.";
export function hasBrowserEvidence(paths: string[], completedTools: string[]) {
  return (
    paths.length > 0 &&
    completedTools.some((tool) =>
      [
        "browser_navigate",
        "browser_run_code",
        "browser_run_code_unsafe",
      ].includes(tool),
    )
  );
}
export function missingBrowserEvidence(run: CodingRun, step?: CodingStep) {
  const saved = step?.continuation;
  const snapshots = run.input.snapshots ?? [run.input.snapshot];
  const request = run.change_requests?.at(-1);
  const finalIndex = request
    ? snapshots.findLastIndex((s) => Object.hasOwn(request.baseCommits, s.name))
    : run.repair?.repository
      ? snapshots.findIndex(
          (snapshot) => snapshot.name === run.repair!.repository,
        )
      : snapshots.length - 1;
  return (
    step?.kind === "collect" &&
    step.error === browserEvidenceRequiredMessage &&
    saved?.kind === "implement" &&
    saved.result.disposition === "implemented" &&
    (run.repository_index ?? 0) === finalIndex &&
    !hasBrowserEvidence(
      Array.isArray(saved.result.browserEvidence)
        ? saved.result.browserEvidence
        : [],
      saved.browserCalls,
    )
  );
}
export type Implementation = {
  summary: string;
  disposition: "implemented" | "needs_direction";
  directionQuestion: string;
  browserEvidence: string[];
};
export const implementationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "disposition", "directionQuestion", "browserEvidence"],
  properties: {
    summary: { type: "string" },
    disposition: { type: "string", enum: ["implemented", "needs_direction"] },
    directionQuestion: { type: "string" },
    browserEvidence: { type: "array", items: { type: "string" } },
  },
};
export function parseImplementation(value: unknown): Implementation {
  const v = value as Implementation;
  if (
    !v ||
    typeof v.summary !== "string" ||
    !v.summary.trim() ||
    !["implemented", "needs_direction"].includes(v.disposition) ||
    typeof v.directionQuestion !== "string" ||
    !Array.isArray(v.browserEvidence) ||
    v.browserEvidence.some((x) => typeof x !== "string") ||
    (v.disposition === "needs_direction" && !v.directionQuestion.trim())
  )
    throw new Error("Invalid coding result.");
  return v;
}
export function codeReviewReady(review: PlanReview) {
  return (
    review.disposition === "ready" &&
    !review.findings.some((f) =>
      ["critical", "high", "medium"].includes(f.severity),
    )
  );
}
