import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { initializeIntake } from "../src/store.ts";
import {
  emptyRepositorySetup,
  writeRepositorySetup,
} from "../src/repository-settings.ts";
import {
  requestSetupTest,
  readSetupTests,
  runSetupTest,
  setupTestQueue,
} from "../src/repository-setup-tests.ts";
import { readWorkspace } from "../src/workspace.ts";

test(
  "OrbStack setup runs system/user commands, starts and checks an app, records failures, and removes both machines",
  { skip: process.env.TEST_ORBSTACK !== "1" },
  async () => {
    const adminUrl = process.env.TEST_DATABASE_URL;
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
    const root = join(
      import.meta.dirname,
      "../../../.tmp/repository-workspace-tests",
    );
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "orb-"));
    const priorArtifacts = process.env.CODE_ASSIST_ARTIFACT_DIR;
    process.env.CODE_ASSIST_ARTIFACT_DIR = join(directory, "artifacts");
    const repo = join(directory, "fixture");
    await mkdir(repo);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git("init", "--quiet");
    await writeFile(
      join(repo, "app.mjs"),
      `import http from 'node:http'; http.createServer((req,res)=>res.end('fixture-ready')).listen(5173,'127.0.0.1');`,
    );
    git("add", "app.mjs");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    git("remote", "add", "origin", "git@github.com:Example/setup-fixture.git");
    git("config", "credential.helper", "must-not-be-copied");
    const dependencyCommit = git("rev-parse", "HEAD");
    await writeFile(join(repo, ".env"), "SECRET=not-in-git-bundle");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const database = "setup_orb_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    const boss = new PgBoss({
      connectionString: url.toString(),
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => {});
    const config = {
      ...emptyRepositorySetup(),
      gitDependencies: [{ repository: "fixture", commits: [dependencyCommit] }],
      systemSetupScript: 'test "$(id -u)" = 0\ntouch /tmp/system-installed',
      setupScript: 'test "$(id -u)" != 0\ntest -f /tmp/system-installed',
      validationScript:
        'test "$FIXTURE" = "local"\ntest "${#SESSION_SECRET}" = 64\ntest ! -w /etc/code-assist/profiles.json\nnode --check app.mjs\nmkdir -p .tmp\ngit clone https://github.com/Example/setup-fixture.git .tmp/dependency\ntest ! -e .tmp/dependency/.env\ntest ! -w /opt/code-assist/dependencies/fixture.git/config\n! git -C .tmp/dependency config --get credential.helper',
      startScript: "node app.mjs",
      readyScript:
        "curl --retry 20 --retry-delay 1 --retry-connrefused --fail http://127.0.0.1:5173",
      smokeScript: 'test "$(curl -fsS http://127.0.0.1:5173)" = fixture-ready',
      environment: { FIXTURE: "local" },
      generatedVariables: ["SESSION_SECRET"],
    };
    try {
      await boss.start();
      await initializeIntake(boss);
      for (const shouldFail of [false, true]) {
        writeRepositorySetup(
          directory,
          repo,
          shouldFail
            ? {
                ...config,
                validationScript: "echo deliberate-validation-failure; exit 37",
              }
            : config,
        );
        const id = await requestSetupTest(boss, directory, repo);
        await boss.fetch(setupTestQueue);
        if (shouldFail)
          await assert.rejects(
            runSetupTest(boss, directory, id, new AbortController().signal),
            /setup test failed/,
          );
        else
          await runSetupTest(boss, directory, id, new AbortController().signal);
        const result = (await readSetupTests(boss, directory, repo)).find(
          (t) => t.job_id === id,
        )!;
        assert.equal(result.status, shouldFail ? "failed" : "passed");
        assert.ok(result.cleaned_at);
        assert.equal(result.cleanup_error, null);
        assert.equal(result.checks[0].status, shouldFail ? "failed" : "passed");
        if (!shouldFail)
          assert.deepEqual(
            result.checks.map((c) => c.status),
            ["passed", "passed", "passed", "passed"],
          );
        const workspace = await readWorkspace(directory, result.workspace_id!);
        assert.equal(workspace.state, "destroyed");
        assert.equal(
          JSON.parse(
            await readFile(
              join(directory, "workspaces", workspace.id, "workspace.json"),
              "utf8",
            ),
          ).profiles.fixture.configuration.validationScript,
          shouldFail
            ? "echo deliberate-validation-failure; exit 37"
            : config.validationScript,
        );
        console.log(
          JSON.stringify({
            setupTest: id,
            status: result.status,
            checks: result.checks,
            cleaned: !!result.cleaned_at,
          }),
        );
      }
    } finally {
      if (priorArtifacts === undefined)
        delete process.env.CODE_ASSIST_ARTIFACT_DIR;
      else process.env.CODE_ASSIST_ARTIFACT_DIR = priorArtifacts;
      await boss.stop();
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
