import { createHash } from "node:crypto";
import type { CompletionRule } from "./repository-settings.ts";

export type MainWorkflow = {
  id: number;
  run_attempt: number;
  name: string;
  html_url: string;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
};
export type MainWorkflows = {
  runs: MainWorkflow[];
  failureArtifact?: string;
  evidenceError?: string;
};
export function parseMainWorkflows(
  pages: unknown,
  repository: string,
  commit: string,
): MainWorkflow[] {
  if (!Array.isArray(pages)) throw new Error("Invalid workflow response.");
  const runs: MainWorkflow[] = [];
  for (const page of pages) {
    if (!Array.isArray(page?.workflow_runs))
      throw new Error("Invalid workflow page.");
    for (const run of page.workflow_runs as MainWorkflow[]) {
      if (
        !Number.isSafeInteger(run.id) ||
        run.id < 1 ||
        !Number.isSafeInteger(run.run_attempt) ||
        run.run_attempt < 1 ||
        typeof run.name !== "string" ||
        !run.name ||
        run.html_url !==
          `https://github.com/${repository}/actions/runs/${run.id}` ||
        run.head_sha !== commit ||
        run.head_branch !== "main" ||
        run.event !== "push" ||
        typeof run.status !== "string" ||
        (run.conclusion !== null && typeof run.conclusion !== "string") ||
        (run.status === "completed" && !run.conclusion)
      )
        throw new Error(
          "Workflow identity or completion evidence did not match the main merge commit.",
        );
      const {
        id,
        run_attempt,
        name,
        html_url,
        head_sha,
        head_branch,
        event,
        status,
        conclusion,
      } = run;
      runs.push({
        id,
        run_attempt,
        name,
        html_url,
        head_sha,
        head_branch,
        event,
        status,
        conclusion,
      });
    }
  }
  return runs;
}
export function failedMainWorkflows(main: MainWorkflows) {
  return main.runs.filter(
    (r) => r.status === "completed" && r.conclusion !== "success",
  );
}
export function mainWorkflowStatus(main: MainWorkflows) {
  if (!main.runs.length) return "awaiting_main";
  if (failedMainWorkflows(main).length) return "main_failed";
  if (main.runs.some((r) => r.status !== "completed")) return "main_running";
  return "done";
}
export function mergedCompletionStatus(
  rule: CompletionRule,
  base: string,
  main?: MainWorkflows,
) {
  if (base !== "main") return "awaiting_main";
  if (rule === "merge") return "done";
  return main ? mainWorkflowStatus(main) : "awaiting_main";
}
export function mainFailureKey(main: MainWorkflows) {
  const identities = failedMainWorkflows(main)
    .map((r) => `${r.id}:${r.run_attempt}`)
    .sort();
  return identities.length
    ? createHash("sha256").update(JSON.stringify(identities)).digest("hex")
    : null;
}
