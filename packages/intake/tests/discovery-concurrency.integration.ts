import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { discoveryQueue } from "../src/discovery.ts";
import { registerDiscoveryConcurrency } from "../src/discovery-concurrency.ts";
import { writeExecutionSettings } from "../src/execution-settings.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");

test(
  "native discovery workers respect the saved maximum and drain active jobs before live changes",
  { timeout: 35_000 },
  async () => {
    const root = join(
      import.meta.dirname,
      "../../../.tmp/discovery-concurrency-tests",
    );
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "integration-"));
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    const database = "discovery_parallel_" + randomUUID().replaceAll("-", "");
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    const boss = new PgBoss({
      connectionString: url.toString(),
      supervise: false,
      schedule: false,
    });
    const errors: unknown[] = [];
    boss.on("error", (e) => errors.push(e));
    const shutdown = new AbortController();
    let dispose: (() => Promise<void>) | undefined;
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const completed: string[] = [];
    let active = 0,
      maximum = 0;
    const until = async (condition: () => boolean) => {
      const end = Date.now() + 8_000;
      while (!condition()) {
        assert(Date.now() < end, "Expected worker state within eight seconds");
        await setTimeout(20);
      }
    };
    const releaseAll = () => {
      for (const release of releases.values()) release();
      releases.clear();
    };
    try {
      await boss.start();
      await boss.createQueue(discoveryQueue, { retryLimit: 0 });
      for (let index = 0; index < 10; index++)
        await boss.send(discoveryQueue, { runId: String(index) });
      dispose = await registerDiscoveryConcurrency(
        boss,
        directory,
        shutdown.signal,
        async ([job]) => {
          started.push(job.data.runId);
          active++;
          maximum = Math.max(maximum, active);
          await new Promise<void>((resolve) =>
            releases.set(job.data.runId, resolve),
          );
          assert.equal(
            job.signal.aborted,
            false,
            "Changing the setting must not cancel active jobs",
          );
          active--;
          completed.push(job.data.runId);
        },
      );
      await until(() => started.length === 3);
      assert.equal(active, 3);
      writeExecutionSettings(directory, { maxParallelDiscoveries: 2 });
      await setTimeout(200);
      const first = started[0];
      releases.get(first)!();
      releases.delete(first);
      await until(() => completed.length === 1);
      await setTimeout(2200);
      assert.equal(
        started.length,
        3,
        "Queued work waits while the previous workers drain",
      );
      releaseAll();
      await until(() => started.length === 5);
      assert.equal(active, 2);
      assert.equal(maximum, 3);
      writeExecutionSettings(directory, { maxParallelDiscoveries: 3 });
      await setTimeout(200);
      releaseAll();
      await until(() => started.length === 8);
      assert.equal(active, 3);
      assert.equal(new Set(started).size, started.length);
      assert.equal(completed.length, 5);
      shutdown.abort();
      releaseAll();
      await dispose();
      await boss.offWork(discoveryQueue);
      assert.equal(completed.length, 8);
      assert.deepEqual(errors, []);
      const { rows } = await boss
        .getDb()
        .executeSql(
          "SELECT state,count(*)::int AS count FROM pgboss.job GROUP BY state",
        );
      assert.deepEqual(
        Object.fromEntries(rows.map((r) => [r.state, r.count])),
        { completed: 8, created: 2 },
      );
      const before = started.length;
      writeExecutionSettings(directory, { maxParallelDiscoveries: 4 });
      await setTimeout(2200);
      assert.equal(
        started.length,
        before,
        "Shutdown must close the settings watcher",
      );
    } finally {
      shutdown.abort();
      releaseAll();
      await dispose?.();
      await boss.stop({ graceful: false });
      await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
