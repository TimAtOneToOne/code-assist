import type { PgBoss, WorkHandler } from "pg-boss";
import { discoveryQueue } from "./discovery.ts";
import { registerExecutionConcurrency } from "./execution-concurrency.ts";

export function registerDiscoveryConcurrency(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
  handler: WorkHandler<{ runId: string }>,
) {
  return registerExecutionConcurrency(
    boss,
    directory,
    shutdown,
    discoveryQueue,
    "discovery",
    "maxParallelDiscoveries",
    (count) => boss.work(discoveryQueue, { localConcurrency: count }, handler),
  );
}
