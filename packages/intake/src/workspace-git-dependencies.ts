import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const execute = promisify(execFile);

// Bundles contain Git objects and refs, never the source checkout's config,
// credential helper, hooks, working files, or untracked .env files.
export async function bundleGitDependency(
  repository: string,
  commits: string[],
  bundle: string,
  temporaryRoot: string,
  signal: AbortSignal,
) {
  const git = (...args: string[]) => execute("/usr/bin/git", args, { signal });
  const { stdout } = await git("-C", repository, "remote", "get-url", "origin");
  const match = stdout
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
    );
  if (!match)
    throw new Error("Git dependency needs a credential-free GitHub origin.");
  const temporary = await mkdtemp(join(temporaryRoot, "dependency-"));
  try {
    await git("init", "--bare", temporary);
    for (const commit of commits) {
      if (!/^[a-f0-9]{40}$/.test(commit))
        throw new Error("Invalid dependency commit.");
      await git(
        "--git-dir",
        temporary,
        "fetch",
        repository,
        `${commit}:refs/heads/pinned/${commit}`,
      );
    }
    await git(
      "--git-dir",
      temporary,
      "symbolic-ref",
      "HEAD",
      `refs/heads/pinned/${commits[0]}`,
    );
    await git("--git-dir", temporary, "bundle", "create", bundle, "--all");
    return `https://github.com/${match[1]}.git`;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
