import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bundleGitDependency } from "../src/workspace-git-dependencies.ts";

test("pinned dependencies preserve exact commits without source credentials or untracked files", async () => {
  const root = join(import.meta.dirname, "../../../.tmp/git-dependency-tests");
  mkdirSync(root, { recursive: true });
  const temp = mkdtempSync(join(root, "bundle-"));
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    const source = join(temp, "source");
    git("init", source);
    git("-C", source, "config", "user.name", "Fixture");
    git("-C", source, "config", "user.email", "fixture@example.invalid");
    git(
      "-C",
      source,
      "remote",
      "add",
      "origin",
      "git@github.com:Example/private-modules.git",
    );
    git("-C", source, "config", "credential.helper", "NEVER_COPY_THIS");
    writeFileSync(join(source, "module.tf"), "first");
    git("-C", source, "add", "module.tf");
    git("-C", source, "commit", "-m", "first");
    const first = git("-C", source, "rev-parse", "HEAD");
    writeFileSync(join(source, "module.tf"), "second");
    git("-C", source, "commit", "-am", "second");
    const second = git("-C", source, "rev-parse", "HEAD");
    writeFileSync(join(source, ".env"), "SECRET=fixture-not-exported");
    const bundle = join(temp, "source.bundle");
    assert.equal(
      await bundleGitDependency(
        source,
        [first, second],
        bundle,
        temp,
        new AbortController().signal,
      ),
      "https://github.com/Example/private-modules.git",
    );
    const clone = join(temp, "clone");
    git("clone", bundle, clone);
    assert.equal(git("-C", clone, "show", first + ":module.tf"), "first");
    assert.equal(git("-C", clone, "show", second + ":module.tf"), "second");
    assert.doesNotMatch(
      readFileSync(join(clone, ".git/config"), "utf8"),
      /NEVER_COPY_THIS/,
    );
    assert.throws(() => git("-C", clone, "show", second + ":.env"));
    await assert.rejects(
      bundleGitDependency(
        source,
        ["a".repeat(40)],
        join(temp, "missing.bundle"),
        temp,
        new AbortController().signal,
      ),
    );
    git(
      "-C",
      source,
      "remote",
      "set-url",
      "origin",
      "https://token@github.com/Example/private-modules.git",
    );
    await assert.rejects(
      bundleGitDependency(
        source,
        [first],
        bundle,
        temp,
        new AbortController().signal,
      ),
      /credential-free/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
