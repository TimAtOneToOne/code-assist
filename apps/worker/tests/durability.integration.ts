import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  confirmProbe,
  createProbe,
  initializeProbes,
  probeQueue,
  readProbe,
} from "../src/probe.ts";

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl)
  throw new Error(
    "TEST_DATABASE_URL is required (must permit creating test databases)",
  );

async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await setTimeout(100);
  }
  throw new Error("Timed out waiting for test state");
}

test("durable probe, process restart, transaction rollback and manual retry", async () => {
  const database = `code_assist_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const boss = new PgBoss(url.toString());
  boss.on("error", (error) => {
    throw error;
  });
  const children: ChildProcess[] = [];
  let workerLog = "";

  function startWorker(release: string) {
    const child = spawn(process.execPath, ["src/main.ts"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        CODE_ASSIST_DATABASE_URL: url.toString(),
        CODE_ASSIST_COMMIT: release,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    child.stdout!.on("data", (data) => {
      workerLog += data;
    });
    child.stderr!.on("data", (data) => {
      workerLog += data;
    });
    return child;
  }

  async function stopWorker(child: ChildProcess, signal: NodeJS.Signals) {
    const exited = once(child, "exit");
    child.kill(signal);
    await exited;
  }

  try {
    await boss.start();
    await initializeProbes(boss);

    const id = await createProbe(boss, "producer");
    assert.equal((await readProbe(boss, id)).job?.state, "created");
    const first = startWorker("release-a");
    await waitFor(
      () => readProbe(boss, id),
      (probe) => probe.state === "waiting",
    );
    await stopWorker(first, "SIGKILL");
    assert.equal((await readProbe(boss, id)).state, "waiting");

    // Confirmation is durable even when no worker is running.
    await confirmProbe(boss, id, "operator");
    await assert.rejects(confirmProbe(boss, id, "operator"), /must be waiting/);
    assert.equal((await readProbe(boss, id)).job?.state, "created");
    const second = startWorker("release-b");
    const completed = await waitFor(
      () => readProbe(boss, id),
      (probe) => probe.state === "completed",
    );
    assert.deepEqual(
      completed.events.map((event: { state: string }) => event.state),
      ["queued", "waiting", "confirmed", "completed"],
    );
    assert.equal(completed.events.at(-1).release, "release-b");
    await stopWorker(second, "SIGTERM");
    assert.equal(second.exitCode, 0);

    // Hold a real handler in flight, then prove SIGTERM drains rather than kills it.
    const drainId = await createProbe(boss, "producer");
    const drainProbe = await readProbe(boss, drainId);
    const queuedId = await createProbe(boss, "producer");
    const blocker = new pg.Client({ connectionString: url.toString() });
    await blocker.connect();
    let draining: ChildProcess | undefined;
    let drained: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "LOCK TABLE code_assist.engine_probe IN ACCESS EXCLUSIVE MODE",
      );
      draining = startWorker("release-drain");
      await waitFor(
        () => boss.getJobById(probeQueue, drainProbe.job_id),
        (job) => job?.state === "active",
      );
      drained = once(draining, "exit");
      draining.kill("SIGTERM");
      await waitFor(
        async () => workerLog,
        (log) =>
          log.includes(
            '"event":"worker.draining","signal":"SIGTERM","release":"release-drain"',
          ),
      );
      assert.equal(draining.exitCode, null);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    await drained;
    assert.equal(draining?.exitCode, 0);
    assert.equal((await readProbe(boss, drainId)).state, "waiting");
    assert.equal((await readProbe(boss, queuedId)).job?.state, "created");

    // A failed event insert must roll back the state change and job completion.
    await boss.getDb().executeSql(`
      CREATE FUNCTION code_assist.reject_probe_event() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected event failure'; END $$;
      CREATE TRIGGER reject_probe_event BEFORE INSERT ON code_assist.engine_probe_event
      FOR EACH ROW WHEN (NEW.state = 'waiting')
      EXECUTE FUNCTION code_assist.reject_probe_event();
    `);
    const failureId = await createProbe(boss, "producer");
    const third = startWorker("release-c");
    const failed = await waitFor(
      () => readProbe(boss, failureId),
      (probe) => probe.job?.state === "failed",
    );
    assert.equal(failed.state, "queued");
    assert.equal(failed.events.length, 1);
    assert.equal(failed.job?.retryCount, 0);
    await boss
      .getDb()
      .executeSql(
        "DROP TRIGGER reject_probe_event ON code_assist.engine_probe_event",
      );
    await boss.retry(probeQueue, failed.job_id);
    await waitFor(
      () => readProbe(boss, failureId),
      (probe) => probe.state === "waiting",
    );
    await stopWorker(third, "SIGTERM");
    assert.equal(third.exitCode, 0);

    // State and enqueue share a transaction, including rollback before commit.
    const tx = await boss.getDb().beginTransaction!();
    const rolledBackId = randomUUID();
    const jobId = await boss.send(
      probeQueue,
      { probeId: rolledBackId, step: "prepare" },
      { db: tx.db },
    );
    await tx.db.executeSql(
      "INSERT INTO code_assist.engine_probe (id, state, job_id) VALUES ($1, 'queued', $2)",
      [rolledBackId, jobId],
    );
    await tx.rollback();
    assert.equal(await boss.getJobById(probeQueue, jobId!), null);
    await assert.rejects(readProbe(boss, rolledBackId), /not found/);
  } catch (error) {
    console.error(workerLog);
    throw error;
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null)
        await stopWorker(child, "SIGKILL");
    }
    await boss.stop();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
