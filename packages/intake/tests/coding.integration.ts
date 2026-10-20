import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  recordGitHubObservation,
  requestGitHubRefresh,
  refreshGitHub,
  githubQueue,
  type PullRequestState,
} from "../src/github.ts";
import {
  initializeIntake,
  requestScan,
  recordScan,
  selectRepositories,
  dashboard,
  readWorkItem,
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
  changeCodingBranch,
} from "../src/coding.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("coding binds approval, advances exact checkpoints, rejects duplicate/stale results, preserves retry inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code-assist-coding-"));
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
    await assert.rejects(
      changeCodingBranch(
        boss,
        directory,
        ticket.id,
        b.run.id,
        b.step.id,
        "bad branch",
      ),
    );
    await changeCodingBranch(
      boss,
      directory,
      ticket.id,
      b.run.id,
      b.step.id,
      "feature/one-999999-code-assist",
    );
    await assert.rejects(retryCoding(boss, ticket.id, b.run.id, b.step.id));
    const c = await next();
    assert.notEqual(c.step.id, b.step.id);
    assert.equal(c.run.branch, "feature/one-999999-code-assist");
    await mkdir(join(directory, "coding", c.run.id), { recursive: true });
    await writeFile(
      join(directory, "coding", c.run.id, "publication.json"),
      "{}",
    );
    await assert.rejects(
      changeCodingBranch(
        boss,
        directory,
        ticket.id,
        c.run.id,
        c.step.id,
        "feature/one-999999-another",
      ),
      /Reconcile/,
    );
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
    await finishCoding(
      boss,
      review.run,
      review.step,
      { ready: true },
      "publish",
    );
    const publish = await next();
    await finishCoding(
      boss,
      publish.run,
      publish.step,
      { summary: "PR opened" },
      "pr_open",
      undefined,
      undefined,
      "https://github.com/example/icu/pull/1",
    );
    await recordScan(
      boss,
      await requestScan(boss),
      [{ ...ticket, updatedAt: "2026-10-20T18:31:29.238Z" }],
      [source],
    );
    const item = (await readWorkItem(boss.getDb(), ticket.id))!;
    assert.equal(item.current_discovery_id, d.id);
    assert.equal(item.discoveries.length, 1);
    assert.equal(item.planning_status, "approved");
    assert.equal(item.coding_status, "pr_open");
    assert.equal(
      (await dashboard(boss)).issues.find((i) => i.id === ticket.id)!
        .coding_status,
      "pr_open",
    );
    const published = (await readCoding(boss.getDb(), ticket.id))[0];
    const pr: PullRequestState = {
      url: published.pr_url!,
      state: "CLOSED",
      mergedAt: null,
      closedAt: "2026-10-20T20:00:00Z",
      mergeCommit: null,
    };
    const at = (n: number) => new Date(Date.now() - 60_000 + n);
    await recordGitHubObservation(boss, published, at(1), { pr });
    assert.equal((await dashboard(boss)).issues[0].coding_status, "pr_closed");
    await recordGitHubObservation(boss, published, at(2), { pr });
    assert.equal(
      (
        await boss
          .getDb()
          .executeSql(
            "SELECT id FROM code_assist.intake_event WHERE type='coding_pr_closed' AND issue_id=$1",
            [ticket.id],
          )
      ).rows.length,
      1,
    );
    await recordGitHubObservation(boss, published, at(3), {
      pr: { ...pr, state: "OPEN", closedAt: null },
    });
    assert.equal(
      (await readWorkItem(boss.getDb(), ticket.id))!.coding_status,
      "pr_open",
    );
    assert.equal(
      await recordGitHubObservation(boss, published, new Date(0), { pr }),
      false,
    );
    await assert.rejects(
      requestGitHubRefresh(boss, randomUUID(), published.id),
    );
    await requestGitHubRefresh(boss, ticket.id, published.id);
    const [refresh] = await boss.fetch<{ runId: string }>(githubQueue);
    assert.equal(refresh.data.runId, published.id);
    await assert.rejects(
      refreshGitHub(
        boss,
        refresh.data,
        new AbortController().signal,
        refresh.id,
        async () => {
          throw new Error("Fixture GitHub unavailable");
        },
      ),
    );
    const failedRefresh = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(failedRefresh.status, "pr_open");
    assert.match(failedRefresh.github_error!, /GitHub refresh failed/);
    const merged: PullRequestState = {
      ...pr,
      state: "MERGED",
      mergedAt: pr.closedAt,
      mergeCommit: { oid: "c".repeat(40) },
    };
    await recordGitHubObservation(
      boss,
      published,
      new Date(Date.now() + 1_000),
      { pr: merged },
    );
    const done = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(done.status, "done");
    assert.equal(done.merge_commit, "c".repeat(40));
    assert.equal(
      new Date(done.merged_at!).toISOString(),
      "2026-10-20T20:00:00.000Z",
    );
    assert.equal(done.github_error, null);
    await recordGitHubObservation(
      boss,
      published,
      new Date(Date.now() + 2_000),
      { pr: merged },
    );
    assert.equal(
      (
        await boss
          .getDb()
          .executeSql(
            "SELECT id FROM code_assist.intake_event WHERE type='coding_done' AND issue_id=$1",
            [ticket.id],
          )
      ).rows.length,
      1,
    );
    assert.equal((await dashboard(boss)).issues[0].coding_status, "done");
    let githubReads = 0;
    await refreshGitHub(
      boss,
      {},
      new AbortController().signal,
      randomUUID(),
      async () => {
        githubReads++;
        return merged;
      },
    );
    assert.equal(githubReads, 0);
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
      5,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
