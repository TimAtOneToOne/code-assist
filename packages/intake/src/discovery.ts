import { createHash, randomUUID } from "node:crypto";
import type { Db, PgBoss } from "pg-boss";
import type { Ticket } from "./linear.ts";

export const discoveryQueue = "initial-discovery";
export const currentAttention = `(e.type='repository_needed' OR
  (e.details->>'runId'=i.current_discovery_id::text AND EXISTS (
    SELECT 1 FROM code_assist.discovery_run d WHERE d.id=i.current_discovery_id
    AND ((e.type='discovery_questions' AND d.status='questions') OR (e.type='discovery_failed' AND d.status='failed'))
  )))`;
export class DiscoveryConflict extends Error {}
export type DiscoveryResult = {
  summary: string;
  findings: { repository: string; file: string; detail: string }[];
  questions: { question: string; context: string; options: string[] }[];
};
export type RepositorySnapshot = {
  name: string;
  source: string;
  commit: string;
  directory: string;
};
export type DiscoveryRun = {
  id: string;
  issue_id: string;
  job_id: string;
  input_hash: string;
  ticket: Ticket;
  repositories: string[];
  snapshots: RepositorySnapshot[] | null;
  status:
    "queued" | "running" | "questions" | "ready" | "failed" | "superseded";
  result: DiscoveryResult | null;
  answers: string[] | null;
  notes: string | null;
  thread_id: string | null;
  error: string | null;
  worker_pid: number | null;
  created_at: Date;
  finished_at: Date | null;
};

export async function initializeDiscovery(boss: PgBoss) {
  await boss.getDb().executeSql(`
    ALTER TABLE code_assist.intake_issue ADD COLUMN IF NOT EXISTS current_discovery_id uuid;
    CREATE TABLE IF NOT EXISTS code_assist.discovery_run (
      id uuid PRIMARY KEY, issue_id uuid NOT NULL REFERENCES code_assist.intake_issue(id),
      job_id uuid NOT NULL, input_hash text NOT NULL, ticket jsonb NOT NULL, repositories jsonb NOT NULL,
      snapshots jsonb, status text NOT NULL, result jsonb, answers jsonb, notes text,
      thread_id text, error text, worker_pid integer,
      created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
  `);
  await boss.createQueue(discoveryQueue, { retryLimit: 0 });
}

export function discoveryHash(ticket: Ticket, repositories: string[]) {
  return createHash("sha256")
    .update(JSON.stringify({ ticket, repositories: [...repositories].sort() }))
    .digest("hex");
}

async function event(
  boss: PgBoss,
  db: Db,
  issueId: string,
  type: string,
  details: Record<string, unknown>,
  notify = false,
) {
  const { rows } = await db.executeSql(
    "INSERT INTO code_assist.intake_event(issue_id,type,details) VALUES($1,$2,$3) RETURNING id",
    [issueId, type, JSON.stringify(details)],
  );
  if (!notify) return;
  const { rows: notifications } = await db.executeSql(
    "INSERT INTO code_assist.attention_outbox(issue_id,event_id) VALUES($1,$2) RETURNING id",
    [issueId, rows[0].id],
  );
  const jobId = await boss.send(
    "attention-notification",
    { notificationId: notifications[0].id },
    { db },
  );
  if (!jobId) throw new Error("Could not queue discovery notification.");
  await db.executeSql(
    "UPDATE code_assist.attention_outbox SET job_id=$2 WHERE id=$1",
    [notifications[0].id, jobId],
  );
}

