import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import type { Workspace } from "./workspace.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import { composeInstructions } from "./prompt-defaults.ts";
import { readPromptSettings } from "./prompt-settings.ts";
import type { createLogger } from "@code-assist/observability";
export const repo = "/work/internal-chat-ui";
export function codingDirectory(directory: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid coding ID");
  return join(directory, "coding", id);
}
type Log = ReturnType<typeof createLogger>;
export async function executeCoding(
  executable: string,
  args: string[],
  signal: AbortSignal,
  log: Log,
  input?: string | Readable,
  onLine?: (line: string) => void,
  outputFile?: string,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
        signal,
        stdio: ["pipe", "pipe", "pipe"],
      }),
      file = outputFile ? createWriteStream(outputFile, { mode: 0o600 }) : null;
    let stdout = "",
      failure: unknown;
    for (const [name, stream] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ] as const) {
      if (name === "stdout" && file) {
        stream.pipe(file);
        continue;
      }
      stream.setEncoding("utf8");
      let buffer = "";
      const emit = (line: string) => {
        try {
          if (name === "stdout" && onLine) onLine(line);
          else
            log.payload("coding.command", executable, {
              stream: name,
              output: line,
            });
        } catch (error) {
          failure = error;
          child.kill();
        }
      };
      stream.on("data", (text: string) => {
        if (name === "stdout" && !onLine) stdout += text;
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
    file?.on("error", (error) => {
      failure = error;
      child.kill();
    });
    child.on("error", reject);
    child.stdin.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") {
        failure = error;
        child.kill();
      }
    });
    child.on("close", async (code) => {
      if (file && !file.closed)
        await new Promise<void>((r) => file.on("close", r));
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(`${executable} exited ${code}; inspect this step's logs.`),
        );
      else resolve(stdout.trim());
    });
    if (typeof input === "string" || !input) child.stdin.end(input);
    else {
      input.on("error", (error) => {
        failure = error;
        child.kill();
      });
      input.pipe(child.stdin);
    }
  });
}
export function guestCommands(
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const guest = (
    args: string[],
    input?: string | Readable,
    onLine?: (line: string) => void,
    outputFile?: string,
  ) =>
    executeCoding(
      "/usr/local/bin/orb",
      ["-m", workspace.machine, "-u", "workspace", ...args],
      signal,
      log,
      input,
      onLine,
      outputFile,
    );
  const root = (args: string[], input?: string | Readable) =>
    executeCoding(
      "/usr/local/bin/orb",
      ["-m", workspace.machine, "-u", "root", ...args],
      signal,
      log,
      input,
    );
  const git = (...args: string[]) => guest(["git", "-C", repo, ...args]);
  return {
    guest,
    root,
    git,
    run: (args: string[]) => guest(["node", "/work/run.mjs", ...args]),
  };
}
export async function stopCodingUnit(
  workspace: Workspace,
  stepId: string,
  log: Log,
) {
  await executeCoding(
    "/usr/local/bin/orb",
    [
      "-m",
      workspace.machine,
      "-u",
      "root",
      "systemctl",
      "stop",
      `ca-step-${stepId}.service`,
    ],
    new AbortController().signal,
    log,
  ).catch((error) =>
    log.payload(
      "coding.stop",
      "Could not stop owned coding unit",
      { error },
      "error",
    ),
  );
}
export async function setupCodingRuntime(
  directory: string,
  run: CodingRun,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const local = codingDirectory(directory, run.id);
  await mkdir(local, { recursive: true, mode: 0o700 });
  const { guest, git } = guestCommands(workspace, signal, log),
    bare = join(local, "repository.git");
  const cmd = (args: string[]) =>
    executeCoding("/usr/bin/git", args, signal, log);
  await cmd(["init", "--bare", bare]);
  await cmd([
    "--git-dir",
    bare,
    "fetch",
    run.input.snapshot.source,
    `${run.input.snapshot.commit}:refs/heads/base`,
  ]);
  const bundle = join(local, "source.bundle");
  await cmd(["--git-dir", bare, "bundle", "create", bundle, "refs/heads/base"]);
  await guest(
    ["bash", "-c", "cat > /work/source.bundle"],
    createReadStream(bundle),
  );
  await git("init");
  await git("fetch", "/work/source.bundle", "refs/heads/base");
  await git("checkout", "--force", "-b", run.branch, "FETCH_HEAD");
  await git("config", "user.name", "Code Assist");
  await git("config", "user.email", "code-assist@localhost");
  await guest(["rm", "/work/source.bundle"]);
  await rm(bundle);
  await ensureCodingRuntime(directory, run, workspace, signal, log);
  return run.input.snapshot.commit;
}
export async function ensureCodingRuntime(
  directory: string,
  run: CodingRun,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const { root, guest } = guestCommands(workspace, signal, log);
  const release = process.env.CODE_ASSIST_COMMIT ?? "development";
  const installed = await root([
    "bash",
    "-c",
    "if test -f /opt/code-assist/release; then cat /opt/code-assist/release; fi",
  ]);
  if (installed === release) return;
  const local = codingDirectory(directory, run.id);
  const runtime = join(local, "runtime.tar"),
    source = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  await executeCoding(
    "/usr/bin/tar",
    [
      "--exclude=node_modules",
      "--exclude=.tmp",
      "-cf",
      runtime,
      "-C",
      source,
      "packages",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ],
    signal,
    log,
  );
  await root(["mkdir", "-p", "/opt/code-assist"]);
  await root(
    ["tar", "-xf", "-", "-C", "/opt/code-assist"],
    createReadStream(runtime),
  );
  await rm(runtime);
  await root([
    "bash",
    "-c",
    "cd /opt/code-assist && pnpm install --frozen-lockfile --filter @code-assist/intake... --filter @code-assist/browser-mcp",
  ]);
  await guest([
    "bash",
    "-c",
    "cd /opt/code-assist/packages/browser-mcp && pnpm exec playwright-mcp install-browser chromium",
  ]);
  await guest(["mkdir", "-p", "/work/evidence", "/work/logs"]);
  await root(["bash", "-c", "cat > /opt/code-assist/release"], release);
  log.event(
    "info",
    "coding.runtime",
    "Guest runtime matches the worker release",
    { runtime_release: release },
  );
}
export async function checkpoint(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const { guest, git } = guestCommands(workspace, signal, log);
  await git("add", "-A");
  await git(
    "commit",
    "--allow-empty",
    "-m",
    `feat(${run.identifier.toLowerCase()}): implement approved plan v${run.version}`,
  );
  const commit = await git("rev-parse", "HEAD");
  const bundle = join(codingDirectory(directory, run.id), `${step.id}.bundle`);
  await git("bundle", "create", "/work/checkpoint.bundle", "HEAD");
  await guest(["cat", "/work/checkpoint.bundle"], undefined, undefined, bundle);
  await executeCoding(
    "/usr/bin/git",
    [
      "--git-dir",
      join(codingDirectory(directory, run.id), "repository.git"),
      "fetch",
      bundle,
      `HEAD:refs/checkpoints/${step.id}`,
    ],
    signal,
    log,
  );
  await rm(bundle);
  return commit;
}
export async function preserveEvidence(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const { guest } = guestCommands(workspace, signal, log);
  const path = join(
    codingDirectory(directory, run.id),
    `${step.id}-evidence.tar.gz`,
  );
  await guest(
    ["tar", "-czf", "-", "-C", "/work", "evidence", "logs"],
    undefined,
    undefined,
    path,
  );
  return path;
}
export async function codingPrompt(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  history: unknown,
) {
  return `You are ${step.kind === "review" ? "Claude independently reviewing" : "Codex implementing"} Code Assist ticket ${run.identifier}: ${run.title}.
Tim approved the exact plan below. Implement only that scope. Follow repository AGENTS.md and existing patterns. Do not upgrade Drizzle, add unrelated optimizations, change Linear, access production, push Git, open/merge PRs, or deploy infrastructure. The controller owns commits and publication. Do not create commits or change branches. If a material product decision, missing credential/service, or changed scope blocks progress, return needs_direction with the exact question. Do not invent success or silently skip acceptance criteria.
Repository: ${repo}. Approved base: ${run.input.snapshot.commit}. Current checkpoint: ${step.input_commit ?? run.input.snapshot.commit}.
This is an isolated OrbStack Linux guest with a private Docker Engine, PostgreSQL on localhost:5435 and LocalStack on localhost:4566. All commands for the app must use node /work/run.mjs <command> [args]; this loads mapped repository variables and runs in sveltekit/. No host/controller/GitHub credentials are available. Do not inspect or print /work/environment.json or provider secrets. Local fixture credentials are allowed. Use .tmp/ for ad hoc scripts; do not commit temporary evidence, credentials, or patient data.
Playwright MCP is registered as playwright in this guest. Start the app with node /work/run.mjs pnpm dev --host 127.0.0.1 --port 5173 --strictPort. Use the real local credential sign-in flow with a synthetic user in the attempt database, not a bypass of application authorization. Exercise the approved UI behavior with MCP, inspect desktop and mobile rendering and browser errors. Save screenshots and complete evidence to /work/evidence. The controller runs lint, check, test and build after every implementation; also add/run meaningful regression tests for the plan. Explain unavailable external integration tests honestly.
Central logging: every SDK event and tool result is captured. Your workspace's redacted log mirror is /work/logs/structured/coding.jsonl with full JSON payloads in /work/logs/artifacts; use normal read/search tools to investigate previous failures. The same events are indexed in the main Logs UI under this coding step. Test/app output may be saved under /work/evidence for diagnosis.
${step.kind === "review" ? "Review the actual git diff from the approved base and the saved validation/browser evidence. Do not edit source or commit. Re-run targeted checks where useful. Return only unresolved findings, with file evidence and actionable recommendations. Any critical/high/medium finding requires revise; low findings may remain. Use needs_direction for a real unresolved human decision. Verify prior fixes independently." : "Implement or revise the approved feature. Read prior code reviews and failures below. Return implemented only after the approved behavior and browser checks are complete. Return browserEvidence as the paths to evidence you actually saved."}
${composeInstructions(readPromptSettings(directory), "coding", null, [run.input.snapshot])}
Approved Plan v${run.version} (${run.input.planHash}):
${run.plan.markdown}
Previous Coding Steps (complete results):
${JSON.stringify(history)}`;
}
export async function runGuestAgent(
  workspace: Workspace,
  step: CodingStep,
  input: Record<string, unknown>,
  signal: AbortSignal,
  log: Log,
  onEvent: () => void,
) {
  let result: unknown;
  const browserCalls: string[] = [];
  try {
    // systemd owns all SDK/browser/shell descendants and receives no secrets in its arguments.
    await executeCoding(
      "/usr/local/bin/orb",
      [
        "-m",
        workspace.machine,
        "-u",
        "root",
        "systemd-run",
        "--quiet",
        "--wait",
        "--pipe",
        "--collect",
        `--unit=ca-step-${step.id}`,
        "--uid=workspace",
        "--property=KillMode=control-group",
        "/usr/local/bin/node",
        "/opt/code-assist/packages/intake/src/coding-guest.ts",
      ],
      signal,
      log,
      JSON.stringify(input),
      (line) => {
        if (!line.trim()) return;
        const message = JSON.parse(line) as { type: string; value: unknown };
        log.payload(
          `coding.agent.${message.type}`,
          `${input.provider} ${message.type}`,
          message.value,
        );
        if (message.type === "result") result = message.value;
        const event = message.value as {
          type?: string;
          item?: {
            type?: string;
            server?: string;
            tool?: string;
            status?: string;
          };
        };
        if (
          message.type === "event" &&
          event.type === "item.completed" &&
          event.item?.type === "mcp_tool_call" &&
          event.item.server === "playwright" &&
          event.item.status === "completed" &&
          event.item.tool
        )
          browserCalls.push(event.item.tool);
        onEvent();
      },
    );
    if (!result) throw new Error("Agent finished without a saved result.");
    return { result, browserCalls };
  } finally {
    if (signal.aborted) await stopCodingUnit(workspace, step.id, log);
  }
}
export async function validation(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const command = guestCommands(workspace, signal, log);
  await command.root([
    "systemd-run",
    "--quiet",
    "--wait",
    "--pipe",
    "--collect",
    `--unit=ca-step-${step.id}`,
    "--uid=workspace",
    "--property=KillMode=control-group",
    "/usr/local/bin/node",
    "/opt/code-assist/packages/intake/src/coding-validation.ts",
    step.id,
  ]);
  const results = JSON.parse(
    await command.guest(["cat", `/work/evidence/${step.id}-validation.json`]),
  ) as Record<string, number>;
  const commit = await command.git("rev-parse", "HEAD");
  const dirty = await command.git("status", "--porcelain");
  if (commit !== run.commit || dirty)
    throw new Error(
      "Validation changed the reviewed source; inspect the workspace.",
    );
  await writeFile(
    join(codingDirectory(directory, run.id), `${step.id}-validation.json`),
    JSON.stringify({ commit, commands: results }),
    { mode: 0o600 },
  );
  return {
    commit,
    commands: results,
    passed: Object.values(results).every((code) => code === 0),
  };
}
