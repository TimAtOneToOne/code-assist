import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  initializeIntake,
  requestScan,
  recordScan,
  selectRepositories,
} from "../src/store.ts";
import {
  discoveryQueue,
  startDiscovery,
  finishDiscovery,
  answerDiscovery,
} from "../src/discovery.ts";
import {
  planningQueue,
  startPlanningStep,
  finishPlanningStep,
  readPlanning,
  approvePlan,
  submitPlanFeedback,
} from "../src/planning.ts";
import {
  codingQueue,
  readCoding,
  startCoding,
  finishCoding,
  failCoding,
  retryCoding,
  currentCoding,
  syncApprovedCoding,
} from "../src/coding.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("coding binds approval, advances exact checkpoints, rejects duplicate/stale results, preserves retry inputs", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_coding_" + randomUUID().replaceAll("-", "");
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
    const ticket = {
      id: randomUUID(),
      identifier: "ONE-999999",
      title: "Fixture",
      description: "Fixture",
      url: "https://example.invalid",
      updatedAt: "2026-10-20T00:00:00.000Z",
      labels: ["Plan"],
      comments: [],
    };
    const source = {
      name: "internal-chat-ui",
      path: "/fixture/internal-chat-ui",
      github: null,
    };
    const scan = await requestScan(boss);
    await recordScan(boss, scan, [ticket], [source]);
    await selectRepositories(boss, ticket.id, [source.path], ticket.updatedAt);
    const [dj] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const d = (await startDiscovery(boss, dj.data.runId, dj.id))!;
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
        [
          d.id,
          JSON.stringify([
            {
              name: source.name,
              source: source.path,
              directory: "/snapshot/icu",
              commit: "a".repeat(40),
            },
          ]),
        ],
      );
    await finishDiscovery(boss, d, {
      summary: "Fixture",
      findings: [],
      questions: [],
    });
    await answerDiscovery(boss, ticket.id, d.id, [], "");
    for (const result of [
      { markdown: "# Plan", changeSummary: "Initial", responses: [] },
      {
        summary: "Ready",
        disposition: "ready",
        directionQuestion: "",
        findings: [],
      },
    ]) {
      const [job] = await boss.fetch<{ stepId: string }>(planningQueue);
      const step = (await startPlanningStep(boss, job.data.stepId, job.id))!;
      await finishPlanningStep(boss, step, result);
    }
    const plan = (await readPlanning(boss.getDb(), ticket.id))[0];
    assert.equal((await readCoding(boss.getDb(), ticket.id)).length, 0);
    await approvePlan(
      boss,
      ticket.id,
      plan.id,
      1,
      plan.versions[0].hash,
      [],
      "fixture-owner",
    );
    await syncApprovedCoding(boss);
    await syncApprovedCoding(boss);
    const runs = await readCoding(boss.getDb(), ticket.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].steps.length, 1);
    assert.equal(runs[0].branch, "feature/one-999999");
    async function next() {
      const [job] = await boss.fetch<{ stepId: string }>(codingQueue);
      assert(job);
      const started = await startCoding(boss, job.data.stepId, job.id);
      assert(started);
      return started;
    }
    const a = await next();
    assert(await currentCoding(boss.getDb(), a.run, a.step));
    assert.equal(await startCoding(boss, a.step.id, a.step.job_id), null);
    assert(
      await finishCoding(
        boss,
        a.run,
        a.step,
        { ready: true },
        "implement",
        "a".repeat(40),
        randomUUID(),
      ),
    );
    assert.equal(
      await finishCoding(boss, a.run, a.step, { ready: true }, "implement"),
      false,
    );
    const b = await next();
    assert.equal(b.step.input_commit, "a".repeat(40));
    await failCoding(boss, b.run, b.step, "Fixture failure");
    await retryCoding(boss, ticket.id, b.run.id, b.step.id);
    const c = await next();
    assert.notEqual(c.step.id, b.step.id);
    assert.equal(c.step.input_commit, b.step.input_commit);
    assert.equal(
      await finishCoding(boss, b.run, b.step, {}, "validate", "b".repeat(40)),
      false,
    );
    assert(
      await finishCoding(
        boss,
        c.run,
        c.step,
        { summary: "Implemented" },
        "validate",
        "b".repeat(40),
      ),
    );
    const validation = await next();
    assert.equal(validation.step.input_commit, "b".repeat(40));
    assert(
      await finishCoding(
        boss,
        validation.run,
        validation.step,
        { passed: true },
        "review",
      ),
    );
    const review = await next();
    await submitPlanFeedback(
      boss,
      ticket.id,
      plan.id,
      1,
      plan.versions[0].hash,
      "Change the requested behavior.",
    );
    assert.equal(
      await currentCoding(boss.getDb(), review.run, review.step),
      false,
    );
    assert.equal(
      await finishCoding(
        boss,
        review.run,
        review.step,
        { ready: true },
        "publish",
      ),
      false,
    );
    await assert.rejects(
      retryCoding(boss, ticket.id, review.run.id, review.step.id),
    );
    const completed = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(completed.commit, "b".repeat(40));
    assert.equal(
      completed.steps.filter((s) => s.status === "completed").length,
      3,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
