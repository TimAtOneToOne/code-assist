import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "@code-assist/observability";
import { artifactPath } from "@code-assist/observability/artifacts";
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id))
  throw new Error("A coding step ID is required.");
const environment = JSON.parse(
  readFileSync("/work/environment.json", "utf8"),
) as Record<string, string>;
const artifacts = "/work/logs/artifacts";
const log = createLogger(
  "coding",
  { logDirectory: "/work/logs", artifactDirectory: artifacts, environment },
  { attempt_id: id },
);
const results: Record<string, number> = {};
for (const task of ["lint", "check", "test", "build"]) {
  results[task] = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      "/usr/local/bin/node",
      ["/work/run.mjs", "pnpm", task],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      let buffer = "";
      const emit = (line: string) => {
        const ref = log.payload("coding.validation", task, {
          command: task,
          output: line,
        });
        process.stdout.write(
          readFileSync(artifactPath(artifacts, ref.artifact_id), "utf8") + "\n",
        );
      };
      stream.on("data", (text: string) => {
        buffer += text;
        let i;
        while ((i = buffer.indexOf("\n")) !== -1) {
          emit(buffer.slice(0, i));
          buffer = buffer.slice(i + 1);
        }
      });
      stream.on("end", () => {
        if (buffer) emit(buffer);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
writeFileSync(`/work/evidence/${id}-validation.json`, JSON.stringify(results), {
  mode: 0o600,
});
