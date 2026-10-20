import {
  prepareWorkspace,
  readWorkspace,
  destroyWorkspace,
} from "@code-assist/intake/workspace";
import { connectBoss } from "./database.ts";

const [command, id] = process.argv.slice(2);
const directory = process.env.CODE_ASSIST_DATA_DIR;
if (!directory || !id || !["prepare", "status", "destroy"].includes(command))
  throw new Error(
    "Set CODE_ASSIST_DATA_DIR and use workspace prepare <issue-id> | status <workspace-id> | destroy <workspace-id>.",
  );
const abort = new AbortController();
process.once("SIGTERM", () => abort.abort());
process.once("SIGINT", () => abort.abort());
if (command === "status") {
  console.log(JSON.stringify(await readWorkspace(directory, id)));
} else if (command === "destroy") {
  console.log(
    JSON.stringify(await destroyWorkspace(directory, id, abort.signal)),
  );
} else {
  const boss = connectBoss("code-assist-workspace-cli");
  try {
    await boss.start();
    console.log(
      JSON.stringify(
        await prepareWorkspace(directory, boss.getDb(), id, abort.signal),
      ),
    );
  } finally {
    await boss.stop();
  }
}
