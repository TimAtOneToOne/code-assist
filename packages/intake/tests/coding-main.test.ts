import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@code-assist/observability";
import {
  supplyMain,
  mainRef,
  pinnedMainBases,
  requireMainAncestor,
} from "../src/coding-main.ts";
import {
  checkpoint,
  executeCoding,
  type guestCommands,
} from "../src/coding-runtime.ts";
import type { Workspace } from "../src/workspace.ts";
import { cleanupFixture } from "./fixtures/cleanup.ts";

test("main snapshots survive interrupted delivery, conflicts preserve both parents, and checkpoint retries are idempotent", async () => {
  const { directory, source, path, run, steps } = await cleanupFixture();
  const signal = new AbortController().signal;
  const log = createLogger("main-test", {
    logDirectory: join(directory, "logs"),
    artifactDirectory: join(directory, "artifacts"),
  });
  const gitAt = (where: string, ...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", where, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const work = join(directory, "work");
  const guestRepo = join(work, "fixture");
  const remote = "https://github.com/example/fixture.git";
  const workspace = {} as Workspace;
  try {
    await mkdir(work);
    gitAt(source, "remote", "add", "origin", remote);
    gitAt(source, "branch", "-M", "main");
    execFileSync("/usr/bin/git", ["clone", "--quiet", source, guestRepo]);
    gitAt(guestRepo, "checkout", "-b", run.branch);
    gitAt(guestRepo, "config", "user.name", "Fixture");
    gitAt(guestRepo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(guestRepo, "feature.txt"), "feature improvement\n");
    gitAt(guestRepo, "commit", "-am", "feature");
    const feature = gitAt(guestRepo, "rev-parse", "HEAD");
    run.commit = feature;
    await writeFile(join(source, "feature.txt"), "main improvement\n");
    await writeFile(join(source, "infra.txt"), "new infrastructure\n");
    gitAt(source, "add", ".");
    gitAt(
      source,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "upstream",
    );
    const main = gitAt(source, "rev-parse", "HEAD");
    run.change_requests = [
      {
        id: randomUUID(),
        kind: "bring_in_main",
        text: "Bring in main",
        requestedBy: "owner",
        createdAt: new Date().toISOString(),
        baseCommits: { fixture: feature },
        pullRequests: { fixture: "https://github.com/example/fixture/pull/1" },
      },
    ];
    const mapped = (arg: string) =>
      arg === "/work" || arg.startsWith("/work/") ? work + arg.slice(5) : arg;
    const execute: typeof executeCoding = (exe, args, ...rest) =>
      executeCoding(
        exe,
        args.map((a) => (a === remote ? source : a)),
        ...rest,
      );
    const guest: ReturnType<typeof guestCommands>["guest"] = (
      args,
      input,
      onLine,
      outputFile,
    ) =>
      executeCoding(
        args[0],
        args.slice(1).map(mapped),
        signal,
        log,
        input,
        onLine,
        outputFile,
      );
    const commands: ReturnType<typeof guestCommands> = {
      guest,
      root: guest,
      run: guest,
      git: (...args) => guest(["git", "-C", "/work/fixture", ...args]),
    };
    await assert.rejects(
      supplyMain(directory, run, workspace, signal, log, execute, {
        ...commands,
        git: async () => {
          throw new Error("Interrupted guest delivery");
        },
      }),
      /Interrupted guest delivery/,
    );
    await writeFile(join(source, "later.txt"), "arrived after pinning\n");
    gitAt(source, "add", ".");
    gitAt(
      source,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "later main",
    );
    await supplyMain(directory, run, workspace, signal, log, execute, commands);
    assert.equal(gitAt(guestRepo, "rev-parse", mainRef(run)), main);
    assert.deepEqual(await pinnedMainBases(directory, run), { fixture: main });
    assert.equal(gitAt(guestRepo, "rev-parse", "HEAD"), feature);
    assert.equal(gitAt(guestRepo, "status", "--porcelain"), "");
    await supplyMain(directory, run, workspace, signal, log, execute, commands);
    assert.throws(() =>
      gitAt(guestRepo, "merge", "--no-commit", "--no-ff", mainRef(run)),
    );
    await assert.rejects(
      checkpoint(directory, run, steps[0], workspace, signal, log, commands),
      /conflicts remain unresolved/,
    );
    assert(gitAt(guestRepo, "ls-files", "--unmerged"));
    await writeFile(
      join(guestRepo, "feature.txt"),
      "feature improvement with main improvement\n",
    );
    gitAt(guestRepo, "add", "feature.txt");
    const merged = await checkpoint(
      directory,
      run,
      steps[0],
      workspace,
      signal,
      log,
      commands,
    );
    assert.equal(
      gitAt(guestRepo, "show", "-s", "--format=%P", merged),
      `${feature} ${main}`,
    );
    assert.equal(
      await readFile(join(guestRepo, "infra.txt"), "utf8"),
      "new infrastructure\n",
    );
    assert.equal(
      await checkpoint(
        directory,
        run,
        steps[0],
        workspace,
        signal,
        log,
        commands,
      ),
      merged,
    );
    await requireMainAncestor(
      directory,
      { ...run, commit: merged },
      signal,
      log,
    );
    await assert.rejects(
      requireMainAncestor(directory, { ...run, commit: feature }, signal, log),
    );
    assert.equal(gitAt(guestRepo, "status", "--porcelain"), "");

    // Already-up-to-date main is a no-op, with fresh review still required by the request ID.
    gitAt(guestRepo, "merge", "--no-commit", "--no-ff", mainRef(run));
    const nextStep = { ...steps[0], id: randomUUID() };
    assert.equal(
      await checkpoint(
        directory,
        run,
        nextStep,
        workspace,
        signal,
        log,
        commands,
      ),
      merged,
    );

    // A merge can have no tree changes but still needs a commit to record main's ancestry.
    gitAt(source, "reset", "--hard", main);
    gitAt(
      source,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "empty upstream",
    );
    const newMain = gitAt(source, "rev-parse", "HEAD");
    run.change_requests.push({ ...run.change_requests[0], id: randomUUID() });
    await supplyMain(directory, run, workspace, signal, log, execute, commands);
    gitAt(guestRepo, "merge", "--no-commit", "--no-ff", mainRef(run));
    assert.equal(gitAt(guestRepo, "status", "--porcelain"), "");
    const emptyMerge = await checkpoint(
      directory,
      run,
      { ...nextStep, id: randomUUID() },
      workspace,
      signal,
      log,
      commands,
    );
    assert.equal(
      gitAt(guestRepo, "show", "-s", "--format=%P", emptyMerge),
      `${merged} ${newMain}`,
    );
    assert.equal(
      gitAt(guestRepo, "rev-parse", `${emptyMerge}^{tree}`),
      gitAt(guestRepo, "rev-parse", `${merged}^{tree}`),
    );
    assert.equal(
      execFileSync(
        "git",
        ["--git-dir", join(path, "repository.git"), "rev-parse", mainRef(run)],
        { encoding: "utf8" },
      ).trim(),
      newMain,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
