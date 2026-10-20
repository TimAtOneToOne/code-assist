import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { terminateOwnedProcesses } from "../../src/owned-processes.ts";

if (process.argv[2] === "child") {
  const shell = spawn("/bin/sleep", ["60"], {
    detached: true,
    stdio: "ignore",
  });
  await once(shell, "spawn");
  process.send!({ shell: shell.pid });
} else {
  const child = fork(fileURLToPath(import.meta.url), ["child"], {
    execArgv: [],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const [message] = await once(child, "message");
  process.send!({ child: child.pid, shell: message.shell });
  process.on("message", () => {
    terminateOwnedProcesses();
    process.send!({ cleaned: true });
    process.disconnect();
  });
  process.on("disconnect", () => terminateOwnedProcesses());
}
