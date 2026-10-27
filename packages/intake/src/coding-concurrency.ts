import type { PgBoss, WorkWithMetadataHandler } from "pg-boss";
import { codingQueue } from "./coding.ts";
import { registerExecutionConcurrency } from "./execution-concurrency.ts";

export function registerCodingConcurrency(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
  handler: WorkWithMetadataHandler<{ stepId: string }, unknown>,
) {
  return registerExecutionConcurrency(
    boss,
    directory,
    shutdown,
    codingQueue,
    "coding",
    "maxParallelCodingSessions",
    (count) =>
      boss.work<
        { stepId: string },
        unknown,
        { includeMetadata: true; localConcurrency: number }
      >(
        codingQueue,
        { includeMetadata: true, localConcurrency: count },
        handler,
      ),
  );
}
