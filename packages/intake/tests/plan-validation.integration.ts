import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createLogger } from "@code-assist/observability";
import {
  emptyRepositorySetup,
  writeRepositorySetup,
} from "../src/repository-settings.ts";
import {
  provisionWorkspace,
  destroyWorkspace,
  type Workspace,
} from "../src/workspace.ts";
import {
  prepareCodingSource,
  setupCodingRuntime,
  validation,
  guestCommands,
} from "../src/coding-runtime.ts";
import type { CodingRun, CodingStep } from "../src/coding-types.ts";

test(
  "guest validation executes approved new tests alongside pinned checks on the exact commit",
  { skip: process.env.TEST_ORBSTACK !== "1" },
  async () => {
    const root = join(
      import.meta.dirname,
      "../../../.tmp/plan-validation-tests",
    );
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "orb-"));
    const repo = join(directory, "fixture");
    await mkdir(join(repo, "app"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git("init", "--quiet");
    git("config", "user.name", "Validation Fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, "app/source.mjs"), "export const value = 1;\n");
    await writeFile(
      join(repo, "app/baseline.mjs"),
      "export const baseline = true;\n",
    );
    await writeFile(
      join(repo, "app/test.mjs"),
      "import assert from 'node:assert/strict'; import { value } from './source.mjs'; assert.equal(process.env.FIXTURE, 'scoped'); assert.equal(value, 2);\n",
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "Failing additional test fixture");
    const commit = git("rev-parse", "HEAD");
    const snapshot = { name: "fixture", source: repo, directory: repo, commit };
    const extra =
      'test "$FIXTURE" = scoped\ntest "${FIXTURE}" = scoped\nprintf "%s" "literal %i"\nnode test.mjs';
    const run: CodingRun = {
      issue_id: randomUUID(),
      planning_id: randomUUID(),
      version: 1,
      identifier: "ONE-5321",
      title: "Validation Fixture",
      status: "validate",
      current_step_id: randomUUID(),
      workspace_id: null,
      error: null,
      pr_url: null,
      github_checked_at: null,
      github_error: null,
      merged_at: null,
      merge_commit: null,
      pr_closed_at: null,
      main_workflows: null,
      parent_run_id: null,
      repair_key: null,
      repair: null,
      created_at: new Date(),
      id: randomUUID(),
      input: {
        issueId: randomUUID(),
        planningId: randomUUID(),
        version: 1,
        planHash: "fixture",
        inputHash: "fixture",
        snapshot,
      },
      plan: {
        markdown: "# Fixture",
        changeSummary: "Add an acceptance test",
        responses: [],
        additionalValidation: [{ repository: "fixture", script: extra }],
      },
      branch: "fixture-validation",
      commit,
    };
    const config = {
      ...emptyRepositorySetup(),
      workingDirectory: "app",
      validationScript: "node --check baseline.mjs",
      environment: { FIXTURE: "scoped" },
    };
    writeRepositorySetup(directory, repo, config);
    const log = createLogger("coding", {
      logDirectory: join(directory, "logs"),
      artifactDirectory: join(directory, "artifacts"),
    });
    const signal = new AbortController().signal;
    let workspace: Workspace | undefined;
    const previousLogs = process.env.CODE_ASSIST_LOG_DIR;
    const previousArtifacts = process.env.CODE_ASSIST_ARTIFACT_DIR;
    process.env.CODE_ASSIST_LOG_DIR = join(directory, "logs");
    process.env.CODE_ASSIST_ARTIFACT_DIR = join(directory, "artifacts");
    try {
      const source = await prepareCodingSource(directory, run, signal, log);
      workspace = await provisionWorkspace(
        directory,
        run.input,
        [source],
        signal,
        {
          onCreated: async (w) => {
            workspace = w;
          },
        },
      );
      await setupCodingRuntime(directory, run, workspace, signal, log);
      const cmd = guestCommands(workspace, signal, log, "fixture");
      const check = () =>
        validation(
          directory,
          run,
          { id: randomUUID() } as CodingStep,
          workspace!,
          signal,
          log,
        );
      const failed = await check();
      assert.equal(failed.commit, commit);
      assert.equal(failed.commands["bash -euc node --check baseline.mjs"], 0);
      assert.equal(failed.commands[`Plan 1: ${extra}`], 1);
      assert.equal(failed.passed, false);
      await cmd.guest(
        ["bash", "-c", "cat > /work/fixture/app/source.mjs"],
        "export const value = 2;\n",
      );
      await cmd.git("add", ".");
      await cmd.git("commit", "-m", "Correct fixture implementation");
      run.commit = await cmd.git("rev-parse", "HEAD");
      assert.notEqual(run.commit, commit);
      const passed = await check();
      assert.equal(passed.commit, run.commit);
      assert.equal(passed.passed, true);
      await cmd.guest(
        ["bash", "-c", "cat > /work/fixture/app/baseline.mjs"],
        "export const broken = ;\n",
      );
      await cmd.git("add", ".");
      await cmd.git("commit", "-m", "Deliberate pinned-check failure");
      run.commit = await cmd.git("rev-parse", "HEAD");
      const baseFailed = await check();
      assert.equal(baseFailed.commands[`Plan 1: ${extra}`], 0);
      assert.notEqual(
        baseFailed.commands["bash -euc node --check baseline.mjs"],
        0,
      );
      assert.equal(baseFailed.passed, false);
      run.plan.additionalValidation = [
        { repository: "fixture", script: "echo '// changed' >> source.mjs" },
      ];
      await assert.rejects(check(), /Validation changed the reviewed source/);
      const pinned = JSON.parse(
        await readFile(
          join(directory, "workspaces", workspace.id, "workspace.json"),
          "utf8",
        ),
      );
      assert.deepEqual(pinned.profiles.fixture.configuration, config);
      console.log(JSON.stringify({ failed, passed, baseFailed }));
    } finally {
      if (workspace) await destroyWorkspace(directory, workspace.id, signal);
      if (previousLogs === undefined) delete process.env.CODE_ASSIST_LOG_DIR;
      else process.env.CODE_ASSIST_LOG_DIR = previousLogs;
      if (previousArtifacts === undefined)
        delete process.env.CODE_ASSIST_ARTIFACT_DIR;
      else process.env.CODE_ASSIST_ARTIFACT_DIR = previousArtifacts;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
