import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import type { Db } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { resolveRepositoryEnvironment } from "@code-assist/secrets";
import type { RepositorySnapshot } from "./discovery.ts";
import { workspaceLogEnvironment } from "./workspace-environment.ts";
import { bootstrap, environmentLauncher } from "./workspace-bootstrap.ts";
import { ensureGuestRuntime, verifyGuestBrowser } from "./workspace-runtime.ts";
import { bundleGitDependency } from "./workspace-git-dependencies.ts";

import { snapshots } from "./coding-repositories.ts";
import {
  loadRepositoryProfile,
  profileEnvironment,
  type RuntimeProfile,
} from "./repository-settings.ts";

export class WorkspaceApprovalError extends Error {}
export type WorkspaceInput = {
  issueId: string;
  planningId: string;
  version: number;
  planHash: string;
  inputHash: string;
  snapshot: RepositorySnapshot;
  snapshots?: RepositorySnapshot[];
};
export type WorkspaceSources = {
  snapshot: RepositorySnapshot;
  snapshots?: RepositorySnapshot[];
};
export type Workspace<T extends WorkspaceSources = WorkspaceInput> = {
  id: string;
  machine: string;
  input: T;
  profiles?: Record<string, RuntimeProfile>;
  source?: RepositorySnapshot;
  sources?: RepositorySnapshot[];
  environments?: boolean;
  state: "preparing" | "ready" | "failed" | "destroyed";
  stage: string;
  createdAt: string;
  updatedAt: string;
  variables: string[];
  checks?: { name: string; status: "running" | "passed" | "failed" }[];
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
async function save(directory: string, workspace: Workspace<WorkspaceSources>) {
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
    throw new WorkspaceApprovalError(
      "A current, approved plan is required to prepare a coding workspace.",
    );
  const snapshots: RepositorySnapshot[] = row.snapshots;
  if (
    !snapshots?.length ||
    new Set(snapshots.map((s) => s.name)).size !== snapshots.length
  )
    throw new WorkspaceApprovalError(
      "Approved repositories must be present and unique.",
    );
  for (const snapshot of snapshots)
    if (
      !/^[a-f0-9]{40,64}$/.test(snapshot.commit) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(snapshot.name)
    )
      throw new Error("Invalid approved repository or source commit.");
  return {
    issueId,
    planningId: row.planning_id,
    version: row.current_version,
    planHash: row.plan_hash,
    inputHash: row.input_hash,
    snapshot: snapshots[0],
    ...(snapshots.length > 1 ? { snapshots } : {}),
  };
}

async function workspaceCommand(
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
  onCreated?: (workspace: Workspace) => Promise<void>,
  sourceOverride?: RepositorySnapshot | RepositorySnapshot[],
) {
  const input = await approvedWorkspaceInput(db, issueId);
  const sources = sourceOverride
    ? Array.isArray(sourceOverride)
      ? sourceOverride
      : [sourceOverride]
    : snapshots(input);
  return provisionWorkspace(directory, input, sources, signal, {
    onCreated,
    issueId,
    assertCurrent: async () => {
      const current = await approvedWorkspaceInput(db, issueId);
      if (JSON.stringify(current) !== JSON.stringify(input))
        throw new Error(
          "Approved inputs changed during workspace preparation.",
        );
    },
  });
}

export async function provisionWorkspace<T extends WorkspaceSources>(
  directory: string,
  input: T,
  sources: RepositorySnapshot[],
  signal: AbortSignal,
  options: {
    onCreated?: (workspace: Workspace<T>) => Promise<void>;
    assertCurrent?: () => Promise<void>;
    issueId?: string;
    profiles?: Record<string, RuntimeProfile>;
    testSetup?: boolean;
  } = {},
) {
  const {
    onCreated,
    assertCurrent,
    issueId,
    profiles: frozenProfiles,
    testSetup = false,
  } = options;
  const repositories = input.snapshots ?? [input.snapshot];
  const profiles =
    frozenProfiles ??
    Object.fromEntries(
      repositories.map((s) => [
        s.name,
        loadRepositoryProfile(directory, s.source),
      ]),
    );
  const source = sources[0];
  const environments = Object.fromEntries(
    repositories.map((s) => [
      s.name,
      profileEnvironment(
        profiles[s.name],
        resolveRepositoryEnvironment(directory, s.source),
      ),
    ]),
  );
  const environment = Object.fromEntries(
    Object.entries(environments).flatMap(([name, env]) =>
      Object.entries(env).map(([key, value]) => [name + "_" + key, value]),
    ),
  );
  const id = randomUUID();
  const workspace: Workspace<T> = {
    profiles,
    id,
    machine: `ca-${id}`,
    input,
    source,
    sources,
    environments: true,
    state: "preparing",
    stage: "creating machine",
    createdAt: new Date().toISOString(),
    updatedAt: "",
    variables: Object.keys(environment).sort(),
  };
  await save(directory, workspace);
  await onCreated?.(workspace);
  const log = createLogger(
    "workspace",
    {
      environment: workspaceLogEnvironment({ ...process.env, ...environment }),
    },
    {
      attempt_id: id,
      ticket_id: issueId,
      repository_commit: source.commit,
    },
  );
  const output = (line: string) =>
    log.payload("workspace.output", workspace.stage, { output: line });
  const orb = (args: string[], content?: string | Readable) =>
    workspaceCommand("/usr/local/bin/orb", args, signal, output, content);
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
      "Preparing repository source in an OrbStack machine",
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
    await stage("copying repository source");
    for (const source of sources) {
      await workspaceCommand(
        "/usr/bin/git",
        [
          "-C",
          source.source,
          "archive",
          "--format=tar",
          `--output=${archive}`,
          source.commit,
        ],
        signal,
        output,
      );
      await guest(["mkdir", "-p", `/work/${source.name}`]);
      await guest(
        ["tar", "-xf", "-", "-C", `/work/${source.name}`],
        createReadStream(archive),
      );
      await rm(archive);
    }
    await stage("configuring attempt environment");
    await guest(["mkdir", "-p", "/work/environments"]);
    for (const [name, env] of Object.entries(environments)) {
      await guest(
        [
          "bash",
          "-c",
          'umask 077; cat > "$1"',
          "bash",
          "/work/environments/" + name + ".json",
        ],
        JSON.stringify(env),
      );
    }
    await guest(
      ["bash", "-c", "umask 077; cat > /work/environment.json"],
      JSON.stringify(environments[source.name]),
    );
    await guest(
      ["bash", "-c", "cat > /work/repositories.json"],
      JSON.stringify(
        Object.fromEntries(sources.map((s) => [s.name, profiles[s.name].cwd])),
      ),
    );
    await guest(["mkdir", "-p", "/etc/code-assist"]);
    await guest(
      ["bash", "-c", "umask 022; cat > /etc/code-assist/profiles.json"],
      JSON.stringify(profiles),
    );
    await guest(
      ["bash", "-c", "umask 077; cat > /work/run.mjs"],
      environmentLauncher,
    );
    await guest(["chown", "-R", "workspace:workspace", "/work"]);
    const dependencies = new Map<
      string,
      { source: string; commits: Set<string> }
    >();
    for (const repository of repositories) {
      for (const dependency of profiles[repository.name].configuration
        .gitDependencies ?? []) {
        const source = join(dirname(repository.source), dependency.repository);
        const previous = dependencies.get(dependency.repository);
        if (previous && previous.source !== source)
          throw new Error("Conflicting Git dependency sources.");
        const combined = previous ?? { source, commits: new Set<string>() };
        for (const commit of dependency.commits) combined.commits.add(commit);
        dependencies.set(dependency.repository, combined);
      }
    }
    for (const [name, dependency] of dependencies) {
      await stage(`copying pinned Git dependency ${name}`);
      const bundle = join(folder(directory, id), "dependency.bundle");
      try {
        const origin = await bundleGitDependency(
          dependency.source,
          [...dependency.commits],
          bundle,
          folder(directory, id),
          signal,
        );
        const target = `/opt/code-assist/dependencies/${name}.git`;
        await guest(
          ["bash", "-c", "cat > /tmp/code-assist-dependency.bundle"],
          createReadStream(bundle),
        );
        await guest([
          "git",
          "clone",
          "--bare",
          "/tmp/code-assist-dependency.bundle",
          target,
        ]);
        await guest(["chmod", "-R", "a+rX", target]);
        await guest([
          "git",
          "config",
          "--system",
          "--add",
          "safe.directory",
          target,
        ]);
        await guest([
          "git",
          "config",
          "--system",
          `url.file://${target}.insteadOf`,
          origin,
        ]);
        await guest(["rm", "/tmp/code-assist-dependency.bundle"]);
      } finally {
        await rm(bundle, { force: true });
      }
    }
    for (const source of sources) {
      const profile = profiles[source.name];
      const run = (args: string[]) =>
        orb([
          "-m",
          workspace.machine,
          "-u",
          "workspace",
          "node",
          "/work/run.mjs",
          "--repo",
          source.name,
          ...args,
        ]);
      if (profile.configuration.systemSetupScript) {
        await stage("installing system dependencies for " + source.name);
        await guest([
          "node",
          "/work/run.mjs",
          "--repo",
          source.name,
          "bash",
          "-euc",
          profile.configuration.systemSetupScript,
        ]);
      }
      await stage("preparing " + source.name);
      for (const args of profile.setup) await run(args);
      if (profile.browserDirectory) {
        await stage("installing browser for " + source.name);
        await guest([
          "bash",
          "-c",
          'cd "$1" && pnpm exec playwright install-deps chromium',
          "bash",
          profile.browserDirectory,
        ]);
        await run(profile.browserInstall);
      }
    }
    workspace.checks ??= [];
    async function check(name: string, action: () => Promise<void>) {
      const result = {
        name,
        status: "running" as "running" | "passed" | "failed",
      };
      workspace.checks!.push(result);
      await stage(name);
      try {
        await action();
        result.status = "passed";
      } catch (error) {
        result.status = "failed";
        throw error;
      } finally {
        await save(directory, workspace);
      }
    }
    await check("shared browser readiness", () =>
      ensureGuestRuntime(
        folder(directory, id),
        guest,
        (args, content) =>
          orb(["-m", workspace.machine, "-u", "workspace", ...args], content),
        signal,
      ).then(() => {}),
    );
    for (const source of sources) {
      const profile = profiles[source.name];
      const run = (args: string[]) =>
        orb([
          "-m",
          workspace.machine,
          "-u",
          "workspace",
          "node",
          "/work/run.mjs",
          "--repo",
          source.name,
          ...args,
        ]);
      await check(`browser readiness (${source.name})`, () =>
        verifyGuestBrowser(run),
      );
      if (testSetup) {
        await check("validation", async () => {
          for (const args of profile.validation) await run(args);
        });
        const config = profile.configuration;
        if (config.startScript) {
          await check("app startup", () =>
            guest([
              "systemd-run",
              "--quiet",
              "--collect",
              "--unit=ca-setup-app",
              "--uid=workspace",
              "--property=KillMode=control-group",
              "node",
              "/work/run.mjs",
              "--repo",
              source.name,
              "bash",
              "-euc",
              config.startScript,
            ]),
          );
          await check("app readiness", () =>
            run(["bash", "-euc", config.readyScript]),
          );
        }
        if (config.smokeScript)
          await check("browser/authentication smoke test", () =>
            run(["bash", "-euc", config.smokeScript]),
          );
      }
    }
    await assertCurrent?.();
    workspace.state = "ready";
    await stage("ready");
    log.event("info", "workspace.ready", "Repository workspace ready", {
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
    if (
      testSetup &&
      !signal.aborted &&
      sources.some((s) => profiles[s.name].configuration.startScript)
    ) {
      try {
        await guest(["journalctl", "--unit=ca-setup-app", "--no-pager"]);
      } catch {
        /* The machine or app unit may not have been created. */
      }
    }
    await rm(archive, { force: true });
  }
}

export async function workspaceExists(machine: string, signal: AbortSignal) {
  const { stdout } = await promisify(execFile)(
    "/usr/local/bin/orb",
    ["list", "--quiet"],
    { signal },
  );
  return stdout.split(/\r?\n/).includes(machine);
}

export async function destroyWorkspace(
  directory: string,
  id: string,
  signal: AbortSignal,
) {
  const workspace = await readWorkspace(directory, id);
  if (workspace.state === "destroyed") return workspace;
  if (await workspaceExists(workspace.machine, signal))
    await workspaceCommand(
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
