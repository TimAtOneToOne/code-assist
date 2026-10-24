import { repositoryProfile } from "./repository-profiles.ts";
import { workspaceLogEnvironment } from "./workspace-environment.ts";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createLogger } from "@code-assist/observability";
import { artifactPath } from "@code-assist/observability/artifacts";
import { additionalValidationCommands } from "./plan-validation.ts";
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id))
  throw new Error("A coding step ID is required.");
const repository = process.argv[3] ?? "internal-chat-ui";
const profile = existsSync("/etc/code-assist/profiles.json")
  ? (JSON.parse(readFileSync("/etc/code-assist/profiles.json", "utf8"))[
      repository
    ] as ReturnType<typeof repositoryProfile>)
  : repositoryProfile(repository);
const scoped = process.argv.includes("--environments");
const environment = JSON.parse(
  readFileSync(
    scoped ? `/work/environments/${repository}.json` : "/work/environment.json",
    "utf8",
  ),
) as Record<string, string>;
const artifacts = "/work/logs/artifacts";
const log = createLogger(
  "coding",
  {
    logDirectory: "/work/logs",
    artifactDirectory: artifacts,
    environment: workspaceLogEnvironment(environment),
  },
  { attempt_id: id },
);
const results: Record<string, number> = {};
const additional = process.argv.find((arg) =>
  arg.startsWith("--plan-validation="),
);
const commands = [
  ...profile.validation.map((args) => ({ task: args.join(" "), args })),
  ...additionalValidationCommands(
    additional ? JSON.parse(additional.slice("--plan-validation=".length)) : [],
  ),
];
for (const { task, args } of commands) {
  results[task] = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      "/usr/local/bin/node",
      ["/work/run.mjs", ...(scoped ? ["--repo", repository] : []), ...args],
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
