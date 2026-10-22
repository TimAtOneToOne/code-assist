import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { createLogger } from "@code-assist/observability";
import type { CodingRun } from "./coding-types.ts";
import {
  activeSnapshot,
  repositoryDirectory,
  commitSet,
} from "./coding-repositories.ts";
import { executeCoding } from "./coding-runtime.ts";
export class CodingBranchConflict extends Error {}
export async function checkCodingBranch(
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
  execute = executeCoding,
) {
  const remote = await execute(
    "/usr/bin/git",
    ["-C", activeSnapshot(run).source, "remote", "get-url", "origin"],
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
    await execute(
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
        "number,state,headRefOid,baseRefName,url,body",
      ],
      signal,
      log,
    ),
  ) as PublishedPr[];
  const branch = await execute(
    "/usr/bin/git",
    ["ls-remote", "--heads", remote, `refs/heads/${run.branch}`],
    signal,
    log,
  );
  const request = run.change_requests?.at(-1);
  if (request) {
    verifyRevisionPr(
      run,
      prs,
      branch.split(/\s+/)[0],
      request.baseCommits[activeSnapshot(run).name],
    );
    return;
  }
  if (prs.length || branch)
    throw new CodingBranchConflict(
      "The requested branch already exists or has PR history. Choose a fresh branch in the coding panel.",
    );
}

type PublishedPr = {
  state: string;
  headRefOid: string;
  baseRefName: string;
  url: string;
  body: string;
};

function verifyRevisionPr(
  run: CodingRun,
  prs: PublishedPr[],
  remoteHead: string,
  expectedHead: string,
) {
  const request = run.change_requests?.at(-1);
  if (
    !request ||
    !expectedHead ||
    prs.length !== 1 ||
    prs[0].state !== "OPEN" ||
    prs[0].url !== request.pullRequests[activeSnapshot(run).name] ||
    !prs[0].body.includes(`<!-- code-assist:${run.id} -->`) ||
    prs[0].headRefOid !== expectedHead ||
    remoteHead !== expectedHead
  ) {
    throw new CodingBranchConflict(
      "The PR was merged, closed, or its branch changed since this code request. Saved work is preserved; reconcile the PR before continuing.",
    );
  }
}
export async function publishCoding(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  log: ReturnType<typeof createLogger>,
  assertCurrent: () => Promise<void>,
  execute = executeCoding,
) {
  if (!run.commit || !/^[a-f0-9]{40}$/.test(run.commit))
    throw new Error("No validated commit to publish.");
  const local = repositoryDirectory(directory, run),
    bare = join(local, "repository.git");
  const git = (args: string[]) =>
    execute("/usr/bin/git", ["--git-dir", bare, ...args], signal, log);
  const remote = (
    await execute(
      "/usr/bin/git",
      ["-C", activeSnapshot(run).source, "remote", "get-url", "origin"],
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
    execute("/opt/homebrew/bin/gh", args, signal, log);
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
  ) as PublishedPr[];
  const request = run.change_requests?.at(-1);
  if (request) {
    const expectedHead = request.baseCommits[activeSnapshot(run).name];
    const intentFile = join(local, `publication-${request.id}.json`);
    const intent = {
      commit: run.commit,
      base,
      expectedHead,
      url: request.pullRequests[activeSnapshot(run).name],
    };
    let saved: typeof intent | undefined;
    try {
      saved = JSON.parse(await readFile(intentFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      saved &&
      (saved.commit !== intent.commit ||
        saved.base !== base ||
        saved.expectedHead !== expectedHead ||
        saved.url !== intent.url)
    )
      throw new Error(
        "Revision publication intent no longer matches this candidate.",
      );
    const remoteHead = (
      await git(["ls-remote", "--heads", remote, `refs/heads/${run.branch}`])
    ).split(/\s+/)[0];
    // A saved intent permits reconciliation after a successful push whose response was lost.
    const alreadyPushed = !!saved && remoteHead === run.commit;
    verifyRevisionPr(
      run,
      prs,
      remoteHead,
      alreadyPushed ? run.commit : expectedHead,
    );
    if (prs[0].baseRefName !== base)
      throw new CodingBranchConflict(
        "The PR base changed. Reconcile it before updating the branch.",
      );
    await git(["merge-base", "--is-ancestor", expectedHead, run.commit]);
    if (!alreadyPushed) {
      await git(["fetch", remote, `refs/heads/${base}`]);
      await git(["merge-tree", "--write-tree", "FETCH_HEAD", run.commit]);
      await assertCurrent();
      if (!saved)
        await writeFile(intentFile, JSON.stringify(intent), {
          mode: 0o600,
          flag: "wx",
        });
      // Recheck PR state after validation/fetch work, immediately before the guarded push.
      const currentPr = JSON.parse(
        await gh([
          "pr",
          "view",
          intent.url,
          "--json",
          "state,headRefOid,baseRefName,url,body",
        ]),
      ) as PublishedPr;
      verifyRevisionPr(run, [currentPr], remoteHead, expectedHead);
      if (currentPr.baseRefName !== base)
        throw new CodingBranchConflict(
          "The PR base changed. Reconcile it before updating the branch.",
        );
      await assertCurrent();
      await git([
        "push",
        `--force-with-lease=refs/heads/${run.branch}:${expectedHead}`,
        remote,
        `${run.commit}:refs/heads/${run.branch}`,
      ]);
    }
    await assertCurrent();
    const revisionMarker = `<!-- code-assist-change:${request.id} -->`;
    if (!prs[0].body.includes(revisionMarker)) {
      let body = prs[0].body;
      for (const [name, commit] of Object.entries(commitSet(run)))
        if (request.baseCommits[name])
          body = body.replace(
            `- ${name}: ${request.baseCommits[name]}`,
            `- ${name}: ${commit}`,
          );
      body += `\n\n**Requested Changes:**\n\n${request.text}\n\nUpdated after fresh validation and Claude review. [Revision evidence](http://100.91.0.83:3000/tickets/${run.issue_id}).\n\n${revisionMarker}\n`;
      const bodyFile = join(local, `pull-request-${request.id}.md`);
      await writeFile(bodyFile, body, { mode: 0o600 });
      await gh(["pr", "edit", intent.url, "--body-file", bodyFile]);
    }
    return intent.url;
  }
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
    run.repair?.baseCommit ?? activeSnapshot(run).commit,
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
    `## Summary\n\n${run.repair ? "Repairs a failed main workflow for" : "Implements"} ${run.identifier}: ${run.title}, following approved plan v${run.version}.${
      run.repair
        ? `\n\nFailure evidence: ${run.repair.workflows.runs
            .filter((r) => r.conclusion && r.conclusion !== "success")
            .map((r) => `[${r.name}, attempt ${r.run_attempt}](${r.html_url})`)
            .join(", ")}. Corrective base: ${run.repair.baseCommit}.`
        : ""
    }\n\nValidation: the repository’s configured checks passed; browser evidence and Claude’s combined adversarial review are recorded for the candidate commits below.\n\n${Object.entries(
      commitSet(run),
    )
      .map(([name, commit]) => `- ${name}: ${commit}`)
      .join(
        "\n",
      )}\n\n**Optional optimizations and controls:** none.\n\n[Code Assist plan, validation and review](http://100.91.0.83:3000/tickets/${run.issue_id})\n\n${marker}\n`,
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
      `${run.repair ? "fix" : "feat"}: ${run.title}`,
      "--body-file",
      body,
    ])
  ).trim();
}
