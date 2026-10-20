import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { saveSecret } from "@code-assist/secrets";
import { readSettings, writeSettings } from "../src/settings.ts";
import { deliverNotification, reconcileSchedule } from "../src/worker.ts";
import {
  initializeIntake,
  requestScan,
  recordScan,
  readWorkItem,
  selectRepository,
  dashboard,
  requeuePendingNotifications,
  notificationQueue,
  withIntake,
} from "../src/store.ts";
import type { Ticket } from "../src/linear.ts";
const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");
test("durable intake, selection, rollback and notification delivery across restart", async () => {
  const database = "code_assist_intake_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = "/" + database;
  const temp = fileURLToPath(
    new URL("../../../.tmp/intake/tests/", import.meta.url),
  );
  mkdirSync(temp, { recursive: true });
  const directory = mkdtempSync(join(temp, "data-"));
  let boss = new PgBoss(url.toString());
  boss.on("error", () => {});
  let responseStatus = 500;
  const delivered: { message: string; "conversation-id": string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    delivered.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.statusCode = responseStatus;
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    const secrets = ["linear", "flow", "conversation"].map((name, index) =>
      saveSecret(directory, {
        name,
        description: "",
        value:
          index === 1
            ? `http://127.0.0.1:${port}/?sig=private-fixture`
            : "fixture-" + name,
      }),
    );
    writeSettings(directory, {
      linearSecretId: secrets[0].id,
      linearTokenType: "apiKey",
      teamsWebhookSecretId: secrets[1].id,
      teamsConversationSecretId: secrets[2].id,
      pollMinutes: 0,
    });
    await boss.start();
    await initializeIntake(boss);
    await reconcileSchedule(boss, directory);
    const ticket: Ticket = {
      id: randomUUID(),
      identifier: "ONE-TEST",
      title: "Fix repo-one",
      url: "https://linear.app/example",
      description: "repo-one",
      updatedAt: "2026-10-20T00:00:00.000Z",
      labels: ["Plan"],
      comments: [],
    };
    const repositories = [
      { name: "repo-one", path: "/repos/repo-one", github: null },
    ];
    const scan = await requestScan(boss);
    await recordScan(boss, scan, [ticket], repositories);
    await recordScan(boss, scan, [ticket], repositories);
    let state = await dashboard(boss);
    assert.equal(state.issues.length, 1);
    assert.equal(state.notifications.length, 1);
    assert.equal(
      (await readWorkItem(boss.getDb(), ticket.id))?.events.length,
      1,
    );
    await selectRepository(
      boss,
      ticket.id,
      "/repos/repo-one",
      ticket.updatedAt,
    );
    await selectRepository(
      boss,
      ticket.id,
      "/repos/repo-one",
      ticket.updatedAt,
    );
    await boss.stop();
    boss = new PgBoss(url.toString());
    boss.on("error", () => {});
    await boss.start();
    await initializeIntake(boss);
    assert.equal(
      (await readWorkItem(boss.getDb(), ticket.id))?.selected_repository,
      "/repos/repo-one",
    );
    const changed = {
      ...ticket,
      updatedAt: "2026-10-21T00:00:00.000Z",
      labels: ["Code"],
    };
    await recordScan(boss, scan, [changed], repositories);
    await assert.rejects(
      selectRepository(boss, ticket.id, "/repos/other", ticket.updatedAt),
      /ticket changed/,
    );
    await recordScan(boss, scan, [], repositories);
    await recordScan(boss, scan, [ticket], repositories);
    const item = await readWorkItem(boss.getDb(), ticket.id);
    assert.equal(item?.eligible, false);
    assert.equal(item?.selected_repository, "/repos/repo-one");
    assert.equal(item?.events.length, 2);
    await recordScan(
      boss,
      scan,
      [{ ...ticket, id: randomUUID(), labels: ["Code"] }],
      repositories,
    );
    assert.equal((await dashboard(boss)).issues.length, 1);
    await assert.rejects(
      recordScan(
        boss,
        scan,
        [
          { ...ticket, id: randomUUID() },
          { ...ticket, id: "invalid" },
        ],
        repositories,
      ),
    );
    assert.equal((await dashboard(boss)).issues.length, 1);
    const [job] = await boss.fetch<{ notificationId: string }>(
      notificationQueue,
    );
    assert(job);
    await assert.rejects(
      deliverNotification(boss, directory, job.data.notificationId, job.id),
      /HTTP 500/,
    );
    await boss.fail(notificationQueue, job.id);
    await requeuePendingNotifications(boss);
    const [retry] = await boss.fetch<{ notificationId: string }>(
      notificationQueue,
    );
    assert(retry);
    assert.notEqual(retry.id, job.id);
    responseStatus = 202;
    await deliverNotification(
      boss,
      directory,
      retry.data.notificationId,
      retry.id,
    );
    await boss.complete(notificationQueue, retry.id);
    await deliverNotification(
      boss,
      directory,
      retry.data.notificationId,
      retry.id,
    );
    state = await dashboard(boss);
    assert.equal(state.notifications.length, 0);
    assert.equal(delivered.length, 2);
    assert.equal(delivered[1]["conversation-id"], "fixture-conversation");
    assert(delivered[1].message.includes("/tickets/" + ticket.id));
    const rows = await boss
      .getDb()
      .executeSql("SELECT attempts,error FROM code_assist.attention_outbox");
    assert.equal(rows.rows[0].attempts, 2);
    assert.equal(rows.rows[0].error, null);
    await withIntake(url.toString(), async (producer) => {
      writeSettings(directory, {
        ...readSettings(directory)!,
        pollMinutes: 5,
      });
      await reconcileSchedule(producer, directory);
      assert.equal(
        (await producer.getSchedules()).find((s) => s.name === "linear-intake")
          ?.cron,
        "*/5 * * * *",
      );
      writeSettings(directory, {
        ...readSettings(directory)!,
        pollMinutes: 0,
      });
      await reconcileSchedule(producer, directory);
      assert.equal((await producer.getSchedules()).length, 0);
      assert.equal((await dashboard(producer)).issues.length, 1);
    });
  } finally {
    await boss.stop();
    server.close();
    await once(server, "close");
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  }
});
