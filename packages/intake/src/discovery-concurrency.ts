import { mkdirSync, watch } from "node:fs";
import type { PgBoss, WorkHandler } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { discoveryQueue } from "./discovery.ts";
import {
  executionSettingsFile,
  readExecutionSettings,
} from "./execution-settings.ts";

export async function registerDiscoveryConcurrency(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
  handler: WorkHandler<{ runId: string }>,
) {
  const log = createLogger("discovery");
  let applied: number | undefined;
  const apply = async () => {
    if (shutdown.aborted) return;
    const requested = readExecutionSettings(directory).maxParallelDiscoveries;
    if (requested === applied) return;
    if (applied !== undefined) {
      log.event(
        "info",
        "discovery.concurrency_pending",
        "Waiting for active discoveries before changing parallelism",
        { requested },
      );
      // Native offWork drains handlers without aborting their jobs.
      await boss.offWork(discoveryQueue);
      applied = undefined;
    }
    if (shutdown.aborted) return;
    const count = readExecutionSettings(directory).maxParallelDiscoveries;
    await boss.work(discoveryQueue, { localConcurrency: count }, handler);
    applied = count;
    log.event(
      "info",
      "discovery.concurrency_applied",
      "Discovery parallelism configured",
      { maxParallelDiscoveries: count },
    );
  };
  let pending = Promise.resolve();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const watcher = watch(directory, { signal: shutdown }, (_event, filename) => {
    if (filename !== null && filename.toString() !== executionSettingsFile)
      return;
    pending = pending.then(apply).catch((error) => {
      log.event(
        "error",
        "discovery.concurrency_failed",
        "Could not apply discovery execution settings",
        { error },
      );
    });
  });
  watcher.on("error", (error) => {
    log.event(
      "error",
      "discovery.settings_watch_failed",
      "Could not watch discovery execution settings",
      { error },
    );
  });
  try {
    pending = pending.then(apply);
    await pending;
  } catch (error) {
    watcher.close();
    throw error;
  }
  return async () => {
    watcher.close();
    await pending;
  };
}
