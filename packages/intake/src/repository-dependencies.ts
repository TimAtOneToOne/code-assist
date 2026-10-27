import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepositorySnapshot } from "./discovery.ts";
import type { Repository } from "./repositories.ts";
import type { RepositorySetup } from "./repository-settings.ts";
import { resultSchema } from "./discovery-agent.ts";

const execute = promisify(execFile);
export type DependencyRequest = { repository: string; revision: string };
export type DependencyScan = {
  dependencies: DependencyRequest[];
  questions: { question: string; context: string; options: string[] }[];
};
export const dependencyScanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["dependencies", "questions"],
  properties: {
    dependencies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["repository", "revision"],
        properties: {
          repository: { type: "string" },
          revision: { type: "string" },
        },
      },
    },
    questions: resultSchema.properties.questions,
  },
};

export function dependencyScanPrompt(
  snapshot: RepositorySnapshot,
  available: Repository[],
  dependencies: RepositorySnapshot[],
  configuration: RepositorySetup | null,
) {
  return `Inspect build dependencies for ${snapshot.name}. This is read-only dependency discovery, not implementation or product planning. Read the supplied source archives using native read tools. Do not edit, install, test, contact services, read outside the supplied workspace, or request credentials that the controller already owns.
Find private Git dependencies used by this source's manifests, lockfiles, module declarations and build/setup commands. Use the actual locked commit; if the source uses a tag or branch instead, return that exact ref. Do not choose latest versions or reuse an old saved pin when the source requests a different version. Standard public package-registry downloads are handled by the repository's normal package manager; do not enumerate those as Git dependencies.
Return dependencies as {repository,revision}, using the catalog's exact repository name. The controller reads/fetches the requested version with its existing host Git access and supplies an immutable source archive. It also resolves Git submodules recursively. These are read-only dependency sources, NEVER extra selected repositories, coding targets or PR targets. The controller then copies the exact Git objects into the test environment, where native package-manager Git operations use the local copies without GitHub credentials.
Inspect supplied dependency archives for any further private Git dependencies their builds need. Request missing archives via dependencies, not questions. Return all dependencies required by the selected source; previously supplied sources need not be requested again. Return an empty dependencies array when no further sources are needed. Saved configuration is only a hint: preserve manually declared dependencies still required by current source, but resolve their versions from current source. Do not invent dependencies from documentation examples or unrelated features.
questions is normally empty. Ask only when a required repository/ref cannot be identified from the available evidence or the required repository is absent from the catalog. Explain the concrete missing source in plain language. A dependency archive not supplied yet is NOT proof of missing access. Never ask for BOT_TOKEN or other download credentials merely because the test environment has no credential mapping. The controller will report actual retrieval failures separately.
Selected source: ${JSON.stringify(snapshot)}
Read-only dependency sources already supplied: ${JSON.stringify(dependencies)}
Available repository catalog (names and GitHub identities, not permission to edit): ${JSON.stringify(available.map(({ name, github }) => ({ name, github })))}
Saved dependency/setup guidance (no environment values): ${JSON.stringify(configuration && { gitDependencies: configuration.gitDependencies, setupScript: configuration.setupScript, instructions: configuration.instructions })}`;
}

export class DependencyAccessError extends Error {}

