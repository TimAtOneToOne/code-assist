import type { MainWorkflows } from "./github-workflows.ts";
import type { WorkspaceInput } from "./workspace.ts";
import type { PlanDocument, PlanReview } from "./planning-types.ts";
export type CodingKind =
  "prepare" | "implement" | "validate" | "review" | "publish";
export type CodingRun = {
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
  repair: { baseCommit: string; workflows: MainWorkflows } | null;
  created_at: Date;
};
export type CodingStep = {
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
