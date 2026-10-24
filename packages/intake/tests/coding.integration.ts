import { exercisePrChecks } from "./coding-pr-checks-fixture.ts";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { exerciseCodeChanges } from "./coding-revision-fixture.ts";
import { exerciseCodingDirection } from "./coding-direction-fixture.ts";
import { exerciseValidationLoop } from "./coding-validation-fixture.ts";
import { finishValidation } from "../src/coding-validation-outcome.ts";
import { exerciseMissingBrowserEvidence } from "./coding-browser-evidence-fixture.ts";
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
  completeWorkItem,
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
  initializeCoding,
  readCoding,
  startCoding,
  finishCoding,
  failCoding,
  retryCoding,
  currentCoding,
  syncApprovedCoding,
  changeCodingBranch,
} from "../src/coding.ts";
import { reconcileCodingFailures } from "../src/coding-worker.ts";
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
      {
        markdown: "# Plan",
        changeSummary: "Initial",
        responses: [],
        additionalValidation: [{ repository: source.name, script: "npm test" }],
      },
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
    assert.deepEqual(runs[0].plan.additionalValidation, [
      { repository: source.name, script: "npm test" },
    ]);
    assert.equal(runs[0].steps.length, 1);
    assert.equal(runs[0].branch, "feature/one-999999");
    async function next() {
      const [job] = await boss.fetch<{ stepId: string }>(codingQueue);
      assert(job);
      const started = await startCoding(
        boss,
        job.data.stepId,
        job.id,
        job.retryCount,
      );
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
    const b = await exerciseMissingBrowserEvidence(
      boss,
      await exerciseValidationLoop(
        boss,
        await exerciseCodingDirection(boss, await next(), next),
        next,
      ),
      next,
    );
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
    const continuation = {
      agentStepId: c.step.id,
      kind: "implement" as const,
      result: {
        summary: "Implemented",
        disposition: "implemented",
        directionQuestion: "",
        browserEvidence: ["/work/evidence/browser/"],
      },
      browserCalls: ["browser_run_code_unsafe"],
    };
    assert(
      await finishCoding(
        boss,
        c.run,
        c.step,
        continuation.result,
        "checkpoint",
        undefined,
        undefined,
        undefined,
        undefined,
        continuation,
      ),
    );
    const checkpoint = await next();
    assert.deepEqual(checkpoint.step.continuation, continuation);
    assert(
      await finishCoding(
        boss,
        checkpoint.run,
        checkpoint.step,
        { commit: "b".repeat(40) },
        "collect",
        "b".repeat(40),
        undefined,
        undefined,
        undefined,
        continuation,
      ),
    );
    const collection = await next();
    assert.equal(collection.step.kind, "collect");
    assert.equal(collection.step.input_commit, "b".repeat(40));
    assert.equal(
      (await boss.getJobById(codingQueue, collection.step.job_id))?.retryLimit,
      2,
    );
    // A dead worker leaves a running row. Reconciliation resumes only collection through pg-boss.
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_step SET worker_pid=2147483647 WHERE id=$1",
        [collection.step.id],
      );
    await reconcileCodingFailures(boss);
    assert.equal(
      (await boss.getJobById(codingQueue, collection.step.job_id))?.state,
      "retry",
    );
    await boss
      .getDb()
      .executeSql("UPDATE pgboss.job SET start_after=now() WHERE id=$1", [
        collection.step.job_id,
      ]);
    await boss.stop();
    await boss.start();
    const recovered = await next();
    assert.equal(recovered.step.id, collection.step.id);
    assert.equal(recovered.step.job_retry_count, 1);
    assert.deepEqual(recovered.step.continuation, continuation);
    assert.equal(
      await finishCoding(boss, collection.run, collection.step, {}, "validate"),
      false,
    );
    await failCoding(boss, collection.run, collection.step, "Late old worker");
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id))[0].status,
      "collect",
    );
    // Repeated interrupted collection consumes exactly the two native retries, then pauses.
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_step SET worker_pid=2147483647 WHERE id=$1",
        [recovered.step.id],
      );
    await reconcileCodingFailures(boss);
    await boss
      .getDb()
      .executeSql("UPDATE pgboss.job SET start_after=now() WHERE id=$1", [
        recovered.step.job_id,
      ]);
    const exhausted = await next();
    assert.equal(exhausted.step.job_retry_count, 2);
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_step SET worker_pid=2147483647 WHERE id=$1",
        [exhausted.step.id],
      );
    await reconcileCodingFailures(boss);
    assert.equal(
      (await boss.getJobById(codingQueue, exhausted.step.job_id))?.state,
      "failed",
    );
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id))[0].status,
      "failed",
    );
    // Manual retry retains the candidate and never queues implementation.
    await retryCoding(boss, ticket.id, exhausted.run.id, exhausted.step.id);
    const resumed = await next();
    assert.equal(resumed.step.kind, "collect");
    assert.equal(resumed.step.input_commit, "b".repeat(40));
    assert.deepEqual(resumed.step.continuation, continuation);
    assert(
      await finishCoding(
        boss,
        resumed.run,
        resumed.step,
        { evidence: "/fixture/evidence.tar.gz" },
        "validate",
      ),
    );
    const validation = await next();
    assert.equal(validation.step.input_commit, "b".repeat(40));
    assert(
      await finishValidation(boss, validation.run, validation.step, {
        commit: validation.run.commit!,
        commands: { test: 0 },
        passed: true,
      }),
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
    await exerciseCodeChanges(boss, ticket.id, next);
    await exercisePrChecks(boss, ticket.id, next);
    const published = (await readCoding(boss.getDb(), ticket.id))[0];
    const pr: PullRequestState = {
      url: published.pr_url!,
      state: "CLOSED",
      baseRefName: "main",
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
      baseRefName: "main",
      mergedAt: pr.closedAt,
      mergeCommit: { oid: "c".repeat(40) },
    };
    let tick = Date.now() + 1000;
    const observe = (
      main?: import("../src/github-workflows.ts").MainWorkflows,
    ) =>
      recordGitHubObservation(boss, published, new Date(++tick), {
        pr: merged,
        main,
      });
    const original = async () => (await readCoding(boss.getDb(), ticket.id))[0];
    await observe();
    assert.equal((await original()).status, "awaiting_main");
    await observe({ runs: [] });
    assert.equal((await original()).status, "awaiting_main");
    const workflow = {
      id: 42,
      run_attempt: 1,
      name: "Main Build",
      html_url: "https://github.com/example/icu/actions/runs/42",
      head_sha: "c".repeat(40),
      head_branch: "main",
      event: "push",
      status: "in_progress",
      conclusion: null as string | null,
    };
    await observe({ runs: [workflow] });
    assert.equal((await original()).status, "main_running");
    const failure = {
      runs: [{ ...workflow, status: "completed", conclusion: "failure" }],
      failureArtifact: randomUUID(),
    };
    await observe({
      ...failure,
      failureArtifact: undefined,
      evidenceError: "Logs not available",
    });
    assert.equal((await original()).status, "main_failed");
    assert.equal((await original()).github_error, "Logs not available");
    assert.equal((await readCoding(boss.getDb(), ticket.id)).length, 1);
    await observe(failure);
    assert.equal((await original()).status, "main_failed");
    let all = await readCoding(boss.getDb(), ticket.id);
    assert.equal(all.length, 2);
    const repair = all[1];
    assert.equal(repair.parent_run_id, published.id);
    assert.equal(repair.repair!.baseCommit, merged.mergeCommit!.oid);
    assert.deepEqual(repair.input, published.input);
    assert.notEqual(repair.branch, published.branch);
    assert.match(repair.branch, /^feature\/one-999999-main-fix-/);
    assert.equal(repair.status, "prepare");
    assert.equal((await dashboard(boss)).issues[0].coding_status, "prepare");
    await observe(failure);
    await syncApprovedCoding(boss);
    assert.equal((await readCoding(boss.getDb(), ticket.id)).length, 2);
    const preparing = await next();
    assert.equal(preparing.run.id, repair.id);
    // A recovered rerun fences already-running corrective work, preserving original history.
    const passed = {
      runs: [
        {
          ...workflow,
          run_attempt: 2,
          status: "completed",
          conclusion: "success",
        },
      ],
    };
    await observe(passed);
    assert.equal(
      await currentCoding(boss.getDb(), preparing.run, preparing.step),
      false,
    );
    assert.equal(
      await finishCoding(boss, preparing.run, preparing.step, {}, "implement"),
      false,
    );
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id))[1].status,
      "superseded",
    );
    const done = await original();
    assert.equal(done.status, "done");
    assert.equal(done.merge_commit, "c".repeat(40));
    assert.equal(
      new Date(done.merged_at!).toISOString(),
      "2026-10-20T20:00:00.000Z",
    );
    assert.equal(done.github_error, null);
    await observe(passed);
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
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.intake_event SET created_at=now()-interval '3 hours' WHERE type='coding_done' AND details->>'codingId'=$1",
        [published.id],
      );
    assert.equal(
      (await dashboard(boss)).completedIssues.length,
      0,
      "Work done three hours ago remains in the main list",
    );
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.intake_event SET created_at=now()-interval '5 hours' WHERE type='coding_done' AND details->>'codingId'=$1",
        [published.id],
      );
    const archived = await dashboard(boss);
    assert.equal(archived.issues.length, 0);
    assert.equal(archived.completedIssues[0].id, ticket.id);
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
    // New failed attempt creates a distinct repair; its validation/review/publication loop is unchanged.
    const again = {
      runs: [
        {
          ...workflow,
          run_attempt: 3,
          status: "completed",
          conclusion: "failure",
        },
      ],
      failureArtifact: randomUUID(),
    };
    await observe(again);
    assert.equal(
      (await dashboard(boss)).completedIssues.length,
      0,
      "Corrective work must return to the main list",
    );
    assert.equal((await dashboard(boss)).issues[0].id, ticket.id);
    const rp = await next();
    assert.notEqual(rp.run.id, repair.id);
    await finishCoding(
      boss,
      rp.run,
      rp.step,
      { ready: true },
      "implement",
      "c".repeat(40),
      randomUUID(),
    );
    const ri = await next();
    await finishCoding(
      boss,
      ri.run,
      ri.step,
      { summary: "Repair" },
      "validate",
      "d".repeat(40),
    );
    const rv = await next();
    await finishCoding(boss, rv.run, rv.step, { passed: true }, "review");
    const rr = await next();
    await finishCoding(
      boss,
      rr.run,
      rr.step,
      { disposition: "revise", findings: [{ severity: "high" }] },
      "implement",
    );
    const revision = await next();
    await finishCoding(
      boss,
      revision.run,
      revision.step,
      { summary: "Addressed review" },
      "validate",
      "e".repeat(40),
    );
    const revalidate = await next();
    await finishCoding(
      boss,
      revalidate.run,
      revalidate.step,
      { passed: true },
      "review",
    );
    const rereview = await next();
    await finishCoding(
      boss,
      rereview.run,
      rereview.step,
      { ready: true },
      "publish",
    );
    const republish = await next();
    await finishCoding(
      boss,
      republish.run,
      republish.step,
      { summary: "Corrective PR" },
      "pr_open",
      undefined,
      undefined,
      "https://github.com/example/icu/pull/2",
    );
    all = await readCoding(boss.getDb(), ticket.id);
    const correction = all[2];
    assert.equal(correction.pr_url, "https://github.com/example/icu/pull/2");
    assert.equal(all[0].pr_url, published.pr_url);
    const correctedMerge = {
      ...merged,
      url: correction.pr_url!,
      mergeCommit: { oid: "f".repeat(40) },
    };
    await recordGitHubObservation(boss, correction, new Date(++tick), {
      pr: correctedMerge,
      main: { runs: [] },
    });
    assert.equal(
      (await dashboard(boss)).issues[0].coding_status,
      "awaiting_main",
    );
    await recordGitHubObservation(boss, correction, new Date(++tick), {
      pr: correctedMerge,
      main: {
        runs: [
          {
            ...workflow,
            id: 43,
            html_url: "https://github.com/example/icu/actions/runs/43",
            head_sha: "f".repeat(40),
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    });
    assert.equal((await dashboard(boss)).issues[0].coding_status, "done");
    // Delayed or failed reads cannot replace success with earlier failure evidence.
    assert.equal(
      await recordGitHubObservation(boss, correction, new Date(0), {
        pr: correctedMerge,
        main: { runs: [] },
      }),
      false,
    );
    await recordGitHubObservation(boss, correction, new Date(++tick), {
      error: "GitHub unavailable",
    });
    assert.equal((await dashboard(boss)).issues[0].coding_status, "done");
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
    await observe({
      runs: [
        {
          ...workflow,
          run_attempt: 4,
          status: "completed",
          conclusion: "failure",
        },
      ],
      failureArtifact: randomUUID(),
    });
    assert.equal(
      (await readCoding(boss.getDb(), ticket.id)).length,
      3,
      "Superseded approval must not authorize another repair",
    );
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET status='done',main_workflows=NULL WHERE id=$1",
        [published.id],
      );
    await initializeCoding(boss);
    assert.equal(
      (await original()).status,
      "awaiting_main",
      "Legacy merge-only Done must be rechecked",
    );
    const completed = (await readCoding(boss.getDb(), ticket.id))[0];
    assert.equal(completed.commit, published.commit);
    assert.equal(
      completed.steps.filter(
        (s) => s.status === "completed" && !s.change_request_id,
      ).length,
      22,
    );
    await assert.rejects(
      completeWorkItem(boss, ticket.id, randomUUID(), "owner"),
      /published work/,
    );
    await assert.rejects(
      completeWorkItem(boss, ticket.id, published.id, "owner"),
      /still active/,
    );
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.planning_run SET status='needs_direction' WHERE id=$1",
        [plan.id],
      );
    const evidenceBefore = await readCoding(boss.getDb(), ticket.id);
    await completeWorkItem(boss, ticket.id, published.id, "owner");
    await completeWorkItem(boss, ticket.id, published.id, "owner");
    const ownerCompleted = (await readWorkItem(boss.getDb(), ticket.id))!;
    assert.equal(ownerCompleted.coding_status, "done");
    assert(ownerCompleted.owner_completed_at);
    assert.equal(
      ownerCompleted.events.filter((e) => e.type === "issue_completed_by_owner")
        .length,
      1,
    );
    assert.deepEqual(await readCoding(boss.getDb(), ticket.id), evidenceBefore);
    assert.equal(
      await recordGitHubObservation(boss, await original(), new Date(++tick), {
        pr: merged,
        main: { runs: [] },
      }),
      false,
    );
    await refreshGitHub(
      boss,
      { runId: published.id },
      new AbortController().signal,
      randomUUID(),
      async () => {
        throw new Error("Completed work must not poll GitHub");
      },
    );
    assert.deepEqual(await readCoding(boss.getDb(), ticket.id), evidenceBefore);
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
