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
} from "../src/planning.ts";
import {
  codingQueue,
  syncApprovedCoding,
  startCoding,
  finishCoding,
  readCoding,
  failCoding,
  retryCoding,
  answerCodingDirection,
} from "../src/coding.ts";
import { finishValidation } from "../src/coding-validation-outcome.ts";
import { finishAcceptance } from "../src/acceptance-outcome.ts";
import { assessAcceptance, acceptanceReady } from "../src/acceptance.ts";
import { deploymentActivity } from "../src/deployment-activity.ts";
import type {
  AcceptanceResult,
  ToolEvidence,
} from "../src/acceptance-types.ts";

test("acceptance persists missing evidence, resumes saved attempts, pauses for prerequisites and advances complete evidence to review", async () => {
  const adminUrl = process.env.TEST_DATABASE_URL!;
  assert(adminUrl);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_acceptance_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  const boss = new PgBoss({
    connectionString: url.toString(),
    schedule: false,
    supervise: false,
  });
  boss.on("error", () => {});
  try {
    await boss.start();
    await initializeIntake(boss);
    const ticket = {
      id: randomUUID(),
      identifier: "ONE-999999",
      title: "API fixture",
      description: "Acceptance integration fixture",
      url: "https://example.invalid",
      updatedAt: new Date().toISOString(),
      labels: ["Plan"],
      comments: [],
    };
    const source = { name: "api", path: "/fixture/api", github: null };
    await recordScan(boss, await requestScan(boss), [ticket], [source]);
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
              name: "api",
              source: source.path,
              directory: source.path,
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
      {
        markdown: "# API",
        changeSummary: "API",
        responses: [],
        additionalValidation: [],
        acceptanceScenarios: [
          {
            id: "contract",
            title: "API Contract",
            repositories: ["api"],
            method: "command",
            procedure: "Assert API response",
            expectedOutcome: "Invalid input is rejected",
          },
        ],
      },
      {
        summary: "Fixture",
        disposition: "ready",
        directionQuestion: "",
        findings: [],
      },
    ]) {
      const [j] = await boss.fetch<{ stepId: string }>(planningQueue);
      const s = (await startPlanningStep(boss, j.data.stepId, j.id))!;
      await finishPlanningStep(boss, s, result);
    }
    const plan = (await readPlanning(boss.getDb(), ticket.id))[0];
    await approvePlan(
      boss,
      ticket.id,
      plan.id,
      1,
      plan.versions[0].hash,
      [],
      "fixture",
    );
    await syncApprovedCoding(boss);
    const next = async () => {
      const [j] = await boss.fetch<{ stepId: string }>(codingQueue);
      assert(j);
      const work = await startCoding(boss, j.data.stepId, j.id);
      assert(work);
      return work;
    };
    let work = await next();
    await finishCoding(
      boss,
      work.run,
      work.step,
      {},
      "validate",
      "b".repeat(40),
      randomUUID(),
    );
    work = await next();
    await finishValidation(boss, work.run, work.step, {
      commit: work.run.commit!,
      commands: { test: 0 },
      passed: true,
    });
    work = await next();
    assert.equal(work.step.kind, "accept");
    assert(
      (await deploymentActivity(url.toString())).steps.some(
        (s) => s.id === work.step.id,
      ),
    );
    const tool: ToolEvidence = {
      id: "assertion",
      name: "make test-api",
      kind: "command",
      succeeded: true,
    };
    async function collect(result: AcceptanceResult) {
      const continuation = {
        kind: "accept" as const,
        agentStepId: work.step.id,
        result: result as unknown as Record<string, unknown>,
        browserCalls: [],
        tools: [tool],
      };
      await finishCoding(
        boss,
        work.run,
        work.step,
        result as unknown as Record<string, unknown>,
        "checkpoint",
        undefined,
        undefined,
        undefined,
        undefined,
        continuation,
      );
      work = await next();
      await finishCoding(
        boss,
        work.run,
        work.step,
        {},
        "collect",
        undefined,
        undefined,
        undefined,
        undefined,
        continuation,
      );
      work = await next();
      return assessAcceptance(work.run, continuation.agentStepId, result, [
        tool,
      ]);
    }
    const missing = await collect({
      summary: "Missing scenario",
      scenarios: [],
    });
    assert.equal(missing.passed, false);
    await failCoding(
      boss,
      work.run,
      work.step,
      "Transient evidence copy failure",
    );
    await retryCoding(boss, ticket.id, work.run.id, work.step.id);
    await boss.stop();
    await boss.start();
    work = await next();
    assert.equal(work.step.kind, "collect");
    assert.equal(work.step.continuation!.agentStepId, missing.attemptId);
    assert.deepEqual(work.step.continuation!.tools, [tool]);
    await finishAcceptance(boss, work.run, work.step, missing, "saved.tar.gz");
    const omitted = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(omitted.status, "implement");
    assert.equal(acceptanceReady(omitted, omitted.steps), false);
    assert.equal(
      await finishAcceptance(
        boss,
        work.run,
        work.step,
        missing,
        "saved.tar.gz",
      ),
      false,
    );
    work = await next();
    await finishCoding(boss, work.run, work.step, {}, "accept");
    work = await next();
    const blocked = await collect({
      summary: "Missing local database",
      scenarios: [
        {
          id: "contract",
          status: "blocked",
          observed: "Local database fixture is unavailable",
          toolCallIds: [],
          artifacts: [],
        },
      ],
    });
    await finishAcceptance(
      boss,
      work.run,
      work.step,
      blocked,
      "blocked.tar.gz",
    );
    const paused = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(paused.status, "needs_direction");
    assert.equal((await boss.fetch(codingQueue)).length, 0);
    await answerCodingDirection(
      boss,
      ticket.id,
      paused.id,
      work.step.id,
      "Use the configured local fixture.",
      "fixture",
    );
    work = await next();
    await finishCoding(boss, work.run, work.step, {}, "accept");
    work = await next();
    const passed = await collect({
      summary: "API assertion passed",
      scenarios: [
        {
          id: "contract",
          status: "passed",
          observed: "422 and unchanged database row count",
          toolCallIds: ["assertion"],
          artifacts: [],
        },
      ],
    });
    await finishAcceptance(boss, work.run, work.step, passed, "passed.tar.gz");
    const ready = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(ready.status, "review");
    assert(acceptanceReady(ready, ready.steps));
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
