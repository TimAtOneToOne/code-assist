import { isDeepStrictEqual } from "node:util";
import {
  parseAcceptanceResult,
  type AcceptanceReport,
  type ToolEvidence,
} from "./acceptance-types.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import { commitSet } from "./coding-repositories.ts";

export function assessAcceptance(
  run: CodingRun,
  attemptId: string,
  value: unknown,
  tools: ToolEvidence[],
): AcceptanceReport {
  let result;
  try {
    result = parseAcceptanceResult(value);
  } catch {
    return {
      summary:
        "The verifier returned an invalid acceptance report. Run the scenarios again with complete results.",
      scenarios: [],
      attemptId,
      planHash: run.input.planHash,
      commits: commitSet(run),
      tools,
      issues: ["Invalid acceptance result; no scenarios are accepted."],
      passed: false,
    };
  }
  const expected = run.plan.acceptanceScenarios ?? [];
  const issues: string[] = [];
  for (const scenario of expected) {
    const outcome = result.scenarios.find((s) => s.id === scenario.id);
    if (!outcome) {
      issues.push(`${scenario.id}: missing result`);
      continue;
    }
    if (outcome.status !== "passed")
      issues.push(`${scenario.id}: ${outcome.status}`);
    const observed = outcome.toolCallIds.map((id) =>
      tools.find((t) => t.id === id),
    );
    if (!observed.length || observed.some((t) => !t))
      issues.push(`${scenario.id}: missing or unknown tool evidence`);
    if (outcome.status === "passed" && observed.some((t) => t && !t.succeeded))
      issues.push(`${scenario.id}: cited tool execution failed`);
    if (
      outcome.status === "passed" &&
      !observed.some(
        (t) =>
          t?.succeeded &&
          ((t.kind === scenario.method &&
            (scenario.method !== "browser" ||
              [
                "browser_snapshot",
                "browser_take_screenshot",
                "browser_run_code",
                "browser_run_code_unsafe",
                "browser_evaluate",
              ].includes(t.name.replace("mcp__playwright__", "")))) ||
            (scenario.method === "inspection" && t.kind === "command")),
      )
    )
      issues.push(`${scenario.id}: no successful ${scenario.method} evidence`);
    if (
      outcome.artifacts.some(
        (path) =>
          !path.startsWith(`/work/evidence/${attemptId}/`) ||
          path.split("/").includes(".."),
      )
    )
      issues.push(`${scenario.id}: artifact belongs to another attempt`);
  }
  for (const s of result.scenarios)
    if (!expected.some((e) => e.id === s.id))
      issues.push(`${s.id}: scenario is outside the approved plan`);
  return {
    ...result,
    attemptId,
    planHash: run.input.planHash,
    commits: commitSet(run),
    tools,
    issues,
    passed: issues.length === 0,
  };
}
export function currentAcceptance(run: CodingRun, steps: CodingStep[]) {
  return steps.findLast(
    (s) =>
      s.kind === "collect" &&
      s.status === "completed" &&
      s.continuation?.kind === "accept" &&
      (s.change_request_id ?? null) ===
        (run.change_requests?.at(-1)?.id ?? null) &&
      (s.direction_response_id ?? null) ===
        (run.direction_responses?.at(-1)?.id ?? null),
  );
}
export function acceptanceReady(run: CodingRun, steps: CodingStep[]) {
  if (run.plan.acceptanceScenarios === undefined) return true;
  const step = currentAcceptance(run, steps);
  const attempt = steps.findLast((s) => s.kind === "accept");
  if (
    !step ||
    !attempt ||
    attempt.status !== "completed" ||
    (attempt.recovery_step_id ?? attempt.id) !==
      step.continuation?.agentStepId ||
    steps.indexOf(attempt) >= steps.indexOf(step) ||
    steps
      .slice(steps.indexOf(attempt) + 1)
      .some((s) => s.kind === "validate") ||
    step.result?.passed !== true ||
    step.result.attemptId !== step.continuation?.agentStepId ||
    step.result.planHash !== run.input.planHash ||
    !isDeepStrictEqual(step.result.commits, commitSet(run))
  )
    return false;
  const report = step.result as AcceptanceReport;
  try {
    return assessAcceptance(run, report.attemptId, report, report.tools).passed;
  } catch {
    return false;
  }
}
