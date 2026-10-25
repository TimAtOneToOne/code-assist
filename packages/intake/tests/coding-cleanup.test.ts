import assert from "node:assert/strict";
import { test } from "node:test";
import { rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLogger } from "@code-assist/observability";
import {
  assertCleanupEvidence,
  verifySavedCoding,
  verifyCleanupManifest,
  fileHash,
} from "../src/coding-cleanup.ts";
import { cleanupFixture } from "./fixtures/cleanup.ts";

const signal = new AbortController().signal;
const log = createLogger("cleanup-test");
test("cleanup requires the final reviewed checkpoints and every repository's successful main workflow", async () => {
  const f = await cleanupFixture();
  try {
    assertCleanupEvidence(f.run, f.steps);
    assert.throws(
      () =>
        assertCleanupEvidence({ ...f.run, commit: "b".repeat(40) }, f.steps),
      /review and validation/,
    );
    assert.throws(
      () =>
        assertCleanupEvidence(
          { ...f.run, merge_commit: "b".repeat(40) },
          f.steps,
        ),
      /completion rule/,
    );
    const mergeOnly = {
      ...f.run,
      input: {
        ...f.run.input,
        completionRules: { [f.run.input.snapshot.name]: "merge" as const },
      },
      main_workflows: null,
    };
    assertCleanupEvidence(mergeOnly, f.steps);
    assert.throws(
      () =>
        assertCleanupEvidence({ ...mergeOnly, merge_commit: null }, f.steps),
      /merge evidence/,
    );
    assert.throws(
      () =>
        assertCleanupEvidence(
          f.run,
          f.steps.map((s) => ({ ...s, result: { passed: true } })),
        ),
      /missing its saved evidence/,
    );
    const states = ["fixture", "other"].map((name) => ({
      name,
      status: "done" as const,
      commit: f.run.commit,
      merge_commit: f.run.commit,
      main_workflows: f.run.main_workflows,
      pr_url: null,
    }));
    const multiSteps = [
      ...f.steps.map((s) => ({
        ...s,
        repository_index: 0,
        input_commits: { fixture: f.run.commit, other: f.run.commit },
      })),
      { ...f.steps[1], repository_index: 1 },
    ];
    const multi = {
      ...f.run,
      repositories: states,
      input: {
        ...f.run.input,
        snapshots: [
          f.run.input.snapshot,
          { ...f.run.input.snapshot, name: "other" },
        ],
      },
    };
    assertCleanupEvidence(multi, multiSteps);
    assert.throws(
      () =>
        assertCleanupEvidence(
          {
            ...multi,
            repositories: [states[0], { ...states[1], status: "pr_open" }],
          },
          multiSteps,
        ),
      /Every repository/,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
test("cleanup verifies retained Git objects and archives; evidence remains readable without a VM", async () => {
  const f = await cleanupFixture();
  try {
    await verifySavedCoding(f.directory, f.run, f.steps, signal, log);
    const checkout = join(f.directory, "restored");
    execFileSync("/usr/bin/git", [
      "clone",
      "--quiet",
      join(f.path, "repository.git"),
      checkout,
    ]);
    assert.equal(
      await readFile(join(checkout, "feature.txt"), "utf8"),
      "retained code\n",
    );
    await writeFile(f.evidence, "truncated archive");
    await assert.rejects(
      verifySavedCoding(f.directory, f.run, f.steps, signal, log),
    );
    await rm(join(f.path, "repository.git"), { recursive: true });
    await assert.rejects(
      verifySavedCoding(f.directory, f.run, f.steps, signal, log),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
test("recovery after VM deletion requires an intact archive bound to the exact run, workspace and commits", async () => {
  const f = await cleanupFixture();
  try {
    const archive = join(f.path, "workspace-final-evidence.tar.gz");
    await writeFile(archive, await readFile(f.evidence));
    const manifest = {
      version: 1,
      runId: f.run.id,
      workspaceId: f.run.workspace_id,
      archivedAt: new Date().toISOString(),
      archive,
      sha256: await fileHash(archive),
      repositories: [{ name: "fixture", commit: f.run.commit }],
    };
    const file = join(f.path, "workspace-cleanup.json");
    await writeFile(file, JSON.stringify(manifest));
    await verifyCleanupManifest(f.directory, f.run, signal, log);
    await assert.rejects(
      verifyCleanupManifest(
        f.directory,
        { ...f.run, workspace_id: "another-workspace" },
        signal,
        log,
      ),
      /manifest/,
    );
    await writeFile(archive, "partial overwrite");
    await assert.rejects(
      verifyCleanupManifest(f.directory, f.run, signal, log),
      /manifest/,
    );
    await rm(file);
    await assert.rejects(
      verifyCleanupManifest(f.directory, f.run, signal, log),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
