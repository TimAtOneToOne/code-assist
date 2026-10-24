import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  initializeIntake,
  recordScan,
  requestScan,
  selectRepositories,
  readWorkItem,
  dashboard,
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
  syncReadyPlanning,
  approvePlan,
  submitPlanFeedback,
  restartPlanningStep,
  retryPlanning,
  reconcilePlanningFailures,
  type PlanReview,
  type PlanningStep,
} from "../src/planning.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("adversarial planning preserves versions, checkpoints, exact approvals and stale-input fences", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_planning_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  let boss = new PgBoss({
    connectionString: url.toString(),
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => {});
  const ticket = {
    id: randomUUID(),
    identifier: "ONE-999998",
    title: "Soft deletion",
    description: "Delete only owned threads",
    url: "https://example.invalid",
    updatedAt: "2026-10-20T00:00:00.000Z",
    labels: ["Plan"],
    comments: [],
  };
  const repos = [
    { name: "api", path: "/fixture/api", github: null },
    { name: "web", path: "/fixture/web", github: null },
  ];
  const plan = (number: number) => ({
    markdown: `# Plan v${number}\n\nCheck ownership and soft delete.`,
    changeSummary: `Version ${number}`,
    responses: [],
    additionalValidation: [
      { repository: "web", script: `npm run test:v${number}` },
    ],
  });
  const review = (
    severity: "high" | "medium" | "low" | null,
    disposition: PlanReview["disposition"] = "ready",
  ): PlanReview => ({
    summary: "Reviewed against both repositories",
    disposition,
    directionQuestion:
      disposition === "needs_direction" ? "Confirm the product decision" : "",
    findings: severity
      ? [
          {
            id: "ownership",
            severity,
            title: "Ownership",
            detail: "Verify owner before deleting",
            recommendation: "Test foreign thread access",
          },
        ]
      : [],
  });
  async function current() {
    return (await readPlanning(boss.getDb(), ticket.id))[0];
  }
  async function next() {
    const [job] = await boss.fetch<{ stepId: string }>(planningQueue);
    assert(job);
    const step = await startPlanningStep(boss, job.data.stepId, job.id);
    assert(step);
    return step;
  }
  async function complete(step: PlanningStep, value: unknown) {
    assert(await finishPlanningStep(boss, step, value));
    assert.equal(
      (await boss.getJobById(planningQueue, step.job_id))!.state,
      "completed",
    );
  }
  try {
    await boss.start();
    await initializeIntake(boss);
    const scan = await requestScan(boss);
    await recordScan(boss, scan, [ticket], repos);
    await selectRepositories(
      boss,
      ticket.id,
      repos.map((r) => r.path),
      ticket.updatedAt,
    );
    const [dj] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const discovery = (await startDiscovery(boss, dj.data.runId, dj.id))!;
    const snapshots = repos.map((r) => ({
      name: r.name,
      source: r.path,
      directory: `/snapshot/${r.name}`,
      commit: "a".repeat(40),
    }));
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
        [discovery.id, JSON.stringify(snapshots)],
      );
    await finishDiscovery(boss, discovery, {
      summary: "Existing soft deletion",
      findings: [],
      questions: [],
    });
    await answerDiscovery(
      boss,
      ticket.id,
      discovery.id,
      [],
      "Keep existing storage retention.",
    );
    await syncReadyPlanning(boss);
    await answerDiscovery(
      boss,
      ticket.id,
      discovery.id,
      [],
      "Keep existing storage retention.",
    );
    assert.equal((await readPlanning(boss.getDb(), ticket.id)).length, 1);
    let step = await next();
    assert.equal(step.kind, "draft");
    assert.deepEqual(step.input.discovery.snapshots, snapshots);
    assert.equal(
      step.input.discovery.notes,
      "Keep existing storage retention.",
    );
    await boss
      .getDb()
      .executeSql(
        "ALTER TABLE code_assist.intake_event ADD CONSTRAINT fixture_reject CHECK(type <> 'plan_drafted')",
      );
    await assert.rejects(finishPlanningStep(boss, step, plan(1)));
    assert.equal((await current()).versions.length, 0);
    assert.equal(
      (await boss.getJobById(planningQueue, step.job_id))!.state,
      "active",
    );
    await boss
      .getDb()
      .executeSql(
        "ALTER TABLE code_assist.intake_event DROP CONSTRAINT fixture_reject",
      );
    await assert.rejects(
      finishPlanningStep(boss, step, {
        ...plan(1),
        additionalValidation: [
          { repository: "unselected", script: "npm test" },
        ],
      }),
      /invalid plan/,
    );
    await complete(step, plan(1));
    assert.equal(await finishPlanningStep(boss, step, plan(1)), false);
    const v1 = (await current()).versions[0];
    const inputHash = (await current()).input_hash;
    assert.equal(
      v1.hash,
      createHash("sha256")
        .update(JSON.stringify({ input: inputHash, version: 1, plan: plan(1) }))
        .digest("hex"),
    );
    assert.notEqual(
      v1.hash,
      createHash("sha256")
        .update(
          JSON.stringify({
            input: inputHash,
            version: 1,
            plan: { ...plan(1), additionalValidation: [] },
          }),
        )
        .digest("hex"),
    );
    step = await next();
    assert.equal(step.kind, "review");
    assert.equal(step.input.versions[0].hash, v1.hash);
    // A provider claiming ready cannot bypass a blocking finding.
    await complete(step, review("high"));
    assert.equal((await current()).status, "revising");
    await assert.rejects(
      approvePlan(boss, ticket.id, step.run_id, 1, v1.hash, [], "owner"),
    );
    step = await next();
    assert.equal(step.version, 2);
    assert.equal(step.input.versions[0].review!.findings[0].severity, "high");
    await complete(step, plan(2));
    step = await next();
    await restartPlanningStep(boss, step);
    assert.equal(await finishPlanningStep(boss, step, review(null)), false);
    await boss.complete(planningQueue, step.job_id);
    const resumed = await next();
    assert.equal(resumed.kind, "review");
    assert.equal(resumed.version, 2);
    assert.deepEqual(resumed.input, step.input);
    await complete(resumed, review("medium"));
    let run = await current();
    const v2 = run.versions[1];
    assert.equal(run.status, "awaiting_approval");
    assert.equal(run.versions[0].hash, v1.hash);
    assert.equal((await dashboard(boss)).notifications.length, 2);
    await assert.rejects(
      approvePlan(boss, ticket.id, run.id, 2, v2.hash, [], "owner"),
      /Explicitly accept/,
    );
    await assert.rejects(
      approvePlan(boss, ticket.id, run.id, 1, v1.hash, ["ownership"], "owner"),
      /changed/,
    );
    await assert.rejects(
      approvePlan(
        boss,
        ticket.id,
        run.id,
        2,
        "0".repeat(64),
        ["ownership"],
        "owner",
      ),
      /changed/,
    );
    await approvePlan(
      boss,
      ticket.id,
      run.id,
      2,
      v2.hash,
      ["ownership"],
      "tailscale:owner",
    );
    await approvePlan(
      boss,
      ticket.id,
      run.id,
      2,
      v2.hash,
      ["ownership"],
      "tailscale:owner",
    );
    run = await current();
    assert.equal(run.approvals.length, 1);
    assert.equal(run.approvals[0].input_hash, run.input_hash);
    assert.equal((await dashboard(boss)).notifications.length, 1);
    await submitPlanFeedback(
      boss,
      ticket.id,
      run.id,
      2,
      v2.hash,
      "Also cover active runs.",
    );
    await assert.rejects(
      approvePlan(boss, ticket.id, run.id, 2, v2.hash, ["ownership"], "owner"),
    );
    step = await next();
    assert.equal(step.version, 3);
    assert.equal(step.input.feedback[0].note, "Also cover active runs.");
    await boss.fail(planningQueue, step.job_id);
    await reconcilePlanningFailures(boss);
    assert.equal((await current()).status, "failed");
    assert.equal((await dashboard(boss)).notifications.length, 2);
    await retryPlanning(boss, ticket.id, run.id, step.id);
    assert.equal((await dashboard(boss)).notifications.length, 1);
    const retry = await next();
    assert.deepEqual(retry.input, step.input);
    await complete(retry, plan(3));
    step = await next();
    await complete(step, review("high", "needs_direction"));
    assert.equal((await current()).status, "needs_direction");
    assert.equal((await boss.fetch(planningQueue)).length, 0);
    const v3 = (await current()).versions[2];
    await assert.rejects(
      approvePlan(boss, ticket.id, run.id, 3, v3.hash, [], "owner"),
    );
    await submitPlanFeedback(
      boss,
      ticket.id,
      run.id,
      3,
      v3.hash,
      "Cancel active runs before deletion.",
    );
    step = await next();
    await complete(step, plan(4));
    step = await next();
    await complete(step, review(null));
    await boss.stop();
    boss = new PgBoss({
      connectionString: url.toString(),
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => {});
    await boss.start();
    await initializeIntake(boss);
    await syncReadyPlanning(boss);
    run = await current();
    assert.equal(run.versions.length, 4);
    assert.equal(run.approvals.length, 1);
    assert.equal((await boss.fetch(planningQueue)).length, 0);
    const v4 = run.versions[3];
    await selectRepositories(
      boss,
      ticket.id,
      [repos[0].path],
      ticket.updatedAt,
    );
    await assert.rejects(
      approvePlan(boss, ticket.id, run.id, 4, v4.hash, [], "owner"),
      /scope changed/,
    );
    assert.equal((await current()).status, "superseded");
    assert.equal((await dashboard(boss)).notifications.length, 1);
    await recordScan(
      boss,
      scan,
      [{ ...ticket, labels: [], updatedAt: "2026-10-20T01:00:00.000Z" }],
      repos,
    );
    assert.equal((await dashboard(boss)).issues.length, 0);
    assert.equal(
      (await readWorkItem(boss.getDb(), ticket.id))!.planning[0].versions
        .length,
      4,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
