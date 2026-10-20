import { connectBoss } from "./database.ts";
import { initializeProbes, probeQueue, registerProbeWorker } from "./probe.ts";
import { logger } from "./logging.ts";

const release = process.env.CODE_ASSIST_COMMIT ?? "development";
const boss = connectBoss(`code-assist-worker:${release}`);
const shutdown = new Promise<string>((resolve) => {
  process.once("SIGTERM", () => resolve("SIGTERM"));
  process.once("SIGINT", () => resolve("SIGINT"));
});

try {
  await boss.start();
  await initializeProbes(boss);
  await registerProbeWorker(boss, release);
  logger.event("info", "worker.ready", "Worker ready");
  const signal = await shutdown;
  logger.event("info", "worker.draining", "Worker draining", { signal });
  await boss.offWork(probeQueue);
} finally {
  await boss.stop();
  logger.event("info", "worker.stopped", "Worker stopped");
}
