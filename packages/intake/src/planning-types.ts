import type { DiscoveryRun } from "./discovery.ts";

export type PlanDocument = {
  markdown: string;
  changeSummary: string;
  responses: { findingId: string; response: string }[];
};
export type PlanReview = {
  summary: string;
  disposition: "revise" | "ready" | "needs_direction";
  directionQuestion: string;
  findings: {
    id: string;
    severity: "critical" | "high" | "medium" | "low";
    title: string;
    detail: string;
    recommendation: string;
  }[];
};
export type PlanVersion = {
  run_id: string;
  number: number;
  hash: string;
  document: PlanDocument;
  created_at: Date;
  review: PlanReview | null;
};
export type PlanFeedback = { version: number; note: string; created_at: Date };
export type PlanningInput = {
  discovery: DiscoveryRun;
  versions: PlanVersion[];
  feedback: PlanFeedback[];
};
export type PlanningRun = {
  id: string;
  issue_id: string;
  discovery_id: string;
  input_hash: string;
  current_step_id: string | null;
  current_version: number;
  status:
    | "drafting"
    | "reviewing"
    | "revising"
    | "awaiting_approval"
    | "needs_direction"
    | "approved"
    | "failed"
    | "superseded";
  error: string | null;
  created_at: Date;
};
export type PlanningStep = {
  id: string;
  run_id: string;
  job_id: string;
  kind: "draft" | "review";
  version: number;
  input: PlanningInput;
  status: "queued" | "running" | "completed" | "failed" | "interrupted";
  worker_pid: number | null;
  session_id: string | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
};
export type PlanApproval = {
  version: number;
  plan_hash: string;
  input_hash: string;
  approver: string;
  accepted_medium_ids: string[];
  created_at: Date;
};
export type PlanningDetail = PlanningRun & {
  versions: PlanVersion[];
  feedback: PlanFeedback[];
  steps: Omit<PlanningStep, "input">[];
  approvals: PlanApproval[];
};
export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["markdown", "changeSummary", "responses"],
  properties: {
    markdown: { type: "string" },
    changeSummary: { type: "string" },
    responses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["findingId", "response"],
        properties: {
          findingId: { type: "string" },
          response: { type: "string" },
        },
      },
    },
  },
};
export const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "disposition", "directionQuestion", "findings"],
  properties: {
    summary: { type: "string" },
    disposition: {
      type: "string",
      enum: ["revise", "ready", "needs_direction"],
    },
    directionQuestion: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "severity", "title", "detail", "recommendation"],
        properties: {
          id: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low"],
          },
          title: { type: "string" },
          detail: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
  },
};
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function parsePlan(value: unknown): PlanDocument {
  const p = value as PlanDocument;
  if (
    !p ||
    !text(p.markdown) ||
    !text(p.changeSummary) ||
    !Array.isArray(p.responses) ||
    p.responses.some((r) => !text(r?.findingId) || !text(r?.response))
  )
    throw new Error("Codex returned an invalid plan.");
  return p;
}
export function parseReview(value: unknown): PlanReview {
  const r = value as PlanReview;
  if (
    !r ||
    !text(r.summary) ||
    !["revise", "ready", "needs_direction"].includes(r.disposition) ||
    typeof r.directionQuestion !== "string" ||
    (r.disposition === "needs_direction" && !text(r.directionQuestion)) ||
    !Array.isArray(r.findings) ||
    r.findings.some(
      (f) =>
        ![f?.id, f?.title, f?.detail, f?.recommendation].every(text) ||
        !["critical", "high", "medium", "low"].includes(f.severity),
    ) ||
    new Set(r.findings.map((f) => f.id)).size !== r.findings.length
  )
    throw new Error("Claude returned an invalid review.");
  return r;
}
export function blockingFindings(review: PlanReview) {
  return review.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
}
