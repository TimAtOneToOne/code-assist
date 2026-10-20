import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Db } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { resolveRepositoryEnvironment } from "@code-assist/secrets";
import type { RepositorySnapshot } from "./discovery.ts";
import { icuEnvironment } from "./workspace-environment.ts";
import { bootstrap, environmentLauncher } from "./workspace-bootstrap.ts";

export type WorkspaceInput = {
  issueId: string;
  planningId: string;
  version: number;
  planHash: string;
  inputHash: string;
  snapshot: RepositorySnapshot;
};
export type Workspace = {
  id: string;
  machine: string;
  input: WorkspaceInput;
  state: "preparing" | "ready" | "failed" | "destroyed";
  stage: string;
  createdAt: string;
  updatedAt: string;
  variables: string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function folder(directory: string, id: string) {
  if (!uuid.test(id)) throw new Error("Invalid workspace ID.");
  return join(directory, "workspaces", id);
}
export async function readWorkspace(
  directory: string,
  id: string,
): Promise<Workspace> {
  const result: Workspace = JSON.parse(
    await readFile(join(folder(directory, id), "workspace.json"), "utf8"),
  );
  if (result.id !== id || result.machine !== `ca-${id}`)
    throw new Error("Invalid workspace record.");
  return result;
}
async function save(directory: string, workspace: Workspace) {
  workspace.updatedAt = new Date().toISOString();
  const path = folder(directory, workspace.id);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const temporary = join(path, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(workspace) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, join(path, "workspace.json"));
}

export async function approvedWorkspaceInput(
  db: Db,
  issueId: string,
): Promise<WorkspaceInput> {
  const { rows } = await db.executeSql(
    `
    SELECT p.id AS planning_id, p.current_version, v.hash AS plan_hash,
      p.input_hash, d.snapshots
    FROM code_assist.intake_issue i
    JOIN code_assist.discovery_run d ON d.id=i.current_discovery_id
    JOIN code_assist.planning_run p ON p.discovery_id=d.id
    JOIN code_assist.plan_version v ON v.run_id=p.id AND v.number=p.current_version
    JOIN code_assist.plan_approval a ON a.run_id=p.id AND a.version=p.current_version
      AND a.plan_hash=v.hash AND a.input_hash=p.input_hash
    WHERE i.id=$1 AND i.eligible AND i.removed_at IS NULL
      AND p.status='approved' AND d.status='ready'`,
    [issueId],
  );
  const row = rows[0];
  if (!row)
    throw new Error(
      "A current, approved plan is required to prepare a coding workspace.",
    );
  const snapshots: RepositorySnapshot[] = row.snapshots;
  if (snapshots?.length !== 1 || snapshots[0].name !== "internal-chat-ui")
    throw new Error(
      "Workspace provisioning currently supports ICU only; this plan needs another repository setup.",
    );
  if (!/^[a-f0-9]{40,64}$/.test(snapshots[0].commit))
    throw new Error("Invalid approved source commit.");
  return {
    issueId,
    planningId: row.planning_id,
    version: row.current_version,
    planHash: row.plan_hash,
    inputHash: row.input_hash,
    snapshot: snapshots[0],
  };
}

async function command(
  executable: string,
  args: string[],
  signal: AbortSignal,
  output: (text: string) => void,
  input?: string | Readable,
) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      // Emit complete lines so a credential split between chunks is still redacted.
      let pending = "";
      stream.on("data", (chunk: string) => {
        pending += chunk;
        let index;
        while ((index = pending.indexOf("\n")) !== -1) {
          output(pending.slice(0, index));
          pending = pending.slice(index + 1);
        }
      });
      stream.on("end", () => {
        if (pending) output(pending);
      });
    }
    child.on("error", reject);
    child.stdin.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "EPIPE") reject(error);
    });
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Workspace command exited ${code}.`)),
    );
    if (typeof input === "string" || !input) child.stdin.end(input);
    else {
      input.on("error", (error) => {
        child.kill();
        reject(error);
      });
      input.pipe(child.stdin);
    }
  });
}

export async function prepareWorkspace(
  directory: string,
  db: Db,
  issueId: string,
  signal: AbortSignal,
) {
  const input = await approvedWorkspaceInput(db, issueId);
  const environment = icuEnvironment(
    resolveRepositoryEnvironment(directory, input.snapshot.source),
  );
  const id = randomUUID();
  const workspace: Workspace = {
    id,
    machine: `ca-${id}`,
    input,
    state: "preparing",
    stage: "creating machine",
    createdAt: new Date().toISOString(),
    updatedAt: "",
    variables: Object.keys(environment).sort(),
  };
  await save(directory, workspace);
  const log = createLogger(
    "workspace",
    { environment: { ...process.env, ...environment } },
    {
      attempt_id: id,
      ticket_id: issueId,
      repository_commit: input.snapshot.commit,
    },
  );
  const output = (line: string) =>
    log.payload("workspace.output", workspace.stage, { output: line });
  const orb = (args: string[], content?: string | Readable) =>
    command("/usr/local/bin/orb", args, signal, output, content);
  const guest = (args: string[], content?: string | Readable) =>
    orb(["-m", workspace.machine, "-u", "root", ...args], content);
  async function stage(name: string) {
    workspace.stage = name;
    await save(directory, workspace);
    log.event("info", "workspace.stage", name);
  }
  const archive = join(folder(directory, id), "source.tar");
  try {
    log.event(
      "info",
      "workspace.created",
      "Preparing approved source in an OrbStack machine",
    );
    await orb([
      "create",
      "--isolated",
      "--isolate-network",
      "ubuntu:24.04",
      workspace.machine,
    ]);
    await stage("installing toolchain and private container engine");
    await guest(["bash", "-c", bootstrap]);
    await stage("copying approved source");
    await command(
      "/usr/bin/git",
      [
        "-C",
        input.snapshot.source,
        "archive",
        "--format=tar",
        `--output=${archive}`,
        input.snapshot.commit,
      ],
      signal,
      output,
    );
    await guest(["mkdir", "-p", "/work/internal-chat-ui"]);
    await guest(
      ["tar", "-xf", "-", "-C", "/work/internal-chat-ui"],
      createReadStream(archive),
    );
    await rm(archive);
    await stage("configuring attempt environment");
    await guest(
      ["bash", "-c", "umask 077; cat > /work/environment.json"],
      JSON.stringify(environment),
    );
    await guest(
      ["bash", "-c", "umask 077; cat > /work/run.mjs"],
      environmentLauncher,
    );
    await guest(["chown", "-R", "workspace:workspace", "/work"]);
    const run = (args: string[]) =>
      orb([
        "-m",
        workspace.machine,
        "-u",
        "workspace",
        "node",
        "/work/run.mjs",
        ...args,
      ]);
    await stage("starting repository services");
    await run([
      "docker",
      "compose",
      "--profile",
      "localstack",
      "up",
      "-d",
      "--wait",
    ]);
    await run([
      "docker",
      "compose",
      "exec",
      "-T",
      "db",
      "createdb",
      "-U",
      "root",
      "icu_test",
    ]);
    await stage("installing repository dependencies");
    await run(["pnpm", "install", "--frozen-lockfile"]);
    await stage("migrating local database");
    await run(["pnpm", "db:migrate"]);
    await stage("installing repository browser");
    // The guest operator installs system dependencies; repository commands run as workspace.
    await guest([
      "bash",
      "-c",
      "cd /work/internal-chat-ui/sveltekit && pnpm exec playwright install-deps chromium",
    ]);
    await run(["pnpm", "exec", "playwright", "install", "chromium"]);
    const current = await approvedWorkspaceInput(db, issueId);
    if (JSON.stringify(current) !== JSON.stringify(input))
      throw new Error("Approved inputs changed during workspace preparation.");
    workspace.state = "ready";
    await stage("ready");
    log.event("info", "workspace.ready", "ICU workspace ready", {
      machine: workspace.machine,
    });
    return workspace;
  } catch (error) {
    workspace.state = "failed";
    await save(directory, workspace);
    log.payload(
      "workspace.failure",
      `Workspace preparation failed during ${workspace.stage}`,
      { error },
      "error",
    );
    throw new Error(
      `Workspace ${id} failed during ${workspace.stage}; inspect its logs and destroy it when finished.`,
      { cause: error },
    );
  } finally {
    await rm(archive, { force: true });
  }
}

export async function destroyWorkspace(
  directory: string,
  id: string,
  signal: AbortSignal,
) {
  const workspace = await readWorkspace(directory, id);
  if (workspace.state === "destroyed") return workspace;
  await command(
    "/usr/local/bin/orb",
    ["delete", "--force", workspace.machine],
    signal,
    () => {},
  );
  workspace.state = "destroyed";
  workspace.stage = "destroyed";
  await save(directory, workspace);
  return workspace;
}
