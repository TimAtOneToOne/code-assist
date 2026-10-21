import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  setupTestQueue,
  registerSetupTestWorker,
} from "../src/repository-setup-tests.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("setup jobs pin saved configuration and committed source, retain history, and reconcile interrupted work", async () => {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/repository-setup-tests",
  );
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "integration-"));
  const repo = join(directory, "fixture");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  await writeFile(join(repo, "file"), "fixture");
  git("add", "file");
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
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "setup_test_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  const boss = new PgBoss({
    connectionString: url.toString(),
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => {});
  try {
    await boss.start();
    await initializeIntake(boss);
    const config = {
      ...emptyRepositorySetup(),
      validationScript: "printf original",
    };
    writeRepositorySetup(directory, repo, config);
    const id = await requestSetupTest(boss, directory, repo);
    writeRepositorySetup(directory, repo, {
      ...config,
      validationScript: "printf revised",
    });
    const records = await readSetupTests(boss, directory, repo);
    assert.equal(records[0].configuration.validationScript, "printf original");
    assert.equal(records[0].commit, git("rev-parse", "HEAD"));
    const [job] = await boss.fetch(setupTestQueue, { includeMetadata: true });
    assert.equal(job.id, id);
    assert.equal(job.expireInSeconds, 3600);
    assert.equal(job.retryLimit, 0);
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.repository_setup_test SET status='running' WHERE job_id=$1",
        [id],
      );
    await registerSetupTestWorker(
      boss,
      directory,
      new AbortController().signal,
    );
    const interrupted = (await readSetupTests(boss, directory, repo))[0];
    assert.equal(interrupted.status, "failed");
    assert.match(interrupted.error!, /restarted/);
    assert.equal((await boss.getJobById(setupTestQueue, id))?.state, "failed");
    await boss.offWork(setupTestQueue);
    const next = await requestSetupTest(boss, directory, repo);
    assert.notEqual(next, id);
    const history = await readSetupTests(boss, directory, repo);
    assert.equal(history.length, 2);
    assert.equal(history[0].configuration.validationScript, "printf revised");
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
