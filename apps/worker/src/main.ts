import { connectBoss } from "./database.ts";
import { initializeProbes, probeQueue, registerProbeWorker } from "./probe.ts";
import { logger } from "./logging.ts";
import {
  initializeIntake,
  intakeQueue,
  notificationQueue,
} from "@code-assist/intake";
import { registerIntakeWorker } from "@code-assist/intake/worker";

const release = process.env.CODE_ASSIST_COMMIT ?? "development";
const boss = connectBoss(`code-assist-worker:${release}`);
const shutdown = new Promise<string>((resolve) => {
  process.once("SIGTERM", () => resolve("SIGTERM"));
  process.once("SIGINT", () => resolve("SIGINT"));
});

try {
  await boss.start();
  await initializeProbes(boss);
  await initializeIntake(boss);
  const dataDirectory = process.env.CODE_ASSIST_DATA_DIR;
  if (!dataDirectory) throw new Error("CODE_ASSIST_DATA_DIR is required");
  await registerProbeWorker(boss, release);
  await registerIntakeWorker(boss, dataDirectory);
  logger.event("info", "worker.ready", "Worker ready");
  const signal = await shutdown;
  logger.event("info", "worker.draining", "Worker draining", { signal });
  await boss.offWork(probeQueue);
  await boss.offWork(intakeQueue);
  await boss.offWork(notificationQueue);
} finally {
  await boss.stop();
  logger.event("info", "worker.stopped", "Worker stopped");
}
