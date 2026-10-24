import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  initializeIntake,
  recordScan,
  requestScan,
  selectRepositories,
  readWorkItem,
} from "../src/store.ts";
import {
  discoveryQueue,
  startDiscovery,
  finishDiscovery,
  answerDiscovery,
  readDiscovery,
} from "../src/discovery.ts";
import { planningQueue, startPlanningStep } from "../src/planning.ts";
import { planningPrompt } from "../src/planning-agent.ts";
import {
  emptyRepositorySetup,
  repositorySetupContext,
  readRepositorySetup,
  writeRepositorySetupLocked,
} from "../src/repository-settings.ts";
import {
  requestSetupTest,
  setupTestQueue,
  registerSetupTestWorker,
  readSetupTests,
} from "../src/repository-setup-tests.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("setup answers resume intake before planning; candidate tests pin inputs and recover after restart", async () => {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/repository-setup-discovery",
  );
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "integration-"));
  const database = "setup_intake_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl!);
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
    const repository = {
      name: "fixture",
      path: "/repos/fixture",
      github: null,
    };
    const ticket = {
      id: randomUUID(),
      identifier: "ONE-5321",
      title: "Setup fixture",
      description: "Synthetic onboarding test",
      url: "https://linear.app/onetoonehealth/issue/ONE-5321",
      updatedAt: new Date().toISOString(),
      labels: ["Plan"],
      comments: [],
    };
    await recordScan(boss, await requestScan(boss), [ticket], [repository]);
    await selectRepositories(
      boss,
      ticket.id,
      [repository.path],
      ticket.updatedAt,
    );
    const [job] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const first = (await startDiscovery(boss, job.data.runId, job.id))!;
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET setup_pending=true WHERE id=$1",
        [first.id],
      );
    await finishDiscovery(boss, first, {
      summary: "Setup needs a credential mapping.",
      findings: [],
      questions: [
        {
          question: "Map SERVICE_TOKEN in Secrets?",
          context: "Required by the documented test command.",
          options: [],
        },
      ],
    });
    await answerDiscovery(
      boss,
      ticket.id,
      first.id,
      ["Mapped in Secrets"],
      "Use synthetic test services.",
    );
    assert.equal(
      (await readDiscovery(boss.getDb(), first.id))!.status,
      "superseded",
    );
    assert.deepEqual((await readDiscovery(boss.getDb(), first.id))!.answers, [
      "Mapped in Secrets",
    ]);
    assert.equal((await boss.fetch(planningQueue)).length, 0);
    const nextId = (await readWorkItem(boss.getDb(), ticket.id))!
      .current_discovery_id;
    assert.notEqual(nextId, first.id);
    const [nextJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const next = (await startDiscovery(boss, nextJob.data.runId, nextJob.id))!;
    const config = {
      ...emptyRepositorySetup(),
      validationScript: "npm run lint\nnpm test",
      environment: { SERVICE_TOKEN: "do-not-expose" },
    };
    const contexts = { [repository.path]: repositorySetupContext(config) };
    const snapshots = [
      {
        name: repository.name,
        source: repository.path,
        directory: "/snapshots/fixture",
        commit: "a".repeat(40),
      },
    ];
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET snapshots=$2,repository_setups=$3 WHERE id=$1",
        [next.id, JSON.stringify(snapshots), JSON.stringify(contexts)],
      );
    await finishDiscovery(boss, next, {
      summary: "Ready for scope confirmation.",
      findings: [],
      questions: [],
    });
    await answerDiscovery(boss, ticket.id, next.id, [], "Confirmed");
    const [planJob] = await boss.fetch<{ stepId: string }>(planningQueue);
    const step = (await startPlanningStep(
      boss,
      planJob.data.stepId,
      planJob.id,
    ))!;
    assert.deepEqual(step.input.discovery.repository_setups, contexts);
    assert.match(planningPrompt(step), /npm run lint/);
    assert(!planningPrompt(step).includes("do-not-expose"));
    const testId = await requestSetupTest(boss, directory, repository.path, {
      configuration: config,
      commit: snapshots[0].commit,
      discoveryId: next.id,
    });
    assert.equal((await boss.fetch(setupTestQueue)).length, 0);
    assert.equal(
      readRepositorySetup(directory, repository.path).configuration,
      null,
    );
    const [record] = await readSetupTests(boss, directory, repository.path);
    assert.equal(record.commit, snapshots[0].commit);
    assert.deepEqual(record.configuration, config);
    await registerSetupTestWorker(
      boss,
      directory,
      new AbortController().signal,
    );
    const interrupted = (
      await readSetupTests(boss, directory, repository.path)
    ).find((r) => r.job_id === testId)!;
    assert.equal(interrupted.status, "failed");
    assert.match(interrupted.error!, /Worker restarted/);
    await boss.offWork(setupTestQueue);
    const owner = await boss.getDb().beginTransaction!();
    const automatic = await boss.getDb().beginTransaction!();
    const ownerConfig = { ...config, validationScript: "make owner-checks" };
    await writeRepositorySetupLocked(
      owner.db,
      directory,
      repository.path,
      ownerConfig,
    );
    const accepted = writeRepositorySetupLocked(
      automatic.db,
      directory,
      repository.path,
      config,
      true,
    );
    await owner.commit();
    assert.deepEqual(await accepted, ownerConfig);
    await automatic.commit();
    assert.deepEqual(
      readRepositorySetup(directory, repository.path).configuration,
      ownerConfig,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
});
