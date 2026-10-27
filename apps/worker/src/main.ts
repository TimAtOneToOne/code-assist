import {
  cleanupQueue,
  registerCleanupWorker,
} from "@code-assist/intake/coding-cleanup";
import {
  registerSetupTestWorker,
  setupTestQueue,
} from "@code-assist/intake/repository-setup-tests";
import { codingQueue } from "@code-assist/intake/coding";
import { registerCodingWorker } from "@code-assist/intake/coding-worker";
import { githubQueue, registerGitHubWorker } from "@code-assist/intake/github";
import { connectBoss } from "./database.ts";
import { initializeProbes, probeQueue, registerProbeWorker } from "./probe.ts";
import { logger } from "./logging.ts";
import {
  initializeIntake,
  intakeQueue,
  notificationQueue,
} from "@code-assist/intake";
import { registerIntakeWorker } from "@code-assist/intake/worker";
import { discoveryQueue } from "@code-assist/intake/discovery";
import { registerDiscoveryWorker } from "@code-assist/intake/discovery-worker";

import { planningQueue } from "@code-assist/intake/planning";
import { registerPlanningWorker } from "@code-assist/intake/planning-worker";

const release = process.env.CODE_ASSIST_COMMIT ?? "development";
const boss = connectBoss(`code-assist-worker:${release}`);
const stopping = new AbortController();
const shutdown = new Promise<string>((resolve) => {
  process.once("SIGTERM", () => {
    stopping.abort();
    resolve("SIGTERM");
  });
  process.once("SIGINT", () => {
    stopping.abort();
    resolve("SIGINT");
  });
});

try {
  await boss.start();
  await initializeProbes(boss);
  await initializeIntake(boss);
  const dataDirectory = process.env.CODE_ASSIST_DATA_DIR;
  if (!dataDirectory) throw new Error("CODE_ASSIST_DATA_DIR is required");
  await registerSetupTestWorker(boss, dataDirectory, stopping.signal);
  await registerProbeWorker(boss, release);
  await registerIntakeWorker(boss, dataDirectory);
  const stopDiscoverySettings = await registerDiscoveryWorker(
    boss,
    dataDirectory,
    stopping.signal,
  );
  await registerPlanningWorker(boss, dataDirectory, stopping.signal);
  await registerCodingWorker(boss, dataDirectory, stopping.signal);
  await registerGitHubWorker(boss, stopping.signal);
  await registerCleanupWorker(boss, dataDirectory, stopping.signal);
  logger.event("info", "worker.ready", "Worker ready");
  const signal = await shutdown;
  logger.event("info", "worker.draining", "Worker draining", { signal });
  await stopDiscoverySettings();
  await boss.offWork(setupTestQueue);
  await boss.offWork(codingQueue);
  await boss.offWork(cleanupQueue);
  await boss.offWork(githubQueue);
  await boss.offWork(planningQueue);
  await boss.offWork(discoveryQueue);
  await boss.offWork(probeQueue);
  await boss.offWork(intakeQueue);
  await boss.offWork(notificationQueue);
} finally {
  stopping.abort();
  await boss.stop();
  logger.event("info", "worker.stopped", "Worker stopped");
}
