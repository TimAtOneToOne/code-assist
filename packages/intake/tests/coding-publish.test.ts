import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@code-assist/observability";
import { checkCodingBranch, publishCoding } from "../src/coding-publish.ts";
import { executeCoding, codingPrompt } from "../src/coding-runtime.ts";
import { cleanupFixture } from "./fixtures/cleanup.ts";

test("code revisions fast-forward the owned PR, recover a lost push response, and preserve its description", async () => {
  const fixture = await cleanupFixture();
  const { directory, source, path } = fixture;
  const origin = join(directory, "origin.git");
  const remote = "https://github.com/example/fixture.git";
  const prUrl = "https://github.com/example/fixture/pull/1";
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", source, ...args], {
      encoding: "utf8",
    }).trim();
  const signal = new AbortController().signal;
  const log = createLogger("publication-test", {
    logDirectory: join(directory, "logs"),
    artifactDirectory: join(directory, "artifacts"),
  });
  try {
    const base = fixture.run.commit!;
    git("remote", "add", "origin", remote);
    git("update-ref", "refs/heads/main", base);
    execFileSync("/usr/bin/git", [
      "clone",
      "--quiet",
      "--bare",
      source,
      origin,
    ]);
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "update-ref",
      `refs/heads/${fixture.run.branch}`,
      base,
    ]);
    await writeFile(join(source, "feature.txt"), "requested revision\n");
    git("add", "feature.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "revision",
    );
    const candidate = git("rev-parse", "HEAD");
    execFileSync("/usr/bin/git", [
      "--git-dir",
      join(path, "repository.git"),
      "fetch",
      "--quiet",
      source,
      "HEAD",
    ]);
    const request = {
      id: randomUUID(),
      text: "Use a clearer confirmation.",
      requestedBy: "owner",
      createdAt: new Date().toISOString(),
      baseCommits: { fixture: base },
      pullRequests: { fixture: prUrl },
    };
    await writeFile(
      join(source, "feature.txt"),
      "another contributor's work\n",
    );
    git("add", "feature.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "external work",
    );
    const external = git("rev-parse", "HEAD");
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "fetch",
      "--quiet",
      source,
      "HEAD",
    ]);
    const run = {
      ...fixture.run,
      status: "publish" as const,
      commit: candidate,
      pr_url: prUrl,
      merged_at: null,
      merge_commit: null,
      main_workflows: null,
      change_requests: [request],
    };
    let body = `## Summary\n\nUser-added context stays here.\n\n- fixture: ${base}\n\n<!-- code-assist:${run.id} -->`;
    let state = "OPEN",
      pushes = 0,
      edits = 0,
      losePushResponse = true,
      racePush = false;
    const head = () =>
      execFileSync(
        "/usr/bin/git",
        ["--git-dir", origin, "rev-parse", `refs/heads/${run.branch}`],
        { encoding: "utf8" },
      ).trim();
    const execute: typeof executeCoding = async (
      command,
      args,
      abort,
      logger,
    ) => {
      if (command.endsWith("/gh")) {
        if (args[0] === "repo")
          return JSON.stringify({ defaultBranchRef: { name: "main" } });
        if (args[1] === "edit") {
          body = await readFile(args.at(-1)!, "utf8");
          edits++;
          return "";
        }
        assert(
          ["view", "list"].includes(args[1]),
          "must never open a second PR",
        );
        const pr = {
          state,
          headRefOid: head(),
          baseRefName: "main",
          url: prUrl,
          body,
        };
        return JSON.stringify(args[1] === "list" ? [pr] : pr);
      }
      const isPush = args.includes("push");
      if (isPush) {
        pushes++;
        assert(
          args.includes(`--force-with-lease=refs/heads/${run.branch}:${base}`),
        );
        if (racePush)
          execFileSync("/usr/bin/git", [
            "--git-dir",
            origin,
            "update-ref",
            `refs/heads/${run.branch}`,
            external,
          ]);
      }
      const result = await executeCoding(
        command,
        args.map((arg) => (arg === remote ? origin : arg)),
        abort,
        logger,
      );
      if (isPush && losePushResponse) {
        losePushResponse = false;
        throw new Error("Lost push response");
      }
      return result;
    };
    await checkCodingBranch(run, signal, log, execute);
    for (const invalid of ["MERGED", "CLOSED"]) {
      state = invalid;
      await assert.rejects(
        checkCodingBranch(run, signal, log, execute),
        /merged, closed/,
      );
      await assert.rejects(
        publishCoding(directory, run, signal, log, async () => {}, execute),
        /merged, closed/,
      );
    }
    state = "OPEN";
    const ownedBody = body;
    body = "Somebody else's PR";
    await assert.rejects(
      checkCodingBranch(run, signal, log, execute),
      /merged, closed/,
    );
    body = ownedBody;
    await assert.rejects(
      publishCoding(directory, run, signal, log, async () => {}, execute),
      /Lost push response/,
    );
    assert.equal(head(), candidate);
    assert.equal(
      await publishCoding(directory, run, signal, log, async () => {}, execute),
      prUrl,
    );
    assert.equal(pushes, 1);
    assert.equal(edits, 1);
    assert(body.includes("User-added context stays here."));
    assert(body.includes(`- fixture: ${candidate}`));
    assert(body.includes(request.text));
    await publishCoding(directory, run, signal, log, async () => {}, execute);
    assert.equal(pushes, 1);
    assert.equal(edits, 1);

    // Simulate another writer changing the head between the read and the push.
    await rm(join(path, `publication-${request.id}.json`));
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "update-ref",
      `refs/heads/${run.branch}`,
      base,
    ]);
    racePush = true;
    await assert.rejects(
      publishCoding(directory, run, signal, log, async () => {}, execute),
    );
    assert.equal(head(), external, "another writer's head is not overwritten");
    await assert.rejects(
      checkCodingBranch(run, signal, log, execute),
      /branch changed/,
    );

    const promptRun = {
      ...run,
      workspace_id: null,
      input: {
        ...run.input,
        snapshot: { ...run.input.snapshot, name: "internal-chat-ui" },
      },
      plan: { markdown: "Approved feature", changeSummary: "", responses: [] },
    };
    for (const kind of ["implement", "review"] as const) {
      const prompt = await codingPrompt(
        directory,
        promptRun,
        { ...fixture.steps[0], kind },
        [],
      );
      assert(prompt.includes(request.text));
      assert(prompt.includes("material scope change"));
      assert(prompt.includes("fresh validation evidence"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