// Only configured clones are used; repository content cannot choose a host path or credential.
export async function materializeDependencies(
  requests: DependencyRequest[],
  available: Repository[],
  root: string,
  signal: AbortSignal,
  existing: RepositorySnapshot[] = [],
): Promise<RepositorySnapshot[]> {
  const snapshots = [...existing];
  const git = async (source: string, ...args: string[]) =>
    (
      await execute("/usr/bin/git", ["-C", source, ...args], { signal })
    ).stdout.trim();
  async function visit(request: DependencyRequest) {
    const repo = available.find((r) => r.name === request.repository);
    if (!repo?.github || !/^[\w.-]+\/[\w.-]+$/.test(repo.github))
      throw new DependencyAccessError(
        `The required repository ${request.repository} is not available in Mia's configured repositories.`,
      );
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(request.revision) ||
      request.revision.includes("..")
    )
      throw new DependencyAccessError(
        `The requested version for ${repo.name} is not a Git commit, tag or branch.`,
      );
    let commit: string | undefined;
    if (/^[a-f0-9]{40}$/.test(request.revision)) {
      try {
        commit = await git(
          repo.path,
          "rev-parse",
          "--verify",
          `${request.revision}^{commit}`,
        );
      } catch {
        signal.throwIfAborted();
      }
    }
    if (!commit) {
      const ref = `refs/code-assist/dependencies/${randomUUID()}`;
      try {
        // Fetch only the required version; never switch or change the synced worktree.
        await git(
          repo.path,
          "fetch",
          "--no-tags",
          "--no-write-fetch-head",
          "origin",
          `${request.revision}:${ref}`,
        );
        commit = await git(repo.path, "rev-parse", `${ref}^{commit}`);
      } catch {
        signal.throwIfAborted();
        throw new DependencyAccessError(
          `Mia could not retrieve ${repo.name} at ${request.revision} using its existing Git access. Check that this version exists and Mia can read that repository. No test-environment credential is needed.`,
        );
      } finally {
        await execute("/usr/bin/git", [
          "-C",
          repo.path,
          "update-ref",
          "-d",
          ref,
        ]);
      }
    }
    if (!/^[a-f0-9]{40}$/.test(commit))
      throw new DependencyAccessError(
        `Invalid source version for ${repo.name}.`,
      );
    if (snapshots.some((s) => s.source === repo.path && s.commit === commit))
      return;
    const destination = join(root, repo.name, commit);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const archive = join(root, `${repo.name}-${commit}.tar`);
    try {
      await git(repo.path, "archive", `--output=${archive}`, commit);
      await execute("/usr/bin/tar", ["-xf", archive, "-C", destination], {
        signal,
      });
    } finally {
      await rm(archive, { force: true });
    }
    snapshots.push({
      name: repo.name,
      source: repo.path,
      commit,
      directory: await realpath(destination),
    });
    const tree = await git(repo.path, "ls-tree", "-r", "-z", commit);
    const links = tree.split("\0").filter((line) => line.startsWith("160000 "));
    if (!links.length) return;
    const paths = await git(
      repo.path,
      "config",
      "--blob",
      `${commit}:.gitmodules`,
      "--null",
      "--get-regexp",
      "^submodule\\..*\\.path$",
    );
    for (const link of links) {
      const tab = link.indexOf("\t");
      const path = link.slice(tab + 1);
      const entry = paths
        .split("\0")
        .find((value) => value.slice(value.indexOf("\n") + 1) === path);
      if (!entry)
        throw new DependencyAccessError(
          `Missing nested-library URL in ${repo.name} for ${path}.`,
        );
      const key = entry
        .slice(0, entry.indexOf("\n"))
        .replace(/\.path$/, ".url");
      const url = await git(
        repo.path,
        "config",
        "--blob",
        `${commit}:.gitmodules`,
        "--get",
        key,
      );
      const resolved =
        url.startsWith("./") || url.startsWith("../")
          ? new URL(url, `https://github.com/${repo.github}.git/`).href
          : url;
      const identity = resolved.match(
        /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
      )?.[1];
      const nested = available.find(
        (r) => r.github?.toLowerCase() === identity?.toLowerCase(),
      );
      if (!nested)
        throw new DependencyAccessError(
          `The ${repo.name} library needs ${identity ?? "an unsupported nested repository"}, which is not in Mia's configured repositories.`,
        );
      await visit({
        repository: nested.name,
        revision: link.slice(0, tab).split(" ")[2],
      });
    }
  }
  for (const request of requests) await visit(request);
  return snapshots;
}

export function dependencyPins(snapshots: RepositorySnapshot[]) {
  const pins: NonNullable<RepositorySetup["gitDependencies"]> = [];
  for (const snapshot of snapshots) {
    let pin = pins.find((p) => p.repository === snapshot.name);
    if (!pin) pins.push((pin = { repository: snapshot.name, commits: [] }));
    if (!pin.commits.includes(snapshot.commit))
      pin.commits.push(snapshot.commit);
  }
  return pins;
}

export async function inspectRepositoryDependencies(
  available: Repository[],
  root: string,
  signal: AbortSignal,
  scan: (sources: RepositorySnapshot[]) => Promise<DependencyScan>,
) {
  let sources: RepositorySnapshot[] = [];
  const requested = new Set<string>();
  while (true) {
    signal.throwIfAborted();
    const result = await scan(sources);
    if (!Array.isArray(result.dependencies) || !Array.isArray(result.questions))
      throw new Error("Invalid dependency inspection result.");
    const next = result.dependencies.filter((request) => {
      if (
        !request ||
        typeof request.repository !== "string" ||
        typeof request.revision !== "string"
      )
        throw new Error("Invalid dependency source request.");
      return !requested.has(
        JSON.stringify([request.repository, request.revision]),
      );
    });
    if (!next.length)
      return {
        sources,
        questions: result.questions,
        pins: dependencyPins(sources),
      };
    sources = await materializeDependencies(
      next,
      available,
      root,
      signal,
      sources,
    );
    for (const request of next)
      requested.add(JSON.stringify([request.repository, request.revision]));
  }
}
