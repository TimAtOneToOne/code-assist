import { parsePlan, type PlanDocument } from "./planning-types.ts";

export function planValidationScripts(
  plan: PlanDocument,
  repositories: string[],
  repository: string,
) {
  parsePlan(plan, repositories);
  if (!repositories.includes(repository))
    throw new Error("Validation repository is outside the approved scope.");
  return (plan.additionalValidation ?? [])
    .filter((check) => check.repository === repository)
    .map((check) => check.script);
}

export function additionalValidationCommands(scripts: string[]) {
  if (
    !Array.isArray(scripts) ||
    scripts.some((s) => typeof s !== "string" || !s.trim() || s.includes("\0"))
  )
    throw new Error("Invalid additional validation commands.");
  return scripts.map((script, index) => ({
    task: `Plan ${index + 1}: ${script}`,
    args: ["bash", "-euc", script],
  }));
}

export function assertPlanValidationResults(
  scripts: string[],
  results: Record<string, number>,
) {
  for (const { task } of additionalValidationCommands(scripts)) {
    if (!Object.hasOwn(results, task) || !Number.isInteger(results[task]))
      throw new Error(`Missing result for approved validation: ${task}`);
  }
}
