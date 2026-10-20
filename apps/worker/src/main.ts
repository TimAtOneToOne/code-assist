import { connectBoss } from "./database.ts";
import { initializeProbes, probeQueue, registerProbeWorker } from "./probe.ts";

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
  console.log(
    JSON.stringify({ event: "worker.ready", release, pid: process.pid }),
  );
  const signal = await shutdown;
  console.log(JSON.stringify({ event: "worker.draining", signal, release }));
  await boss.offWork(probeQueue);
} finally {
  await boss.stop();
  console.log(JSON.stringify({ event: "worker.stopped", release }));
}
