import { connectBoss } from "./database.ts";
import { confirmProbe, createProbe, probeQueue, readProbe } from "./probe.ts";

const [command, id] = process.argv.slice(2);
if (
  !["create", "status", "confirm", "retry"].includes(command) ||
  (command !== "create" && !id)
) {
  throw new Error(
    "Usage: probe create | status <id> | confirm <id> | retry <id>",
  );
}
const boss = connectBoss("code-assist-probe-cli");
const release = process.env.CODE_ASSIST_COMMIT ?? "development";
try {
  await boss.start();
  if (command === "create") {
    console.log(JSON.stringify({ id: await createProbe(boss, release) }));
  } else if (command === "confirm") {
    await confirmProbe(boss, id, release);
    console.log(JSON.stringify(await readProbe(boss, id)));
  } else if (command === "retry") {
    const probe = await readProbe(boss, id);
    if (probe.job?.state !== "failed")
      throw new Error("Only failed jobs can be retried");
    await boss.retry(probeQueue, probe.job_id);
    console.log(JSON.stringify(await readProbe(boss, id)));
  } else {
    console.log(JSON.stringify(await readProbe(boss, id)));
  }
} finally {
  await boss.stop();
}