// Caller owns a short transaction; issue lock serializes input changes and result acceptance.
export async function syncDiscovery(
  boss: PgBoss,
  db: Db,
  issueId: string,
  force = false,
) {
  const { rows } = await db.executeSql(
    `SELECT *,COALESCE(selected_repositories,array_remove(ARRAY[selected_repository],NULL)) AS repositories
     FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE`,
    [issueId],
  );
  const item = rows[0];
  if (!item) throw new DiscoveryConflict("Ticket not found.");
  const current = item.current_discovery_id
    ? await readDiscovery(db, item.current_discovery_id)
    : null;
  const hash = discoveryHash(item.ticket, item.repositories);
  const eligible =
    item.eligible && !item.removed_at && item.repositories.length;
  if (
    current &&
    eligible &&
    current.input_hash === hash &&
    current.status !== "superseded"
  ) {
    if (!force || ["queued", "running"].includes(current.status))
      return current.id;
  }
  if (current && current.status !== "superseded") {
    await db.executeSql(
      "UPDATE code_assist.discovery_run SET status='superseded' WHERE id=$1",
      [current.id],
    );
    await event(boss, db, issueId, "discovery_superseded", {
      runId: current.id,
    });
  }
  if (!eligible) return null;
  const id = randomUUID();
  const jobId = await boss.send(discoveryQueue, { runId: id }, { db });
  if (!jobId) throw new Error("Could not queue initial discovery.");
  await db.executeSql(
    `INSERT INTO code_assist.discovery_run(id,issue_id,job_id,input_hash,ticket,repositories,status)
     VALUES($1,$2,$3,$4,$5,$6,'queued')`,
    [
      id,
      issueId,
      jobId,
      hash,
      JSON.stringify(item.ticket),
      JSON.stringify(item.repositories),
    ],
  );
  await db.executeSql(
    "UPDATE code_assist.intake_issue SET current_discovery_id=$2 WHERE id=$1",
    [issueId, id],
  );
  await event(boss, db, issueId, "discovery_queued", { runId: id });
  return id;
}

