import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { initializeIntake } from "../src/store.ts";
import {
  cleanupCodingRun,
  type cleanupRuntime,
} from "../src/coding-cleanup.ts";
import type { Workspace } from "../src/workspace.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("Done cleanup respects age and dependencies, rolls back failures and deletes at most once across overlapping workers", async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const database = "cleanup_" + randomUUID().replaceAll("-", "");
  try {
    await admin.query(`CREATE DATABASE ${database}`);
  } catch (error) {
    await admin.end();
    throw error;
  }
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
    const db = boss.getDb(),
      id = randomUUID(),
      issue = randomUUID(),
      discovery = randomUUID(),
      plan = randomUUID(),
      step = randomUUID(),
      workspace = randomUUID();
    await db.executeSql(
      "INSERT INTO code_assist.intake_issue(id,ticket,suggestions,eligible) VALUES($1,'{}','[]',true)",
      [issue],
    );
    await db.executeSql(
      "INSERT INTO code_assist.discovery_run(id,issue_id,job_id,input_hash,ticket,repositories,status) VALUES($1,$2,$1,'fixture','{}','[]','ready')",
      [discovery, issue],
    );
    await db.executeSql(
      "INSERT INTO code_assist.planning_run(id,issue_id,discovery_id,input_hash,status) VALUES($1,$2,$3,'fixture','approved')",
      [plan, issue, discovery],
    );
    await db.executeSql(
      "INSERT INTO code_assist.planning_step(id,run_id,job_id,kind,version,input,status) VALUES($1,$2,$1,'draft',1,'{}','completed')",
      [step, plan],
    );
    await db.executeSql(
      "INSERT INTO code_assist.plan_version(run_id,number,step_id,hash,document) VALUES($1,1,$2,'fixture','{}')",
      [plan, step],
    );
    await db.executeSql(
      "INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status,workspace_id) VALUES($1,$2,$3,1,'{}','{}','ONE-999999','Fixture','feature/one-999999','done',$4)",
      [id, issue, plan, workspace],
    );
    let removed = 0,
      archived = 0,
      fail = false,
      crashAfterDelete = false,
      exists = true;
    const runtime: typeof cleanupRuntime = {
      archive: async () => {
        archived++;
        if (fail) throw new Error("archive missing");
        return {
          version: 1,
          runId: id,
          workspaceId: workspace,
          archivedAt: new Date().toISOString(),
          archive: "fixture.tar.gz",
          sha256: "fixture",
          repositories: [],
        };
      },
      destroy: async () => {
        if (exists) {
          removed++;
          exists = false;
        }
        if (crashAfterDelete)
          throw new Error("worker exited after VM deletion");
        return {} as Workspace;
      },
    };
    const signal = new AbortController().signal;
    const cleanup = () =>
      cleanupCodingRun(boss, "/fixture", id, signal, runtime);
    assert.equal(await cleanup(), false, "no Done event is not eligible");
    await db.executeSql(
      "INSERT INTO code_assist.intake_event(issue_id,type,details,created_at) VALUES($1,'coding_done',$2,now()-interval '23 hours')",
      [issue, JSON.stringify({ codingId: id })],
    );
    assert.equal(await cleanup(), false);
    await db.executeSql(
      "UPDATE code_assist.intake_event SET created_at=now()-interval '25 hours'",
    );
    for (const status of [
      "pr_open",
      "failed",
      "needs_direction",
      "superseded",
    ]) {
      await db.executeSql(
        "UPDATE code_assist.coding_run SET status=$2 WHERE id=$1",
        [id, status],
      );
      assert.equal(await cleanup(), false);
    }
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status='done' WHERE id=$1",
      [id],
    );
    await db.executeSql(
      "INSERT INTO code_assist.coding_step(id,run_id,job_id,kind,status) VALUES($1,$2,$1,'review','queued')",
      [randomUUID(), id],
    );
    await assert.rejects(cleanup(), /unfinished step/);
    await db.executeSql(
      "UPDATE code_assist.coding_step SET status='completed'",
    );
    const child = randomUUID();
    await db.executeSql(
      "INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status,parent_run_id) VALUES($1,$2,$3,1,'{}','{}','ONE-999999','Repair','feature/one-999999-repair','prepare',$4)",
      [child, issue, plan, id],
    );
    await assert.rejects(cleanup(), /depends on this workspace/);
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status='superseded' WHERE id=$1",
      [child],
    );
    assert.equal(archived, 0);
    fail = true;
    await assert.rejects(cleanup(), /archive missing/);
    assert.equal(removed, 0);
    assert.equal(
      (
        await db.executeSql(
          "SELECT workspace_cleaned_at FROM code_assist.coding_run WHERE id=$1",
          [id],
        )
      ).rows[0].workspace_cleaned_at,
      null,
    );
    fail = false;
    crashAfterDelete = true;
    await assert.rejects(cleanup(), /worker exited after VM deletion/);
    assert.equal(removed, 1);
    assert.equal(
      (
        await db.executeSql(
          "SELECT workspace_cleaned_at FROM code_assist.coding_run WHERE id=$1",
          [id],
        )
      ).rows[0].workspace_cleaned_at,
      null,
    );
    crashAfterDelete = false;
    const both = await Promise.all([cleanup(), cleanup()]);
    assert.deepEqual(both.sort(), [false, true]);
    assert.equal(removed, 1);
    assert.equal(await cleanup(), false);
    const row = (
      await db.executeSql(
        "SELECT status,workspace_id,workspace_cleaned_at FROM code_assist.coding_run WHERE id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.status, "done");
    assert.equal(row.workspace_id, workspace);
    assert(row.workspace_cleaned_at);
    assert.equal(
      (
        await db.executeSql(
          "SELECT count(*)::int AS n FROM code_assist.intake_event WHERE type='coding_workspace_cleaned'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
