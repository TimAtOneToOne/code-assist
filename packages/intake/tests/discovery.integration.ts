import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
  readDiscovery,
  startDiscovery,
  finishDiscovery,
  answerDiscovery,
  retryDiscovery,
  restartInterruptedDiscovery,
  reconcileDiscoveryFailures,
  syncSelectedDiscoveries,
  type DiscoveryResult,
} from "../src/discovery.ts";
import {
  snapshotRepositories,
  parseDiscoveryResult,
  discoveryPrompt,
} from "../src/discovery-agent.ts";
import type { Ticket } from "../src/linear.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");

test("discovery snapshots, fenced results, answers, removal, retries and deployment checkpoints", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "code_assist_discovery_" + randomUUID().replaceAll("-", "");
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  const base = resolve("../../.tmp/discovery/tests");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "run-"));
  let boss = new PgBoss({
    connectionString: url.toString(),
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => {});
  try {
    await boss.start();
    await initializeIntake(boss);
    const repositories = ["api", "frontend"].map((name) => ({
      name,
      path: join(directory, name),
      github: null,
    }));
    for (const repo of repositories) {
      mkdirSync(repo.path);
      execFileSync("git", ["init", "-b", "main", repo.path], {
        stdio: "ignore",
      });
      writeFileSync(
        join(repo.path, "behavior.ts"),
        "export const value = 'original';\n",
      );
      execFileSync("git", ["-C", repo.path, "add", "."]);
      execFileSync(
        "git",
        [
          "-C",
          repo.path,
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "-m",
          "fixture",
        ],
        { stdio: "ignore" },
      );
      writeFileSync(join(repo.path, ".env"), "FIXTURE_SECRET=not-for-agent\n");
    }
    const ticket: Ticket = {
      id: randomUUID(),
      identifier: "ONE-FIXTURE",
      title: "Investigate behavior",
      url: "https://linear.app/example",
      description: "Clarify behavior across the API and frontend",
      updatedAt: "2026-10-20T01:00:00.000Z",
      labels: ["Plan"],
      comments: [{ id: "comment", body: "Keep previous decisions." }],
    };
    const scan = await requestScan(boss);
    await recordScan(boss, scan, [ticket], repositories);
    await selectRepositories(
      boss,
      ticket.id,
      repositories.map((r) => r.path),
      ticket.updatedAt,
    );
    const firstId = (await readWorkItem(boss.getDb(), ticket.id))!
      .current_discovery_id!;
    await selectRepositories(
      boss,
      ticket.id,
      repositories.map((r) => r.path).reverse(),
      ticket.updatedAt,
    );
    await syncSelectedDiscoveries(boss);
    await recordScan(boss, scan, [ticket], repositories);
    assert.equal(
      (await readWorkItem(boss.getDb(), ticket.id))!.discoveries.length,
      1,
    );
    const [job] = await boss.fetch<{ runId: string }>(discoveryQueue);
    assert.equal(job.data.runId, firstId);
    const starts = await Promise.all([
      startDiscovery(boss, firstId, job.id),
      startDiscovery(boss, firstId, job.id),
    ]);
    assert.equal(starts.filter(Boolean).length, 1);
    const run = starts.find(Boolean)!;
    const prepared = await snapshotRepositories(
      directory,
      run,
      new AbortController().signal,
    );
    assert.equal(prepared.snapshots.length, 2);
    run.snapshots = prepared.snapshots;
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
        [run.id, JSON.stringify(run.snapshots)],
      );
    for (const snapshot of run.snapshots) {
      assert.match(
        readFileSync(join(snapshot.directory, "behavior.ts"), "utf8"),
        /original/,
      );
      assert.throws(
        () => readFileSync(join(snapshot.directory, ".env")),
        /ENOENT/,
      );
      writeFileSync(
        join(snapshot.source, "behavior.ts"),
        "Changed after snapshot\n",
      );
      assert.match(
        readFileSync(join(snapshot.directory, "behavior.ts"), "utf8"),
        /original/,
      );
    }
    assert(
      discoveryPrompt(run, run.snapshots, []).includes(
        "Keep previous decisions.",
      ),
    );
    const result: DiscoveryResult = {
      summary: "API and frontend disagree about existing behavior.",
      findings: [
        {
          repository: "api",
          file: "behavior.ts:1",
          detail: "Observed the original behavior.",
        },
      ],
      questions: [
        {
          question: "Should existing records change?",
          context: "Determines migration scope.",
          options: ["New records only", "All records"],
        },
      ],
    };
    assert.deepEqual(parseDiscoveryResult(JSON.stringify(result)), result);
    assert.throws(() => parseDiscoveryResult('{"summary":"x"}'));
    await boss
      .getDb()
      .executeSql(
        "ALTER TABLE code_assist.intake_event ADD CONSTRAINT fixture_reject_questions CHECK(type <> 'discovery_questions')",
      );
    await assert.rejects(finishDiscovery(boss, run, result));
    assert.equal(
      (await readDiscovery(boss.getDb(), run.id))!.status,
      "running",
    );
    assert.equal(
      (await boss.getJobById(discoveryQueue, job.id))!.state,
      "active",
    );
    await boss
      .getDb()
      .executeSql(
        "ALTER TABLE code_assist.intake_event DROP CONSTRAINT fixture_reject_questions",
      );
    assert(await finishDiscovery(boss, run, result));
    assert.equal(
      (await boss.getJobById(discoveryQueue, job.id))!.state,
      "completed",
    );
    assert.equal(await finishDiscovery(boss, run, result), false);
    assert.equal((await dashboard(boss)).notifications.length, 2);
    await assert.rejects(
      answerDiscovery(boss, ticket.id, run.id, [], ""),
      /Answer each question/,
    );
    await answerDiscovery(
      boss,
      ticket.id,
      run.id,
      ["New records only"],
      "Retain old records.",
    );
    await answerDiscovery(
      boss,
      ticket.id,
      run.id,
      ["New records only"],
      "Retain old records.",
    );
    await assert.rejects(
      answerDiscovery(boss, ticket.id, run.id, ["All records"], ""),
      /already been answered/,
    );
    assert.equal((await dashboard(boss)).notifications.length, 1);
    await boss.stop();
    boss = new PgBoss({
      connectionString: url.toString(),
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => {});
    await boss.start();
    await initializeIntake(boss);
    assert.deepEqual((await readDiscovery(boss.getDb(), run.id))!.answers, [
      "New records only",
    ]);
    assert.equal((await readDiscovery(boss.getDb(), run.id))!.status, "ready");
    const changed = {
      ...ticket,
      updatedAt: "2026-10-20T02:00:00.000Z",
      description: "Changed requirements",
    };
    await recordScan(boss, scan, [changed], repositories);
    const [secondJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const second = (await startDiscovery(
      boss,
      secondJob.data.runId,
      secondJob.id,
    ))!;
    await assert.rejects(
      answerDiscovery(boss, ticket.id, run.id, ["All records"], ""),
      /scope changed/,
    );
    await selectRepositories(
      boss,
      ticket.id,
      [repositories[0].path],
      changed.updatedAt,
    );
    assert.equal(await finishDiscovery(boss, second, result), false);
    await boss.complete(discoveryQueue, secondJob.id);
    const [thirdJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const third = (await startDiscovery(
      boss,
      thirdJob.data.runId,
      thirdJob.id,
    ))!;
    const removed = {
      ...changed,
      labels: [],
      updatedAt: "2026-10-20T03:00:00.000Z",
    };
    await recordScan(boss, scan, [removed], repositories);
    assert.equal(await finishDiscovery(boss, third, result), false);
    assert.equal((await dashboard(boss)).issues.length, 0);
    await boss.complete(discoveryQueue, thirdJob.id);
    await recordScan(
      boss,
      scan,
      [{ ...changed, updatedAt: "2026-10-20T04:00:00.000Z" }],
      repositories,
    );
    const [expiredJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const expired = (await startDiscovery(
      boss,
      expiredJob.data.runId,
      expiredJob.id,
    ))!;
    await boss.fail(discoveryQueue, expiredJob.id);
    assert.equal(await finishDiscovery(boss, expired, result), false);
    await reconcileDiscoveryFailures(boss);
    assert.equal(
      (await readDiscovery(boss.getDb(), expired.id))!.status,
      "failed",
    );
    const retryId = (await retryDiscovery(boss, ticket.id, expired.id))!;
    await assert.rejects(
      retryDiscovery(boss, ticket.id, expired.id),
      /ticket changed/,
    );
    const [retryJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const retry = (await startDiscovery(boss, retryId, retryJob.id))!;
    retry.snapshots = run.snapshots;
    await restartInterruptedDiscovery(boss, retry);
    const current = (await readWorkItem(boss.getDb(), ticket.id))!;
    const resumed = (await readDiscovery(
      boss.getDb(),
      current.current_discovery_id!,
    ))!;
    assert.equal(resumed.status, "queued");
    await assert.rejects(
      retryDiscovery(boss, ticket.id, resumed.id),
      /awaiting answers/,
    );
    assert.notEqual(resumed.id, retry.id);
    assert.deepEqual(resumed.snapshots, run.snapshots);
    assert.equal(await finishDiscovery(boss, retry, result), false);
    await boss.complete(discoveryQueue, retryJob.id);
    const [resumedJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    const resumedRun = (await startDiscovery(boss, resumed.id, resumedJob.id))!;
    await assert.rejects(
      retryDiscovery(boss, ticket.id, resumed.id),
      /awaiting answers/,
    );
    assert(
      await finishDiscovery(boss, resumedRun, { ...result, questions: [] }),
    );
    const rerunId = (await retryDiscovery(boss, ticket.id, resumed.id))!;
    assert.notEqual(rerunId, resumed.id);
    const previous = (await readDiscovery(boss.getDb(), resumed.id))!;
    assert.equal(previous.status, "superseded");
    assert.deepEqual(previous.result, { ...result, questions: [] });
    await assert.rejects(
      retryDiscovery(boss, ticket.id, resumed.id),
      /ticket changed/,
    );
    await assert.rejects(
      answerDiscovery(boss, ticket.id, resumed.id, [], ""),
      /scope changed/,
    );
    const [rerunJob] = await boss.fetch<{ runId: string }>(discoveryQueue);
    assert.equal(rerunJob.data.runId, rerunId);
    const rerun = (await startDiscovery(boss, rerunId, rerunJob.id))!;
    assert.deepEqual(rerun.repositories, resumedRun.repositories);
    assert.equal(rerun.answers, null);
    rerun.snapshots = resumedRun.snapshots;
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
        [rerunId, JSON.stringify(rerun.snapshots)],
      );
    assert(await finishDiscovery(boss, rerun, { ...result, questions: [] }));
    await answerDiscovery(
      boss,
      ticket.id,
      rerunId,
      [],
      "Scope confirmed without extra questions.",
    );
    assert.equal((await readDiscovery(boss.getDb(), rerunId))!.status, "ready");
    await assert.rejects(
      retryDiscovery(boss, ticket.id, rerunId),
      /awaiting answers/,
    );
    const history = (await readWorkItem(boss.getDb(), ticket.id))!;
    assert.equal(
      history.events.filter((e) => e.type === "discovery_answered").length,
      2,
    );
    await boss
      .getDb()
      .executeSql(
        "INSERT INTO code_assist.intake_event(issue_id,type,details,created_at) VALUES($1,'issue_completed_by_owner',$2,now()-interval '25 hours')",
        [
          ticket.id,
          JSON.stringify({
            requestedBy: "owner",
            reason: "Submitted; repository has no main CI workflow.",
          }),
        ],
      );
    const completed = (await readWorkItem(boss.getDb(), ticket.id))!;
    assert.equal(completed.coding_status, "done");
    assert(completed.owner_completed_at);
    assert.deepEqual(completed.discoveries, history.discoveries);
    assert.deepEqual(completed.planning, history.planning);
    await recordScan(
      boss,
      await requestScan(boss),
      [
        {
          ...ticket,
          updatedAt: "2026-10-23T01:00:00.000Z",
          comments: [
            ...ticket.comments,
            { id: "submitted", body: "Build submitted." },
          ],
        },
      ],
      repositories,
    );
    await syncSelectedDiscoveries(boss);
    const afterScan = (await readWorkItem(boss.getDb(), ticket.id))!;
    assert.equal(afterScan.coding_status, "done");
    assert.equal(afterScan.current_discovery_id, history.current_discovery_id);
    assert.deepEqual(afterScan.discoveries, history.discoveries);
    const home = await dashboard(boss);
    assert.equal(
      home.completedIssues.find((item) => item.id === ticket.id)?.coding_status,
      "done",
    );
    assert(!home.notifications.some((item) => item.issue_id === ticket.id));
    await assert.rejects(
      selectRepositories(
        boss,
        ticket.id,
        [repositories[0].path],
        afterScan.ticket.updatedAt,
      ),
      /marked Done/,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
});
