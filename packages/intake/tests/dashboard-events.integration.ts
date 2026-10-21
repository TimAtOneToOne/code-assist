import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { initializeIntake } from "../src/store.ts";
import { dashboardEvents } from "../src/dashboard-events.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");

test(
  "dashboard streams committed changes, reconnects with a refresh, and releases listeners",
  { timeout: 20_000 },
  async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const database = "code_assist_events_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    const connectionString = url.toString();
    const boss = new PgBoss({
      connectionString,
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => {});
    const writer = new pg.Client({ connectionString });
    const abort = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const frame = async () => {
      const result = await reader!.read();
      assert.equal(result.done, false);
      assert.equal(new TextDecoder().decode(result.value), "data: changed\n\n");
    };
    try {
      await boss.start();
      await initializeIntake(boss);
      await initializeIntake(boss);
      await writer.connect();
      reader = dashboardEvents(connectionString, abort.signal).getReader();
      await frame();
      const issueId = randomUUID();
      await writer.query(
        "INSERT INTO code_assist.intake_issue(id,ticket,suggestions,eligible) VALUES($1,'{}','[]',true)",
        [issueId],
      );
      await frame();

      let delivered = false;
      const pending = frame().then(() => {
        delivered = true;
      });
      await writer.query("BEGIN");
      await writer.query(
        "UPDATE code_assist.intake_issue SET eligible=false WHERE id=$1",
        [issueId],
      );
      await setTimeout(100);
      assert.equal(
        delivered,
        false,
        "uncommitted work must not refresh the page",
      );
      await writer.query("ROLLBACK");
      await writer.query(
        "UPDATE code_assist.intake_issue SET eligible=eligible WHERE id=$1",
        [issueId],
      );
      await setTimeout(100);
      assert.equal(
        delivered,
        false,
        "rollback and unchanged rows must not refresh the page",
      );
      await writer.query("BEGIN");
      await writer.query(
        "UPDATE code_assist.intake_issue SET eligible=false WHERE id=$1",
        [issueId],
      );
      await writer.query(
        "INSERT INTO code_assist.intake_event(issue_id,type) VALUES($1,'issue_removed')",
        [issueId],
      );
      await writer.query("COMMIT");
      await pending;

      await writer.query(
        "INSERT INTO code_assist.intake_scan(job_id,status) VALUES($1,'completed')",
        [randomUUID()],
      );
      await frame();
      await writer.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='code-assist-dashboard-events' AND datname=current_database()",
      );
      assert.equal(
        (await reader.read()).done,
        true,
        "database disconnect closes SSE so EventSource can reconnect",
      );
      reader = dashboardEvents(connectionString, abort.signal).getReader();
      await frame();
      await reader.cancel();
      assert.equal(
        (
          await writer.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='code-assist-dashboard-events' AND datname=current_database()",
          )
        ).rows[0].count,
        0,
      );

      reader = dashboardEvents(connectionString, abort.signal).getReader();
      await frame();
      abort.abort();
      assert.equal((await reader.read()).done, true);
    } finally {
      abort.abort();
      await reader?.cancel();
      await writer.end();
      await boss.stop();
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
    }
  },
);
