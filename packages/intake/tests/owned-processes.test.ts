import assert from "node:assert/strict";
import { fork, spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

function alive(pid: number) {
  try {
    const state = execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

test("cleanup terminates owned detached descendants and leaves unrelated processes alive", async () => {
  const unrelated = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
  const runner = fork(
    fileURLToPath(
      new URL("./fixtures/owned-process-runner.ts", import.meta.url),
    ),
    [],
    { execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  try {
    const [owned] = await once(runner, "message");
    assert(alive(owned.child));
    assert(alive(owned.shell));
    const finished = once(runner, "exit");
    runner.send("cleanup");
    const [message] = await once(runner, "message");
    assert.equal(message.cleaned, true);
    await finished;
    assert.equal(alive(owned.child), false);
    assert.equal(alive(owned.shell), false);
    assert(alive(unrelated.pid!));
  } finally {
    if (runner.connected) runner.disconnect();
    unrelated.kill();
  }
});
