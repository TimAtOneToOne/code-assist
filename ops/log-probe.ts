import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { root } from "./settings.ts";
import { createLogger } from "../packages/observability/src/logger.ts";

process.loadEnvFile(join(root, "runtime.env"));
process.env.CODE_ASSIST_COMMIT = basename(realpathSync(join(root, "current")));
const attempt = randomUUID();
const logger = createLogger("diagnostic").child({ attempt_id: attempt });
logger.event(
  "info",
  "attempt.started",
  "Intentional failure diagnostic started",
);
const child = spawn(
  process.execPath,
  [
    "-e",
    "console.log('Synthetic validation started'); console.error('Synthetic failure: required diagnostic fixture is missing'); process.exit(7);",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const stdout: Buffer[] = [];
const stderr: Buffer[] = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));
child.on("error", (error) =>
  logger.event("error", "command.spawn_failed", "Diagnostic could not start", {
    error,
  }),
);
const exitCode = await new Promise<number | null>((resolve) =>
  child.on("close", resolve),
);
logger.payload("command.output", "Complete diagnostic command output", {
  executable: "node",
  stdout: Buffer.concat(stdout).toString(),
  stderr: Buffer.concat(stderr).toString(),
  exit_code: exitCode,
});
logger.event(
  "error",
  "attempt.failed",
  "Synthetic validation failed: required diagnostic fixture is missing",
  { exit_code: exitCode },
);
console.log(
  JSON.stringify({
    attempt_id: attempt,
    url: `http://100.91.0.83:3000/logs?attempt=${attempt}`,
    expected_exit_code: 7,
    actual_exit_code: exitCode,
  }),
);
if (exitCode !== 7) process.exitCode = 1;
