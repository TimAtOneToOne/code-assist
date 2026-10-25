import type { PgBoss } from "pg-boss";
import type { AcceptanceReport } from "./acceptance-types.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import { finishCoding } from "./coding.ts";
import {
  codingIndexes,
  repositories,
  repositoryIndex,
} from "./coding-repositories.ts";

export function finishAcceptance(
  boss: PgBoss,
  run: CodingRun,
  step: CodingStep,
  report: AcceptanceReport,
  evidence: string,
) {
  const blocked = report.scenarios.filter((s) => s.status === "blocked");
  const next = report.passed
    ? "review"
    : blocked.length
      ? "needs_direction"
      : "implement";
  return finishCoding(
    boss,
    run,
    step,
    {
      ...report,
      evidence,
      ...(blocked.length
        ? {
            disposition: "needs_direction",
            directionQuestion: blocked
              .map((s) => s.id + ": " + s.observed)
              .join("\n"),
          }
        : {}),
    },
    next,
    undefined,
    undefined,
    undefined,
    run.repositories
      ? {
          repositories: repositories(run).map((r) => ({ ...r })),
          index: report.passed ? repositoryIndex(run) : codingIndexes(run)[0],
        }
      : undefined,
  );
}
