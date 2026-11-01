import { isDeepStrictEqual } from "node:util";
import type { PgBoss } from "pg-boss";
import { finishCoding, readCoding } from "./coding.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import {
  activeSnapshot,
  codingIndexes,
  repositories,
  repositoryIndex,
} from "./coding-repositories.ts";

export type ValidationResult = {
  commit: string;
  commands: Record<string, number>;
  passed: boolean;
  sourceChanges?: { status: string; diff: string };
};

export async function validationSourceChanges(
  git: (...args: string[]) => Promise<string>,
  expectedCommit: string,
) {
  if ((await git("rev-parse", "HEAD")) !== expectedCommit)
    throw new Error(
      "Validation moved the saved commit; inspect the workspace before continuing.",
    );
  const status = await git("status", "--porcelain");
  return status
    ? { status, diff: await git("diff", "HEAD", "--binary") }
    : undefined;
}

export function repeatedValidationFailure(
  step: CodingStep,
  result: ValidationResult,
  history: CodingStep[],
) {
  if (result.passed) return undefined;
  const relevant = history.filter(
    (previous) =>
      previous.id !== step.id &&
      previous.run_id === step.run_id &&
      previous.status === "completed" &&
      (previous.repository_index ?? 0) === (step.repository_index ?? 0) &&
      (previous.change_request_id ?? null) ===
        (step.change_request_id ?? null) &&
      (previous.direction_response_id ?? null) ===
        (step.direction_response_id ?? null),
  );
  const index = relevant.findLastIndex((s) => s.kind === "validate");
  const previous = relevant[index];
  if (
    !previous ||
    previous.result?.passed !== false ||
    previous.result.commit !== result.commit ||
    !isDeepStrictEqual(previous.input_commits, step.input_commits) ||
    !isDeepStrictEqual(previous.result.commands, result.commands) ||
    !isDeepStrictEqual(previous.result.sourceChanges, result.sourceChanges) ||
    !relevant.slice(index + 1).some((s) => s.kind === "implement")
  )
    return undefined;
  return previous.id;
}

export async function finishValidation(
  boss: PgBoss,
  run: CodingRun,
  step: CodingStep,
  result: ValidationResult,
) {
  if (result.sourceChanges) result = { ...result, passed: false };
  const history = result.passed
    ? []
    : (await readCoding(boss.getDb(), run.issue_id)).find(
        (candidate) => candidate.id === run.id,
      )!.steps;
  const previousValidationStepId = repeatedValidationFailure(
    step,
    result,
    history,
  );
  const index = repositoryIndex(run);
  const indexes = codingIndexes(run);
  const following = indexes[indexes.indexOf(index) + 1];
  const next = previousValidationStepId
    ? "needs_direction"
    : result.passed && following === undefined
      ? run.plan.acceptanceScenarios === undefined
        ? "review"
        : "accept"
      : "implement";
  const repair = result.sourceChanges
    ? {
        ...result,
        summary: `${Object.values(result.commands).every((code) => code === 0) ? "Checks passed" : "Some checks failed"}, but validation changed files. Returning to implementation to review those changes, save a new checkpoint, and rerun validation.`,
        repairInstructions:
          "Inspect the saved sourceChanges status and diff and the preserved working tree. Incorporate required generated changes within approved scope, or fix the command's unintended mutation using established repository patterns. Do not blindly discard the diff, create commits, change the approved commands, or claim the previous checks validate a new candidate. The controller will checkpoint your result and rerun validation, acceptance and independent review.",
      }
    : result;
  const outcome = previousValidationStepId
    ? {
        ...repair,
        previousValidationStepId,
        disposition: "needs_direction",
        summary:
          "Validation reached the same unresolved outcome after another implementation attempt without a new candidate. Automatic repair has paused for direction.",
        directionQuestion: `Validation for ${activeSnapshot(run).name} ${result.sourceChanges ? "changed the same files again" : "failed again"} at commit ${result.commit}. The command results${result.sourceChanges ? " and file changes" : ""} match step ${previousValidationStepId}, and no candidate commits changed. Inspect the saved validation logs and implementation findings, then provide direction to resolve the blocker. Reply and Continue resumes from the saved workspace; passing validation and independent review are still required before publication.`,
      }
    : repair;
  return finishCoding(
    boss,
    run,
    step,
    outcome,
    next,
    undefined,
    undefined,
    undefined,
    run.repositories
      ? {
          repositories: repositories(run).map((repository, i) =>
            i === index
              ? {
                  ...repository,
                  status: previousValidationStepId
                    ? "needs_direction"
                    : result.passed
                      ? "review"
                      : "implement",
                }
              : { ...repository },
          ),
          index: result.passed ? (following ?? index) : index,
        }
      : undefined,
    undefined,
    result.sourceChanges && next === "implement" ? step.id : undefined,
  );
}
