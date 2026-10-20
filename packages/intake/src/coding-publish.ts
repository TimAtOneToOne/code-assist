import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createLogger } from "@code-assist/observability";
import type { CodingRun } from "./coding-types.ts";
import { codingDirectory, executeCoding } from "./coding-runtime.ts";
export class CodingBranchConflict extends Error {}
export async function checkCodingBranch(
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
) {
  const remote = await executeCoding(
    "/usr/bin/git",
    ["-C", run.input.snapshot.source, "remote", "get-url", "origin"],
    signal,
    log,
  );
  const match = remote.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!match)
    throw new Error(
      "Expected a GitHub repository without embedded credentials.",
    );
  const prs = JSON.parse(
    await executeCoding(
      "/opt/homebrew/bin/gh",
      [
        "pr",
        "list",
        "--repo",
        match[1],
        "--state",
        "all",
        "--head",
        run.branch,
        "--json",
        "number,state",
      ],
      signal,
      log,
    ),
  ) as unknown[];
  const branch = await executeCoding(
    "/usr/bin/git",
    ["ls-remote", "--heads", remote, `refs/heads/${run.branch}`],
    signal,
    log,
  );
  if (prs.length || branch)
    throw new CodingBranchConflict(
      "The requested branch already exists or has PR history. Choose a fresh branch in the coding panel.",
    );
}
export async function publishCoding(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
  assertCurrent: () => Promise<void>,
) {
  if (!run.commit || !/^[a-f0-9]{40}$/.test(run.commit))
    throw new Error("No validated commit to publish.");
  const local = codingDirectory(directory, run.id),
    bare = join(local, "repository.git");
  const git = (args: string[]) =>
    executeCoding("/usr/bin/git", ["--git-dir", bare, ...args], signal, log);
  const remote = (
    await executeCoding(
      "/usr/bin/git",
      ["-C", run.input.snapshot.source, "remote", "get-url", "origin"],
      signal,
      log,
    )
  ).trim();
  const match = remote.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
  );
  if (!match)
    throw new Error(
      "Expected a GitHub repository without embedded credentials.",
    );
  const repository = match[1];
  const gh = (args: string[]) =>
    executeCoding("/opt/homebrew/bin/gh", args, signal, log);
  const metadata = JSON.parse(
    await gh(["repo", "view", repository, "--json", "defaultBranchRef"]),
  );
  const base = metadata.defaultBranchRef.name as string;
  const prs = JSON.parse(
    await gh([
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "all",
      "--head",
      run.branch,
      "--json",
      "number,state,headRefOid,baseRefName,url,body",
    ]),
  ) as {
    state: string;
    headRefOid: string;
    baseRefName: string;
    url: string;
    body: string;
  }[];
  const marker = `<!-- code-assist:${run.id} -->`,
    intentFile = join(local, "publication.json");
  let intent: { commit: string; base: string } | undefined;
  try {
    intent = JSON.parse(await readFile(intentFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (prs.length) {
    if (
      prs.length === 1 &&
      prs[0].state === "OPEN" &&
      prs[0].headRefOid === run.commit &&
      prs[0].baseRefName === base &&
      prs[0].body.includes(marker) &&
      intent?.commit === run.commit
    )
      return prs[0].url;
    throw new Error(
      "This branch already has a PR or was previously merged/closed. Tim must choose a new branch or reconcile the existing work.",
    );
  }
  const remoteHead = await git([
    "ls-remote",
    "--heads",
    remote,
    `refs/heads/${run.branch}`,
  ]);
  if (
    remoteHead &&
    (!intent ||
      intent.commit !== run.commit ||
      remoteHead.split(/\s+/)[0] !== run.commit)
  )
    throw new Error(
      "The remote branch contains unexpected work. Publication stopped.",
    );
  await git(["fetch", remote, `refs/heads/${base}`]);
  await git([
    "merge-base",
    "--is-ancestor",
    run.input.snapshot.commit,
    "FETCH_HEAD",
  ]);
  // A merge-tree conflict is a concrete reason to revise, never a license to overwrite main.
  await git(["merge-tree", "--write-tree", "FETCH_HEAD", run.commit]);
  await assertCurrent();
  if (!intent) {
    await writeFile(intentFile, JSON.stringify({ commit: run.commit, base }), {
      mode: 0o600,
      flag: "wx",
    });
    intent = { commit: run.commit, base };
  }
  if (intent.commit !== run.commit || intent.base !== base)
    throw new Error("Publication intent no longer matches this commit.");
  if (!remoteHead) {
    await assertCurrent();
    await git([
      "push",
      `--force-with-lease=refs/heads/${run.branch}:`,
      remote,
      `${run.commit}:refs/heads/${run.branch}`,
    ]);
  }
  await assertCurrent();
  const body = join(local, "pull-request.md");
  await writeFile(
    body,
    `## Summary\n\nImplements ${run.identifier}: ${run.title}, following approved plan v${run.version}.\n\nValidation: repository lint, type checks, tests and production build passed; workspace browser evidence and Claude's adversarial review are recorded for commit ${run.commit}.\n\n**Optional optimizations and controls:** none.\n\n[Code Assist plan, validation and review](http://100.91.0.83:3000/tickets/${run.issue_id})\n\n${marker}\n`,
    { mode: 0o600 },
  );
  return (
    await gh([
      "pr",
      "create",
      "--repo",
      repository,
      "--base",
      base,
      "--head",
      run.branch,
      "--title",
      `feat: ${run.title}`,
      "--body-file",
      body,
    ])
  ).trim();
}
