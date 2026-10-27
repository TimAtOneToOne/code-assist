import { mkdirSync, watch } from "node:fs";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import {
  executionSettingsFile,
  readExecutionSettings,
  type ExecutionSettings,
} from "./execution-settings.ts";

export async function registerExecutionConcurrency(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
  queue: string,
  service: string,
  setting: keyof ExecutionSettings,
  start: (count: number) => Promise<unknown>,
) {
  const log = createLogger(service);
  let applied: number | undefined;
  const apply = async () => {
    if (shutdown.aborted) return;
    const requested = readExecutionSettings(directory)[setting];
    if (requested === applied) return;
    if (applied !== undefined) {
      log.event(
        "info",
        `${service}.concurrency_pending`,
        `Waiting for active ${service} steps before changing parallelism`,
        { requested },
      );
      // Native offWork drains handlers without aborting their jobs.
      await boss.offWork(queue);
      applied = undefined;
    }
    if (shutdown.aborted) return;
    const count = readExecutionSettings(directory)[setting];
    await start(count);
    applied = count;
    log.event(
      "info",
      `${service}.concurrency_applied`,
      `${service} parallelism configured`,
      { [setting]: count },
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
        `${service}.concurrency_failed`,
        `Could not apply ${service} execution settings`,
        { error },
      );
    });
  });
  watcher.on("error", (error) => {
    log.event(
      "error",
      `${service}.settings_watch_failed`,
      `Could not watch ${service} execution settings`,
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
