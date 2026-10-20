import { randomUUID } from "node:crypto";
import type { Db, PgBoss } from "pg-boss";
import { logger } from "./logging.ts";

export const probeQueue = "engine-probe";
type ProbeJob = { probeId: string; step: "prepare" | "finish" };

export async function initializeProbes(boss: PgBoss) {
  await boss.getDb().executeSql(`
    CREATE SCHEMA IF NOT EXISTS code_assist;
    CREATE TABLE IF NOT EXISTS code_assist.engine_probe (
      id uuid PRIMARY KEY,
      state text NOT NULL CHECK (state IN ('queued', 'waiting', 'confirmed', 'completed')),
      job_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS code_assist.engine_probe_event (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      probe_id uuid NOT NULL REFERENCES code_assist.engine_probe(id),
      state text NOT NULL,
      release text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // The brief requires explicit retry after failure, not automatic repetition.
  await boss.createQueue(probeQueue, { retryLimit: 0 });
}

async function recordEvent(db: Db, id: string, state: string, release: string) {
  await db.executeSql(
    `INSERT INTO code_assist.engine_probe_event (probe_id, state, release)
     VALUES ($1, $2, $3)`,
    [id, state, release],
  );
}

export async function createProbe(boss: PgBoss, release: string) {
  const id = randomUUID();
  const tx = await boss.getDb().beginTransaction!();
  try {
    const jobId = await boss.send(
      probeQueue,
      { probeId: id, step: "prepare" } satisfies ProbeJob,
      { db: tx.db },
    );
    await tx.db.executeSql(
      "INSERT INTO code_assist.engine_probe (id, state, job_id) VALUES ($1, 'queued', $2)",
      [id, jobId],
    );
    await recordEvent(tx.db, id, "queued", release);
    await tx.commit();
    return id;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function confirmProbe(boss: PgBoss, id: string, release: string) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    const { rows } = await tx.db.executeSql(
      "SELECT state FROM code_assist.engine_probe WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (rows[0]?.state !== "waiting")
      throw new Error("Probe must be waiting before confirmation");
    const jobId = await boss.send(
      probeQueue,
      { probeId: id, step: "finish" } satisfies ProbeJob,
      { db: tx.db },
    );
    await tx.db.executeSql(
      "UPDATE code_assist.engine_probe SET state = 'confirmed', job_id = $2 WHERE id = $1",
      [id, jobId],
    );
    await recordEvent(tx.db, id, "confirmed", release);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function registerProbeWorker(boss: PgBoss, release: string) {
  // These handlers only write SQL. Agent/network work must stay outside transactions.
  await boss.work<ProbeJob, unknown, { transactional: true }>(
    probeQueue,
    { transactional: true },
    async ([job], db) => {
      const log = logger.child({ job_id: job.id, attempt_id: randomUUID() });
      log.event("info", "job.started", "Probe step started", {
        step: job.data.step,
        probe_id: job.data.probeId,
      });
      try {
        const { probeId, step } = job.data;
        if (step !== "prepare" && step !== "finish")
          throw new Error("Unknown probe step");
        const expected = step === "prepare" ? "queued" : "confirmed";
        const next = step === "prepare" ? "waiting" : "completed";
        const { rows } = await db.executeSql(
          `UPDATE code_assist.engine_probe SET state = $3
         WHERE id = $1 AND state = $2 AND job_id = $4 RETURNING id`,
          [probeId, expected, next, job.id],
        );
        if (!rows.length)
          throw new Error("Probe job does not match current state");
        await recordEvent(db, probeId, next, release);
        // pg-boss commits after this callback returns; this is not a completion claim.
        log.event(
          "info",
          "job.result_prepared",
          "Probe result prepared for commit",
          { state: next, probe_id: probeId },
        );
        return { probeId, state: next, release };
      } catch (error) {
        log.event("error", "job.failed", "Probe step failed", {
          error,
          probe_id: job.data.probeId,
        });
        throw error;
      }
    },
  );
}

export async function readProbe(boss: PgBoss, id: string) {
  const { rows } = await boss
    .getDb()
    .executeSql("SELECT * FROM code_assist.engine_probe WHERE id = $1", [id]);
  if (!rows.length) throw new Error("Probe not found");
  const { rows: events } = await boss
    .getDb()
    .executeSql(
      "SELECT state, release, created_at FROM code_assist.engine_probe_event WHERE probe_id = $1 ORDER BY id",
      [id],
    );
  const job = await boss.getJobById(probeQueue, rows[0].job_id);
  return { ...rows[0], events, job };
}
