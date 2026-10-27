import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { codingQueue } from "../src/coding.ts";
import { registerCodingConcurrency } from "../src/coding-concurrency.ts";
import { discoveryQueue } from "../src/discovery.ts";
import { registerDiscoveryConcurrency } from "../src/discovery-concurrency.ts";
import { writeExecutionSettings } from "../src/execution-settings.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_DATABASE_URL is required");

for (const { queue, register, setting } of [
  {
    queue: discoveryQueue,
    register: registerDiscoveryConcurrency,
    setting: "maxParallelDiscoveries",
  },
  {
    queue: codingQueue,
    register: registerCodingConcurrency,
    setting: "maxParallelCodingSessions",
  },
] as const)
  test(
    `native ${queue} workers respect the saved maximum and drain active jobs before live changes`,
    { timeout: 35_000 },
    async () => {
      const root = join(
        import.meta.dirname,
        "../../../.tmp/execution-concurrency-tests",
      );
      await mkdir(root, { recursive: true });
      const directory = await mkdtemp(join(root, "integration-"));
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      const database = "execution_parallel_" + randomUUID().replaceAll("-", "");
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
          assert(
            Date.now() < end,
            "Expected worker state within eight seconds",
          );
          await setTimeout(20);
        }
      };
      const releaseAll = () => {
        for (const release of releases.values()) release();
        releases.clear();
      };
      try {
        await boss.start();
        await boss.createQueue(queue, { retryLimit: 0 });
        for (let index = 0; index < 10; index++)
          await boss.send(queue, {
            [queue === codingQueue ? "stepId" : "runId"]: String(index),
          });
        dispose = await register(
          boss,
          directory,
          shutdown.signal,
          async ([job]) => {
            const id = "stepId" in job.data ? job.data.stepId : job.data.runId;
            if (queue === codingQueue) {
              assert(
                "retryCount" in job,
                "Coding recovery needs native retry metadata",
              );
              assert.equal(job.retryCount, 0);
            }
            started.push(id);
            active++;
            maximum = Math.max(maximum, active);
            await new Promise<void>((resolve) => releases.set(id, resolve));
            assert.equal(
              job.signal.aborted,
              false,
              "Changing the setting must not cancel active jobs",
            );
            active--;
            completed.push(id);
          },
        );
        await until(() => started.length === 3);
        assert.equal(active, 3);
        writeExecutionSettings(directory, {
          maxParallelDiscoveries: 4,
          maxParallelCodingSessions: 4,
          [setting]: 3,
        });
        await setTimeout(200);
        releases.get(started[0])!();
        releases.delete(started[0]);
        await until(() => started.length === 4);
        assert.equal(
          active,
          3,
          "Changing the other queue must not drain this queue",
        );
        writeExecutionSettings(directory, {
          maxParallelDiscoveries: 3,
          maxParallelCodingSessions: 3,
          [setting]: 2,
        });
        await setTimeout(200);
        const first = started[1];
        releases.get(first)!();
        releases.delete(first);
        await until(() => completed.length === 2);
        await setTimeout(2200);
        assert.equal(
          started.length,
          4,
          "Queued work waits while the previous workers drain",
        );
        releaseAll();
        await until(() => started.length === 6);
        assert.equal(active, 2);
        assert.equal(maximum, 3);
        writeExecutionSettings(directory, {
          maxParallelDiscoveries: 3,
          maxParallelCodingSessions: 3,
        });
        await setTimeout(200);
        releaseAll();
        await until(() => started.length === 9);
        assert.equal(active, 3);
        assert.equal(new Set(started).size, started.length);
        assert.equal(completed.length, 6);
        shutdown.abort();
        releaseAll();
        await dispose();
        await boss.offWork(queue);
        assert.equal(completed.length, 9);
        assert.deepEqual(errors, []);
        const { rows } = await boss
          .getDb()
          .executeSql(
            "SELECT state,count(*)::int AS count FROM pgboss.job GROUP BY state",
          );
        assert.deepEqual(
          Object.fromEntries(rows.map((r) => [r.state, r.count])),
          { completed: 9, created: 1 },
        );
        const before = started.length;
        writeExecutionSettings(directory, {
          maxParallelDiscoveries: 3,
          maxParallelCodingSessions: 3,
          [setting]: 4,
        });
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
