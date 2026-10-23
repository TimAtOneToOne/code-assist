import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  readReceipt,
  writeReceipt,
  parseReceipt,
  type AgentReceipt,
} from "./coding-receipt.ts";
import { mkdir, writeFile, rm, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import { readWorkspace, type Workspace } from "./workspace.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import { composeInstructions } from "./prompt-defaults.ts";
import { readPromptSettings } from "./prompt-settings.ts";
import type { createLogger } from "@code-assist/observability";
import {
  activeSnapshot,
  snapshots,
  repositories,
  repositoryDirectory,
} from "./coding-repositories.ts";
import { environmentLauncher } from "./workspace-bootstrap.ts";
import { repositoryProfile } from "./repository-profiles.ts";
import { mainRef, mainRequest, pinnedMainBases } from "./coding-main.ts";
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
      stderr = "",
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
        if (name === "stderr") stderr += text;
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
      else if (code !== 0) {
        log.payload(
          "coding.command_failed",
          "Command failed",
          { executable, args, exitCode: code, stderr },
          "error",
        );
        reject(
          new Error(`${executable} exited ${code}; inspect this step's logs.`),
        );
      } else resolve(stdout.trim());
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
  name = workspace.input.snapshot.name,
) {
  const repo = `/work/${name}`;
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
    run: (args: string[]) =>
      guest([
        "node",
        "/work/run.mjs",
        ...(workspace.environments ? ["--repo", name] : []),
        ...args,
      ]),
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
export async function prepareCodingSource(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  log: Log,
) {
  const bare = join(repositoryDirectory(directory, run), "repository.git");
  await mkdir(repositoryDirectory(directory, run), {
    recursive: true,
    mode: 0o700,
  });
  const git = (args: string[]) =>
    executeCoding("/usr/bin/git", args, signal, log);
  await git(["init", "--bare", bare]);
  const targetRepair =
    run.repair &&
    (!run.repair.repository ||
      run.repair.repository === activeSnapshot(run).name);
  const commit = targetRepair
    ? run.repair!.baseCommit
    : run.repair
      ? run.commit!
      : activeSnapshot(run).commit;
  if (targetRepair) {
    const remote = await git([
      "-C",
      activeSnapshot(run).source,
      "remote",
      "get-url",
      "origin",
    ]);
    if (
      !/^(?:git@github\.com:|https:\/\/github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
        remote,
      )
    )
      throw new Error("Expected a credential-free GitHub remote.");
    await git(["--git-dir", bare, "fetch", remote, "refs/heads/main"]);
    await git([
      "--git-dir",
      bare,
      "merge-base",
      "--is-ancestor",
      commit,
      "FETCH_HEAD",
    ]);
    await git(["--git-dir", bare, "update-ref", "refs/heads/base", commit]);
  } else {
    await git([
      "--git-dir",
      bare,
      "fetch",
      run.repair && run.parent_run_id
        ? join(
            repositoryDirectory(directory, { ...run, id: run.parent_run_id }),
            "repository.git",
          )
        : activeSnapshot(run).source,
      `${commit}:refs/heads/base`,
    ]);
  }
  return { ...activeSnapshot(run), source: bare, commit };
}
export async function setupCodingRuntime(
  directory: string,
  run: CodingRun,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const local = repositoryDirectory(directory, run);
  await mkdir(local, { recursive: true, mode: 0o700 });
  const { guest, git } = guestCommands(
      workspace,
      signal,
      log,
      activeSnapshot(run).name,
    ),
    bare = join(local, "repository.git");
  const cmd = (args: string[]) =>
    executeCoding("/usr/bin/git", args, signal, log);

  const bundle = join(local, "source.bundle");
  await cmd(["--git-dir", bare, "bundle", "create", bundle, "refs/heads/base"]);
  await guest(
    ["bash", "-c", "cat > /work/source.bundle"],
    createReadStream(bundle),
  );
  await git("init");
  await git("fetch", "/work/source.bundle", "refs/heads/base");
  await git("checkout", "--force", "-b", run.branch, "FETCH_HEAD");
  await guest(["rm", "/work/source.bundle"]);
  await rm(bundle);
  await ensureCodingRuntime(directory, run, workspace, signal, log);
  return await git("rev-parse", "HEAD");
}
export async function ensureCodingRuntime(
  directory: string,
  run: CodingRun,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const { root, guest, git } = guestCommands(
    workspace,
    signal,
    log,
    activeSnapshot(run).name,
  );
  await configureCommitIdentity(run, signal, log, git);
  if (!workspace.environments) {
    const name = workspace.input.snapshot.name;
    await root(["mkdir", "-p", "/work/environments"]);
    await root([
      "cp",
      "/work/environment.json",
      "/work/environments/" + name + ".json",
    ]);
    await root(
      ["bash", "-c", "cat > /work/repositories.json"],
      JSON.stringify({ [name]: repositoryProfile(name).cwd }),
    );
    await root(["bash", "-c", "cat > /work/run.mjs"], environmentLauncher);
    await root(["chown", "-R", "workspace:workspace", "/work/environments"]);
  }
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
async function configureCommitIdentity(
  run: CodingRun,
  signal: AbortSignal,
  log: Log,
  git: ReturnType<typeof guestCommands>["git"],
) {
  for (const key of ["user.name", "user.email"]) {
    const value = await executeCoding(
      "/usr/bin/git",
      ["-C", activeSnapshot(run).source, "config", "--get", key],
      signal,
      log,
    );
    await git("config", key, value);
  }
}

export async function checkpoint(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
  commands = guestCommands(workspace, signal, log, activeSnapshot(run).name),
) {
  const { guest, git } = commands;
  const origin =
    step.continuation?.agentStepId ?? step.recovery_step_id ?? step.id;
  const ref = "refs/checkpoints/" + origin;
  const bare = join(repositoryDirectory(directory, run), "repository.git");
  const existing = await executeCoding(
    "/usr/bin/git",
    ["--git-dir", bare, "for-each-ref", "--format=%(objectname)", ref],
    signal,
    log,
  );
  if (existing) return existing;
  let commit = await git("for-each-ref", "--format=%(objectname)", ref);
  if (!commit) {
    if (await git("ls-files", "--unmerged"))
      throw new Error(
        "Merge conflicts remain unresolved; working tree preserved.",
      );
    const merging = await guest([
      "bash",
      "-c",
      'test ! -f "$1/.git/MERGE_HEAD" || printf merging',
      "merge-state",
      `/work/${activeSnapshot(run).name}`,
    ]);
    await git("add", "-A");
    // A crash after commit but before update-ref leaves a clean HEAD to adopt.
    if (merging || (await git("status", "--porcelain"))) {
      await configureCommitIdentity(run, signal, log, git);
      await git(
        "commit",
        "-m",
        `feat(${run.identifier.toLowerCase()}): ${run.title}`,
      );
    }
    commit = await git("rev-parse", "HEAD");
    await git("update-ref", ref, commit);
  }
  const bundle = join(codingDirectory(directory, run.id), `${origin}.bundle`);
  await git("bundle", "create", "/work/checkpoint.bundle", ref);
  await guest(["cat", "/work/checkpoint.bundle"], undefined, undefined, bundle);
  await executeCoding(
    "/usr/bin/git",
    ["--git-dir", bare, "fetch", bundle, `${ref}:${ref}`],
    signal,
    log,
  );
  await rm(bundle);
  return commit;
}
export function agentReceiptPath(
  directory: string,
  runId: string,
  stepId: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(stepId)) throw new Error("Invalid agent step ID");
  return join(codingDirectory(directory, runId), stepId + "-result.json");
}
export async function recoverAgentResult(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
): Promise<AgentReceipt | null> {
  const origin = step.recovery_step_id ?? step.id;
  const path = agentReceiptPath(directory, run.id, origin);
  const saved = readReceipt(path);
  if (saved) return saved;
  let text = "";
  await guestCommands(workspace, signal, log).guest(
    [
      "bash",
      "-c",
      'if test -f "$1"; then cat "$1"; fi',
      "receipt",
      "/work/results/" + origin + ".json",
    ],
    undefined,
    (line) => {
      text += line;
    },
  );
  if (!text) return null;
  const receipt = parseReceipt(text);
  writeReceipt(path, receipt);
  return receipt;
}
export async function preserveEvidence(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  workspace: Workspace,
  signal: AbortSignal,
  log: Log,
) {
  const origin = step.continuation!.agentStepId;
  const { guest } = guestCommands(
    workspace,
    signal,
    log,
    activeSnapshot(run).name,
  );
  // The agent unit has exited. Freeze the evidence and log mirror once, outside those source trees.
  await guest([
    "node",
    "/opt/code-assist/packages/intake/src/coding-evidence.ts",
    "freeze",
    origin,
  ]);
  const path = join(
    codingDirectory(directory, run.id),
    origin + "-evidence.tar.gz",
  );
  await guest(
    ["tar", "-czf", "-", "-C", "/work/receipts/" + origin, "evidence", "logs"],
    undefined,
    undefined,
    path + ".tmp",
  );
  await executeCoding(
    "/usr/bin/tar",
    ["-tzf", path + ".tmp"],
    signal,
    log,
    undefined,
    () => {},
  );
  await rename(path + ".tmp", path);
  return path;
}
export async function verifyBrowserEvidence(
  workspace: Workspace,
  step: CodingStep,
  paths: string[],
  signal: AbortSignal,
  log: Log,
) {
  const origin = step.continuation!.agentStepId;
  await guestCommands(workspace, signal, log).guest([
    "node",
    "/opt/code-assist/packages/intake/src/coding-evidence.ts",
    "verify",
    origin,
    JSON.stringify(paths),
  ]);
}

export async function codingPrompt(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  history: unknown,
) {
  const profiles = run.workspace_id
    ? (await readWorkspace(directory, run.workspace_id)).profiles
    : undefined;
  const mainBases = await pinnedMainBases(directory, run);
  return `You are ${step.kind === "review" ? "Claude independently reviewing" : "Codex implementing"} Code Assist ticket ${run.identifier}: ${run.title}.
Tim approved the exact plan below. Implement only that scope. Follow repository AGENTS.md and existing patterns. Do not upgrade Drizzle, add unrelated optimizations, change Linear, access production, push Git, open/merge PRs, or deploy infrastructure. The controller owns commits and publication. Do not create commits or change branches. If a material product decision, missing credential/service, or changed scope blocks progress, return needs_direction with the exact question. Do not invent success or silently skip acceptance criteria.
Repository: /work/${activeSnapshot(run).name}. Approved base: ${activeSnapshot(run).commit}. Diff base: ${mainBases[activeSnapshot(run).name] ?? run.repair?.baseCommit ?? activeSnapshot(run).commit}. Current checkpoint: ${step.input_commit ?? run.repair?.baseCommit ?? activeSnapshot(run).commit}.
${mainRequest(run) ? `Bring In Main: the controller supplied pinned main commits ${JSON.stringify(mainBases)} at local ref ${mainRef(run)} in each prepared repository. Preserve ALL upstream changes and the existing feature. The following merge instructions apply ONLY to Codex implementation; Claude must inspect ancestry and resolutions without modifying anything. Do not rebase or rewrite published history. If this ref is not yet an ancestor of HEAD, merge it with git merge --no-commit --no-ff ${mainRef(run)}. If a merge is already in progress, continue resolving it; do not restart or abort it. Resolve conflicts using both main's current behavior and the approved feature; git add resolved files. The controller will create the merge commit after you finish. Never commit yourself. Re-run checks against the combined result. Review the feature diff against each pinned main commit, especially conflict resolutions; unrelated changes arriving from main are not new feature scope. If main is already an ancestor, preserve it and continue requested changes/validation. No network fetch or GitHub credentials are needed inside the guest.` : ""}
${run.repair ? `This is a corrective run after the approved feature merged. Read the COMPLETE main workflow failure evidence in /work/evidence/main-workflow-failure.json. The base is the failed merge commit, with the feature already implemented. Diagnose the cause, reproduce it where feasible, and fix only defects within the approved feature and this repository. Do not reimplement the feature or change shared CI, credentials, IAM, Terraform deployment controls, or unrelated scope to make a pipeline pass. Environmental/transient failures with no justified repository fix require needs_direction with a concrete diagnosis. Do not rerun GitHub workflows or deploy. Validate that the fix addresses the failure and preserves the feature. Review the corrective diff against the Diff base, not the original pre-feature approved base. The controller will publish a fresh corrective PR for Tim to merge. Failed runs: ${JSON.stringify(run.repair.workflows.runs)}.` : ""}
This is an isolated OrbStack Linux guest with a private container engine. Repository commands must use node /work/run.mjs --repo <repository-name> <command> [args]; this loads that repository's mapped variables and selects its working directory. No host/controller/GitHub credentials are available. Do not inspect or print environment JSON files or provider secrets. Local fixture credentials are allowed. Use .tmp/ for ad hoc scripts; do not commit temporary evidence, credentials, or patient data.
Candidate checkouts and exact checkpoints: ${JSON.stringify(snapshots(run.input).map((s, i) => ({ repository: s.name, path: "/work/" + s.name, approvedBase: s.commit, diffBase: mainBases[s.name] ?? repositories(run)[i].baseCommit ?? s.commit, checkpoint: repositories(run)[i].commit })))}.
${step.kind === "review" ? "Review ALL candidate repositories together, including integration between them. Every candidate must remain unchanged during review." : "Implement ONLY " + activeSnapshot(run).name + ". Other candidate checkouts are available for reading and paired tests; do not edit them. The controller works through repositories sequentially, then reviews the whole set. Intermediate repositories may defer paired browser acceptance until the final repository is implemented; report what remains honestly. On revision, fix findings affecting this repository; leave already-correct work intact."}
${snapshots(run.input)
  .map(
    (s) =>
      s.name +
      ": " +
      (profiles?.[s.name] ?? repositoryProfile(s.name)).instructions,
  )
  .join("\n")}
Playwright MCP is registered as playwright in this guest. Exercise the approved UI behavior using real local/synthetic fixtures, inspect rendering and browser errors. Save screenshots and full evidence to /work/evidence. The final implementation must include browser evidence for the combined feature. Controller validation runs each repository's established checks; also implement and run all acceptance tests required by the plan, including paired tests. Explain unavailable external integration tests honestly.
Each implementation attempt for the final repository must run Playwright MCP in this attempt and save its browser evidence, even when no source changes are needed or Tim withdraws a requested change. Earlier screenshots alone do not satisfy this check. If the previous collection failed because browser checks were missing, preserve the saved code, perform the missing browser checks, and return their evidence paths. Do not invent code changes merely to complete this step.
Central logging: every SDK event and tool result is captured. Your workspace's redacted log mirror is /work/logs/structured/coding.jsonl with full JSON payloads in /work/logs/artifacts; use normal read/search tools to investigate previous failures. The same events are indexed in the main Logs UI under this coding step. Test/app output may be saved under /work/evidence for diagnosis.
${step.kind === "review" ? "Review the actual git diff from the Diff base and the saved validation/browser evidence. Do not edit source or commit. Re-run targeted checks where useful. Return only unresolved findings, with file evidence and actionable recommendations. Any critical/high/medium finding requires revise; low findings may remain. Use needs_direction for a real unresolved human decision. Verify prior fixes independently." : "Implement or revise the approved feature. Read prior code reviews and failures below. Return implemented after this repository’s approved work and its available checks are complete; the final repository must complete combined acceptance. Return browserEvidence as the paths to evidence you actually saved."}
${composeInstructions(readPromptSettings(directory), "coding", null, snapshots(run.input))}
Approved Plan v${run.version} (${run.input.planHash}):
${run.plan.markdown}
${
  run.change_requests?.length
    ? `Tim's Saved Code Change Requests (chronological; the last request is this revision):
${JSON.stringify(run.change_requests)}
Apply the latest request to the existing implementation, preserving earlier accepted changes. These are authorized refinements to the approved feature, not permission for unrelated scope. If the request requires a material scope change, return needs_direction for a revised plan. Claude must verify the latest request against the code and fresh validation evidence. The controller will update the same open PR after validation and review; do not publish it yourself.`
    : ""
}
Previous Coding Steps (complete results):
${JSON.stringify(history)}
${
  run.direction_responses?.length
    ? `Tim's Replies to Coding Questions (chronological):
${JSON.stringify(run.direction_responses)}
Apply these replies to the saved work. A later reply may clarify or withdraw an earlier code change request. Respect an explicitly accepted operational tradeoff; do not repeatedly block on that same accepted concern. These replies do not authorize unrelated scope, deployment, merging, or skipping validation and review. Both Codex and Claude must assess the implementation against the clarified requirements. If material scope expands beyond the approved feature, request a revised plan.`
    : ""
}`;
}
export async function runGuestAgent(
  workspace: Workspace,
  step: CodingStep,
  input: Record<string, unknown>,
  signal: AbortSignal,
  log: Log,
  onEvent: () => void,
  receiptPath: string,
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
        if (message.type === "result") {
          result = message.value;
          writeReceipt(receiptPath, {
            result: result as Record<string, unknown>,
            browserCalls: [...browserCalls],
          });
        }
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
    return { result: result as Record<string, unknown>, browserCalls };
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
  const command = guestCommands(
    workspace,
    signal,
    log,
    activeSnapshot(run).name,
  );
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
    activeSnapshot(run).name,
    ...(workspace.environments ? ["--environments"] : []),
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
