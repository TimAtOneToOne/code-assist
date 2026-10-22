import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { CodingRun } from "./coding-types.ts";
import type { Workspace } from "./workspace.ts";
import {
  activeSnapshot,
  repositoryDirectory,
  repositoryRun,
  snapshots,
} from "./coding-repositories.ts";
import { executeCoding, guestCommands } from "./coding-runtime.ts";

export function mainRequest(run: CodingRun) {
  return run.change_requests?.findLast((r) => r.kind === "bring_in_main");
}
export function mainRef(run: CodingRun) {
  const request = mainRequest(run);
  if (!request || !/^[a-f0-9-]{36}$/.test(request.id))
    throw new Error("Missing Bring In Main request.");
  return `refs/code-assist/main/${request.id}`;
}

export async function pinnedMainBases(directory: string, run: CodingRun) {
  const bases: Record<string, string> = {};
  if (!mainRequest(run)) return bases;
  for (const [index, snapshot] of snapshots(run.input).entries()) {
    const { stdout } = await promisify(execFile)("/usr/bin/git", [
      "--git-dir",
      join(
        repositoryDirectory(directory, repositoryRun(run, index)),
        "repository.git",
      ),
      "for-each-ref",
      "--format=%(objectname)",
      mainRef(run),
    ]);
    if (stdout.trim()) bases[snapshot.name] = stdout.trim();
  }
  return bases;
}

// Pin once per request. A retry must not silently merge a different main commit.
export async function supplyMain(
  directory: string,
  run: CodingRun,
  workspace: Workspace,
  signal: AbortSignal,
  log: Parameters<typeof executeCoding>[3],
  execute = executeCoding,
  commands = guestCommands(workspace, signal, log, activeSnapshot(run).name),
) {
  if (run.change_requests?.at(-1)?.kind !== "bring_in_main") return;
  const local = repositoryDirectory(directory, run);
  const ref = mainRef(run);
  const git = (...args: string[]) =>
    execute(
      "/usr/bin/git",
      ["--git-dir", join(local, "repository.git"), ...args],
      signal,
      log,
    );
  let commit = await git("for-each-ref", "--format=%(objectname)", ref);
  if (!commit) {
    const remote = await execute(
      "/usr/bin/git",
      ["-C", activeSnapshot(run).source, "remote", "get-url", "origin"],
      signal,
      log,
    );
    if (
      !/^(?:git@github\.com:|https:\/\/github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
        remote,
      )
    )
      throw new Error(
        "Expected a GitHub repository without embedded credentials.",
      );
    await git("fetch", remote, `refs/heads/main:${ref}`);
    commit = await git("rev-parse", ref);
  }
  const bundle = join(local, `main-${mainRequest(run)!.id}.bundle`);
  await git("bundle", "create", bundle, ref);
  const guestBundle = `/work/main-${mainRequest(run)!.id}.bundle`;
  await commands.guest(
    ["bash", "-c", 'cat > "$1"', "main-bundle", guestBundle],
    createReadStream(bundle),
  );
  await commands.git("fetch", guestBundle, `${ref}:${ref}`);
  await commands.guest(["rm", guestBundle]);
  await rm(bundle);
  log.event(
    "info",
    "coding.main_supplied",
    "Latest main supplied to the coding workspace",
    {
      repository: activeSnapshot(run).name,
      main_commit: commit,
      main_ref: ref,
    },
  );
}

export async function requireMainAncestor(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  log: Parameters<typeof executeCoding>[3],
  execute = executeCoding,
) {
  if (!mainRequest(run)) return;
  await execute(
    "/usr/bin/git",
    [
      "--git-dir",
      join(repositoryDirectory(directory, run), "repository.git"),
      "merge-base",
      "--is-ancestor",
      mainRef(run),
      run.commit!,
    ],
    signal,
    log,
  );
}
