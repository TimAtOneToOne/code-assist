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

type ValidationResult = {
  commit: string;
  commands: Record<string, number>;
  passed: boolean;
};

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
      ? "review"
      : "implement";
  const outcome = previousValidationStepId
    ? {
        ...result,
        previousValidationStepId,
        disposition: "needs_direction",
        summary:
          "Validation is still failing after an implementation attempt left the candidate commits unchanged. Automatic implementation and validation have paused.",
        directionQuestion: `Validation for ${activeSnapshot(run).name} failed again at commit ${result.commit}. The validation commands and exit codes match step ${previousValidationStepId}, and no candidate commits changed. Inspect the saved validation logs and implementation findings, then provide direction to resolve the blocker. Reply and Continue resumes from the saved workspace; passing validation and independent review are still required before publication.`,
      }
    : result;
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
  );
}
