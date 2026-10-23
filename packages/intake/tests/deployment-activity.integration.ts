import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { initializeIntake } from "../src/store.ts";
import { deploymentActivity } from "../src/deployment-activity.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");

test("deployment inspection reads durable jobs and steps without reconciling or changing them", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_deploy_" + randomUUID().replaceAll("-", "");
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
    const db = boss.getDb();
    const issue = randomUUID(),
      discovery = randomUUID(),
      planning = randomUUID(),
      step = randomUUID();
    await db.executeSql(
      "INSERT INTO code_assist.intake_issue(id,ticket,suggestions,eligible) VALUES($1,'{}','[]',true)",
      [issue],
    );
    await db.executeSql(
      "INSERT INTO code_assist.discovery_run(id,issue_id,job_id,input_hash,ticket,repositories,status) VALUES($1,$2,$3,'hash','{}','[]','questions')",
      [discovery, issue, randomUUID()],
    );
    await db.executeSql(
      "INSERT INTO code_assist.planning_run(id,issue_id,discovery_id,input_hash,status) VALUES($1,$2,$3,'hash','awaiting_approval')",
      [planning, issue, discovery],
    );
    assert.deepEqual(
      await deploymentActivity(url.toString()),
      { jobs: [], steps: [] },
      "Human waits do not count as active work",
    );

    const job = await boss.send(
      "adversarial-planning",
      { stepId: step },
      { startAfter: new Date(Date.now() + 86400000) },
    );
    await db.executeSql(
      "INSERT INTO code_assist.planning_step(id,run_id,job_id,kind,version,input,status) VALUES($1,$2,$3,'draft',1,'{}','queued')",
      [step, planning, job],
    );
    await db.executeSql(
      "UPDATE code_assist.planning_run SET current_step_id=$2,status='drafting' WHERE id=$1",
      [planning, step],
    );
    const queued = await deploymentActivity(url.toString());
    assert.equal(queued.jobs[0].id, job);
    assert.equal(queued.jobs[0].state, "created");
    assert.equal(queued.steps[0].id, step);
    assert.equal(queued.steps[0].status, "queued");
    assert.deepEqual(
      await deploymentActivity(url.toString()),
      queued,
      "Inspection must not reconcile or claim queued work",
    );

    await boss.cancel("adversarial-planning", job!);
    await db.executeSql(
      "UPDATE code_assist.planning_run SET status='superseded' WHERE id=$1",
      [planning],
    );
    assert.deepEqual(
      await deploymentActivity(url.toString()),
      { jobs: [], steps: [] },
      "Superseded history with a cancelled queue record is not running work",
    );
    await db.executeSql(
      "UPDATE code_assist.planning_run SET status='drafting' WHERE id=$1",
      [planning],
    );
    assert.equal(
      (await deploymentActivity(url.toString())).steps.length,
      1,
      "Unfinished current steps remain visible even if the job is missing or terminal",
    );
    await db.executeSql("DROP TABLE code_assist.repository_setup_test");
    await assert.rejects(
      () => deploymentActivity(url.toString()),
      "Failed inspection must not become an empty activity report",
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
