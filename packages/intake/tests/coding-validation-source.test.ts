import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validationSourceChanges } from "../src/coding-validation-outcome.ts";

test("validation captures tracked, staged and untracked changes without accepting a moved HEAD", async () => {
  const base = resolve("../../.tmp/validation-source-tests");
  await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(join(base, "git-"));
  const git = async (...args: string[]) =>
    (await promisify(execFile)("git", args, { cwd })).stdout.trim();
  try {
    await git("init");
    await git("config", "user.email", "fixture@example.test");
    await git("config", "user.name", "Fixture");
    await writeFile(join(cwd, "lockfile"), "original\n");
    await git("add", ".");
    await git("commit", "-m", "baseline");
    const head = await git("rev-parse", "HEAD");
    assert.equal(await validationSourceChanges(git, head), undefined);
    await writeFile(join(cwd, "lockfile"), "original\nlinux-checksum\n");
    let changes = await validationSourceChanges(git, head);
    assert.match(changes!.diff, /\+linux-checksum/);
    await git("add", "lockfile");
    changes = await validationSourceChanges(git, head);
    assert.match(changes!.status, /M\s+lockfile/);
    assert.match(changes!.diff, /\+linux-checksum/);
    await writeFile(join(cwd, "generated"), "new file");
    assert.match(
      (await validationSourceChanges(git, head))!.status,
      /\?\? generated/,
    );
    await git("commit", "-m", "unexpected commit");
    await assert.rejects(
      validationSourceChanges(git, head),
      /moved the saved commit/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
