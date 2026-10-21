import {
  commitSet,
  publicationReady,
  repositoryRun,
} from "../src/coding-repositories.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  recordGitHubObservation,
  type PullRequestState,
} from "../src/github.ts";
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
  readCoding,
  startCoding,
  finishCoding,
  failCoding,
  retryCoding,
  currentCoding,
  syncApprovedCoding,
  initializeCoding,
} from "../src/coding.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("multi-repository coding persists sequential checkpoints, combined review, partial publication, and all main outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code-assist-multi-"));
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_multi_" + randomUUID().replaceAll("-", "");
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
      name: "elation_companion",
      path: "/fixture/elation_companion",
      github: null,
    };
    const second = {
      name: "workplace-agents",
      path: "/fixture/workplace-agents",
      github: null,
    };
    const scan = await requestScan(boss);
    await recordScan(boss, scan, [ticket], [source, second]);
    await selectRepositories(
      boss,
      ticket.id,
      [source.path, second.path],
      ticket.updatedAt,
    );
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
            {
              name: second.name,
              source: second.path,
              directory: "/snapshot/wp",
              commit: "b".repeat(40),
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
      assert.equal(job.expireInSeconds, 3600);
      const started = await startCoding(boss, job.data.stepId, job.id);
      assert(started);
      return started;
    }

    const initial = await next();
    assert.equal(initial.run.repositories!.length, 2);
    const states = initial.run.repositories!.map((r, i) => ({
      ...r,
      commit: (i ? "b" : "a").repeat(40),
    }));
    assert(
      await finishCoding(
        boss,
        initial.run,
        initial.step,
        {},
        "implement",
        undefined,
        randomUUID(),
        undefined,
        { repositories: states, index: 0 },
      ),
    );
    for (const index of [0, 1]) {
      const implement = await next();
      assert.equal(implement.step.kind, "implement");
      assert.equal(implement.step.repository_index, index);
      assert.equal(implement.step.input_commit, states[index].commit);
      states[index] = {
        ...states[index],
        commit: (index ? "d" : "c").repeat(40),
      };
      await finishCoding(
        boss,
        implement.run,
        implement.step,
        {},
        "validate",
        undefined,
        undefined,
        undefined,
        { repositories: states, index },
      );
      const validation = await next();
      assert.equal(validation.step.kind, "validate");
      assert.equal(validation.step.input_commit, states[index].commit);
      await finishCoding(
        boss,
        validation.run,
        validation.step,
        { passed: true },
        index ? "review" : "implement",
        undefined,
        undefined,
        undefined,
        { repositories: states, index: 1 },
      );
    }
    const review = await next();
    assert.equal(review.step.kind, "review");
    assert.deepEqual(review.step.input_commits, commitSet(review.run));
    const reviewed = {
      summary: "Reviewed both",
      disposition: "ready",
      directionQuestion: "",
      findings: [],
    };
    await finishCoding(
      boss,
      review.run,
      review.step,
      reviewed,
      "publish",
      undefined,
      undefined,
      undefined,
      { repositories: states, index: 0 },
    );
    const first = await next();
    assert.equal(first.step.repository_index, 0);
    const detail = (await readCoding(boss.getDb(), ticket.id))[0];
    assert(publicationReady(first.run, detail.steps));
    assert(
      !publicationReady(
        {
          ...first.run,
          repositories: states.map((r, i) =>
            i ? { ...r, commit: "e".repeat(40) } : r,
          ),
        },
        detail.steps,
      ),
    );
    const urls = [
      "https://github.com/Fixture/extension/pull/1",
      "https://github.com/Fixture/portal/pull/2",
    ];
    states[0] = { ...states[0], status: "pr_open", pr_url: urls[0] };
    await finishCoding(
      boss,
      first.run,
      first.step,
      {},
      "publish",
      undefined,
      undefined,
      urls[0],
      { repositories: states, index: 1 },
    );
    const secondPr = await next();
    assert.equal(secondPr.step.repository_index, 1);
    assert.equal(secondPr.run.repositories![0].pr_url, urls[0]);
    await failCoding(
      boss,
      secondPr.run,
      secondPr.step,
      "Interrupted publication",
    );
    await retryCoding(boss, ticket.id, secondPr.run.id, secondPr.step.id);
    const resumed = await next();
    assert.equal(resumed.step.repository_index, 1);
    assert.equal(resumed.run.repositories![0].pr_url, urls[0]);
    assert(await currentCoding(boss.getDb(), resumed.run, resumed.step));
    states[1] = { ...states[1], status: "pr_open", pr_url: urls[1] };
    await finishCoding(
      boss,
      resumed.run,
      resumed.step,
      {},
      "pr_open",
      undefined,
      undefined,
      urls[0],
      { repositories: states, index: 1 },
    );
    const published = (await readCoding(boss.getDb(), ticket.id))[0];
    const observed = (index: number) => ({
      ...repositoryRun(published, index),
      pr_url: urls[index],
    });
    const merge = (index: number): PullRequestState => ({
      url: urls[index],
      state: "MERGED",
      baseRefName: "main",
      mergedAt: "2026-10-20T12:00:00Z",
      closedAt: "2026-10-20T12:00:00Z",
      mergeCommit: { oid: (index ? "f" : "e").repeat(40) },
    });
    const workflow = (index: number, conclusion = "success") => ({
      runs: [
        {
          id: index + 1,
          name: "CI",
          head_sha: merge(index).mergeCommit!.oid,
          head_branch: "main",
          event: "push",
          status: "completed",
          conclusion,
          run_attempt: 1,
          html_url: `https://github.com/Fixture/${index ? "portal" : "extension"}/actions/runs/${index + 1}`,
        },
      ],
    });
    const at = new Date("2026-10-20T14:00:00Z");
    await recordGitHubObservation(boss, observed(0), at, {
      pr: merge(0),
      main: workflow(0),
    });
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id))[0].status,
      "pr_open",
    );
    await recordGitHubObservation(boss, observed(1), at, {
      pr: merge(1),
      main: { runs: [] },
    });
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id))[0].status,
      "awaiting_main",
    );
    const later = new Date(at.getTime() + 1000);
    await recordGitHubObservation(boss, observed(1), later, {
      pr: merge(1),
      main: workflow(1),
    });
    assert.equal((await readCoding(boss.getDb(), ticket.id))[0].status, "done");
    async function completionCounts() {
      const { rows } = await boss.getDb().executeSql(
        `SELECT count(*)::int AS events, count(n.id)::int AS notifications
         FROM code_assist.intake_event e
         LEFT JOIN code_assist.attention_outbox n ON n.event_id=e.id
         WHERE e.issue_id=$1 AND e.type='coding_done'`,
        [ticket.id],
      );
      return rows[0];
    }
    assert.deepEqual(await completionCounts(), { events: 1, notifications: 1 });
    for (const offset of [1100, 1200]) {
      await initializeCoding(boss);
      assert.equal(
        (await readCoding(boss.getDb(), ticket.id))[0].status,
        "done",
        "Startup must preserve completion backed by per-repository workflows",
      );
      for (const index of [0, 1]) {
        await recordGitHubObservation(
          boss,
          observed(index),
          new Date(at.getTime() + offset),
          { pr: merge(index), main: workflow(index) },
        );
      }
      assert.deepEqual(await completionCounts(), {
        events: 1,
        notifications: 1,
      });
    }
    assert.equal(
      await recordGitHubObservation(boss, observed(1), at, { error: "stale" }),
      false,
    );
    const failure = {
      ...workflow(1, "failure"),
      failureArtifact: randomUUID(),
    };
    await recordGitHubObservation(
      boss,
      observed(1),
      new Date(at.getTime() + 2000),
      { pr: merge(1), main: failure },
    );
    const repairs = await readCoding(boss.getDb(), ticket.id);
    assert.equal(repairs.length, 2);
    assert.equal(repairs[1].repair?.repository, "workplace-agents");
    assert.equal(repairs[1].repository_index, 1);
    assert.equal(repairs[1].repositories![0].status, "done");
    assert.equal(repairs[1].repositories![1].pr_url, null);
    const repair = await next();
    assert(await currentCoding(boss.getDb(), repair.run, repair.step));
    await recordGitHubObservation(
      boss,
      observed(1),
      new Date(at.getTime() + 3000),
      { pr: merge(1), main: workflow(1) },
    );
    assert(!(await currentCoding(boss.getDb(), repair.run, repair.step)));
    assert.deepEqual(await completionCounts(), { events: 2, notifications: 2 });
  } finally {
    await boss.stop({ graceful: false });
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