export async function syncSelectedDiscoveries(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE selected_at IS NOT NULL",
    );
  for (const item of rows) {
    const tx = await boss.getDb().beginTransaction!();
    try {
      await syncDiscovery(boss, tx.db, item.id);
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}

export async function readDiscovery(
  db: Db,
  id: string,
): Promise<DiscoveryRun | null> {
  return (
    (
      await db.executeSql(
        "SELECT * FROM code_assist.discovery_run WHERE id=$1",
        [id],
      )
    ).rows[0] ?? null
  );
}

export async function isCurrentDiscovery(db: Db, run: DiscoveryRun) {
  const { rows } = await db.executeSql(
    `SELECT 1 FROM code_assist.intake_issue i JOIN code_assist.discovery_run d ON d.id=i.current_discovery_id
     WHERE i.id=$1 AND d.id=$2 AND d.job_id=$3 AND d.status IN ('queued','running') AND i.eligible AND i.removed_at IS NULL`,
    [run.issue_id, run.id, run.job_id],
  );
  return rows.length > 0;
}

export async function startDiscovery(boss: PgBoss, id: string, jobId: string) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    let run = await readDiscovery(tx.db, id);
    if (!run || run.job_id !== jobId) {
      await tx.commit();
      return null;
    }
    await tx.db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
    run = await readDiscovery(tx.db, id);
    if (
      !run ||
      run.job_id !== jobId ||
      !(await isCurrentDiscovery(tx.db, run)) ||
      run.status !== "queued"
    ) {
      await tx.commit();
      return null;
    }
    await tx.db.executeSql(
      "UPDATE code_assist.discovery_run SET status='running',worker_pid=$2,error=NULL WHERE id=$1",
      [id, process.pid],
    );
    await event(boss, tx.db, run.issue_id, "discovery_started", { runId: id });
    await tx.commit();
    return { ...run, status: "running" as const, worker_pid: process.pid };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function finishDiscovery(
  boss: PgBoss,
  run: DiscoveryRun,
  result: DiscoveryResult | null,
  errorMessage: string | null = null,
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    await tx.db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
    if (!(await isCurrentDiscovery(tx.db, run))) {
      await tx.commit();
      return false;
    }
    if (!errorMessage) {
      const job = await boss.getJobById(discoveryQueue, run.job_id, {
        db: tx.db,
      });
      if (job?.state !== "active") {
        await tx.commit();
        return false;
      }
      await boss.complete(
        discoveryQueue,
        { id: run.job_id, retryCount: job.retryCount },
        null,
        { db: tx.db },
      );
      if (
        (await boss.getJobById(discoveryQueue, run.job_id, { db: tx.db }))
          ?.state !== "completed"
      ) {
        await tx.commit();
        return false;
      }
    }
    const status = errorMessage ? "failed" : "questions";
    await tx.db.executeSql(
      "UPDATE code_assist.discovery_run SET status=$2,result=$3,error=$4,finished_at=now() WHERE id=$1",
      [run.id, status, result ? JSON.stringify(result) : null, errorMessage],
    );
    await event(
      boss,
      tx.db,
      run.issue_id,
      errorMessage ? "discovery_failed" : "discovery_questions",
      { runId: run.id },
      true,
    );
    await tx.commit();
    return true;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function retryDiscovery(
  boss: PgBoss,
  issueId: string,
  expectedRunId: string,
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    const { rows } = await tx.db.executeSql(
      "SELECT current_discovery_id,eligible,removed_at FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [issueId],
    );
    const item = rows[0];
    if (
      !item ||
      item.current_discovery_id !== expectedRunId ||
      !item.eligible ||
      item.removed_at
    )
      throw new DiscoveryConflict(
        "This ticket changed. Refresh before restarting discovery.",
      );
    const run = await readDiscovery(tx.db, expectedRunId);
    if (run?.status !== "failed")
      throw new DiscoveryConflict("Only a failed discovery can be retried.");
    const id = await syncDiscovery(boss, tx.db, issueId, true);
    await tx.commit();
    return id;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function answerDiscovery(
  boss: PgBoss,
  issueId: string,
  runId: string,
  answers: string[],
  notes: string,
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    const { rows } = await tx.db.executeSql(
      "SELECT * FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [issueId],
    );
    const item = rows[0],
      run = await readDiscovery(tx.db, runId);
    if (
      !item ||
      item.current_discovery_id !== runId ||
      !item.eligible ||
      item.removed_at ||
      !run?.result
    )
      throw new DiscoveryConflict(
        "The ticket or repository scope changed. Refresh to see the current questions.",
      );
    if (
      run.status === "ready" &&
      JSON.stringify(run.answers) === JSON.stringify(answers) &&
      run.notes === notes
    ) {
      await tx.commit();
      return;
    }
    if (run.status !== "questions")
      throw new DiscoveryConflict(
        "These questions have already been answered or replaced. Refresh the page.",
      );
    if (
      answers.length !== run.result.questions.length ||
      answers.some((answer) => !answer.trim())
    )
      throw new DiscoveryConflict(
        "Answer each question before confirming scope.",
      );
    await tx.db.executeSql(
      "UPDATE code_assist.discovery_run SET status='ready',answers=$2,notes=$3 WHERE id=$1",
      [runId, JSON.stringify(answers), notes],
    );
    await event(boss, tx.db, issueId, "discovery_answered", { runId });
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function reconcileDiscoveryFailures(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT * FROM code_assist.discovery_run WHERE status IN ('queued','running')",
    );
  for (const run of rows as DiscoveryRun[]) {
    const job = await boss.getJobById(discoveryQueue, run.job_id);
    let interrupted = false;
    if (run.worker_pid && run.status === "running") {
      try {
        process.kill(run.worker_pid, 0);
      } catch (error) {
        interrupted = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    }
    if (
      interrupted ||
      !job ||
      ["failed", "cancelled", "completed"].includes(job.state)
    ) {
      if (job?.state === "active" && interrupted)
        await boss.fail(discoveryQueue, run.job_id);
      await finishDiscovery(
        boss,
        run,
        null,
        "Codex discovery was interrupted or its job expired. Retry to inspect the ticket again.",
      );
    }
  }
}

export async function restartInterruptedDiscovery(
  boss: PgBoss,
  run: DiscoveryRun,
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    await tx.db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
    if (await isCurrentDiscovery(tx.db, run)) {
      await tx.db.executeSql(
        "UPDATE code_assist.discovery_run SET status='failed',error='Interrupted by worker shutdown.' WHERE id=$1",
        [run.id],
      );
      await event(boss, tx.db, run.issue_id, "discovery_interrupted", {
        runId: run.id,
      });
      const next = await syncDiscovery(boss, tx.db, run.issue_id, true);
      if (next && run.snapshots)
        await tx.db.executeSql(
          "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
          [next, JSON.stringify(run.snapshots)],
        );
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
