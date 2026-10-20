import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { Db, PgBoss } from "pg-boss";
import { approvedWorkspaceInput, WorkspaceApprovalError } from "./workspace.ts";
import { recordIntakeEvent } from "./intake-events.ts";
import type {
  CodingRun,
  CodingStep,
  CodingKind,
  CodingDetail,
} from "./coding-types.ts";
export * from "./coding-types.ts";
export const codingQueue = "approved-coding";
export class CodingConflict extends Error {}
export async function initializeCoding(boss: PgBoss) {
  await boss.getDb().executeSql(`
 CREATE TABLE IF NOT EXISTS code_assist.coding_run (
 id uuid PRIMARY KEY,issue_id uuid NOT NULL REFERENCES code_assist.intake_issue(id),planning_id uuid NOT NULL,
 version integer NOT NULL,input jsonb NOT NULL,plan jsonb NOT NULL,identifier text NOT NULL,title text NOT NULL,branch text NOT NULL,
 status text NOT NULL,current_step_id uuid,workspace_id uuid,commit text,error text,pr_url text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(planning_id,version),FOREIGN KEY(planning_id,version) REFERENCES code_assist.plan_version(run_id,number));
 CREATE TABLE IF NOT EXISTS code_assist.coding_step (
 id uuid PRIMARY KEY,run_id uuid NOT NULL REFERENCES code_assist.coding_run(id),job_id uuid NOT NULL,kind text NOT NULL,input_commit text,
 status text NOT NULL,worker_pid integer,result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
 `);
  await boss.createQueue(codingQueue, { retryLimit: 0 });
}
export async function codingTransaction<T>(
  boss: PgBoss,
  action: (db: Db) => Promise<T>,
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    const result = await action(tx.db);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
export async function codingRun(db: Db, id: string): Promise<CodingRun> {
  const { rows } = await db.executeSql(
    "SELECT * FROM code_assist.coding_run WHERE id=$1",
    [id],
  );
  if (!rows[0]) throw new CodingConflict("Coding run not found.");
  return rows[0] as CodingRun;
}
export async function currentCoding(
  db: Db,
  run: CodingRun,
  step?: CodingStep,
  lock = false,
) {
  if (lock)
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [run.issue_id],
    );
  let input;
  try {
    input = await approvedWorkspaceInput(db, run.issue_id);
  } catch (error) {
    if (error instanceof WorkspaceApprovalError) return false;
    throw error;
  }
  const current = await codingRun(db, run.id);
  if (!isDeepStrictEqual(input, run.input) || current.status === "superseded")
    return false;
  if (step) {
    const { rows } = await db.executeSql(
      "SELECT 1 FROM code_assist.coding_step WHERE id=$1 AND job_id=$2 AND status IN ('queued','running')",
      [step.id, step.job_id],
    );
    return current.current_step_id === step.id && rows.length > 0;
  }
  return true;
}
async function enqueue(boss: PgBoss, db: Db, run: CodingRun, kind: CodingKind) {
  const id = randomUUID(),
    job = await boss.send(codingQueue, { stepId: id }, { db });
  if (!job) throw new Error("Could not queue coding.");
  await db.executeSql(
    "INSERT INTO code_assist.coding_step(id,run_id,job_id,kind,input_commit,status) VALUES($1,$2,$3,$4,$5,'queued')",
    [id, run.id, job, kind, run.commit],
  );
  await db.executeSql(
    "UPDATE code_assist.coding_run SET current_step_id=$2,status=$3,error=NULL WHERE id=$1",
    [run.id, id, kind],
  );
  await recordIntakeEvent(boss, db, run.issue_id, "coding_queued", {
    codingId: run.id,
    stepId: id,
    kind,
  });
  return id;
}
export async function syncCoding(boss: PgBoss, db: Db, issueId: string) {
  await db.executeSql(
    "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
    [issueId],
  );
  const input = await approvedWorkspaceInput(db, issueId);
  const existing = await db.executeSql(
    "SELECT id FROM code_assist.coding_run WHERE planning_id=$1 AND version=$2",
    [input.planningId, input.version],
  );
  if (existing.rows.length) return;
  const { rows } = await db.executeSql(
    "SELECT v.document,i.ticket FROM code_assist.plan_version v JOIN code_assist.intake_issue i ON i.id=$3 WHERE v.run_id=$1 AND v.number=$2",
    [input.planningId, input.version, issueId],
  );
  const identifier = rows[0].ticket.identifier as string;
  if (!/^ONE-\d+$/.test(identifier))
    throw new CodingConflict("Coding requires a ONE ticket identifier.");
  const id = randomUUID();
  await db.executeSql(
    "INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'prepare')",
    [
      id,
      issueId,
      input.planningId,
      input.version,
      JSON.stringify(input),
      JSON.stringify(rows[0].document),
      identifier,
      rows[0].ticket.title,
      `feature/${identifier.toLowerCase()}`,
    ],
  );
  await enqueue(boss, db, await codingRun(db, id), "prepare");
}
export async function syncApprovedCoding(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      `SELECT p.issue_id FROM code_assist.planning_run p JOIN code_assist.intake_issue i ON i.current_discovery_id=p.discovery_id JOIN code_assist.discovery_run d ON d.id=p.discovery_id WHERE p.status='approved' AND i.eligible AND i.removed_at IS NULL AND jsonb_array_length(d.snapshots)=1 AND d.snapshots->0->>'name'='internal-chat-ui'`,
    );
  for (const row of rows)
    await codingTransaction(boss, (db) => syncCoding(boss, db, row.issue_id));
}
export async function startCoding(boss: PgBoss, id: string, jobId: string) {
  return codingTransaction(boss, async (db) => {
    const { rows } = await db.executeSql(
      "SELECT * FROM code_assist.coding_step WHERE id=$1",
      [id],
    );
    const step = rows[0] as CodingStep | undefined;
    if (!step || step.job_id !== jobId) return null;
    const run = await codingRun(db, step.run_id);
    if (
      !(await currentCoding(db, run, step, true)) ||
      step.status !== "queued" ||
      (await boss.getJobById(codingQueue, jobId, { db }))?.state !== "active"
    )
      return null;
    await db.executeSql(
      "UPDATE code_assist.coding_step SET status='running',worker_pid=$2 WHERE id=$1",
      [id, process.pid],
    );
    await recordIntakeEvent(boss, db, run.issue_id, "coding_started", {
      codingId: run.id,
      stepId: id,
      kind: step.kind,
    });
    return {
      run,
      step: { ...step, status: "running" as const, worker_pid: process.pid },
    };
  });
}
export async function finishCoding(
  boss: PgBoss,
  run: CodingRun,
  step: CodingStep,
  result: Record<string, unknown>,
  next: CodingKind | "needs_direction" | "pr_open",
  commit?: string,
  workspaceId?: string,
  prUrl?: string,
) {
  return codingTransaction(boss, async (db) => {
    if (!(await currentCoding(db, run, step, true))) return false;
    const job = await boss.getJobById(codingQueue, step.job_id, { db });
    if (job?.state !== "active") return false;
    await boss.complete(
      codingQueue,
      { id: step.job_id, retryCount: job.retryCount },
      null,
      { db },
    );
    if (
      (await boss.getJobById(codingQueue, step.job_id, { db }))?.state !==
      "completed"
    )
      return false;
    await db.executeSql(
      "UPDATE code_assist.coding_step SET status='completed',result=$2,finished_at=now() WHERE id=$1",
      [step.id, JSON.stringify(result)],
    );
    await db.executeSql(
      "UPDATE code_assist.coding_run SET commit=COALESCE($2,commit),workspace_id=COALESCE($3,workspace_id),pr_url=COALESCE($4,pr_url),status=$5 WHERE id=$1",
      [run.id, commit ?? null, workspaceId ?? null, prUrl ?? null, next],
    );
    await recordIntakeEvent(boss, db, run.issue_id, "coding_completed", {
      codingId: run.id,
      stepId: step.id,
      kind: step.kind,
      commit: commit ?? run.commit,
    });
    if (next === "needs_direction" || next === "pr_open")
      await recordIntakeEvent(
        boss,
        db,
        run.issue_id,
        next === "pr_open" ? "coding_pr_open" : "coding_direction",
        { codingId: run.id, stepId: step.id },
        true,
      );
    else await enqueue(boss, db, await codingRun(db, run.id), next);
    return true;
  });
}
export async function failCoding(
  boss: PgBoss,
  run: CodingRun,
  step: CodingStep,
  message: string,
) {
  return codingTransaction(boss, async (db) => {
    if (!(await currentCoding(db, run, step, true))) {
      await db.executeSql(
        "UPDATE code_assist.coding_run SET status='superseded' WHERE id=$1 AND current_step_id=$2",
        [run.id, step.id],
      );
      return;
    }
    await db.executeSql(
      "UPDATE code_assist.coding_step SET status='failed',error=$2,finished_at=now() WHERE id=$1",
      [step.id, message],
    );
    await db.executeSql(
      "UPDATE code_assist.coding_run SET status='failed',error=$2 WHERE id=$1",
      [run.id, message],
    );
    await recordIntakeEvent(
      boss,
      db,
      run.issue_id,
      "coding_failed",
      { codingId: run.id, stepId: step.id },
      true,
    );
  });
}
export async function retryCoding(
  boss: PgBoss,
  issueId: string,
  runId: string,
  stepId: string,
) {
  return codingTransaction(boss, async (db) => {
    const run = await codingRun(db, runId);
    if (
      run.issue_id !== issueId ||
      !(await currentCoding(db, run, undefined, true)) ||
      run.status !== "failed" ||
      run.current_step_id !== stepId
    )
      throw new CodingConflict(
        "This failed coding step changed. Refresh before retrying.",
      );
    const { rows } = await db.executeSql(
      "SELECT * FROM code_assist.coding_step WHERE id=$1",
      [stepId],
    );
    return enqueue(boss, db, run, rows[0].kind);
  });
}
export async function readCoding(
  db: Db,
  issueId: string,
): Promise<CodingDetail[]> {
  const { rows } = await db.executeSql(
    "SELECT * FROM code_assist.coding_run WHERE issue_id=$1 ORDER BY created_at",
    [issueId],
  );
  return Promise.all(
    (rows as CodingRun[]).map(async (run) => ({
      ...run,
      steps: (
        await db.executeSql(
          "SELECT * FROM code_assist.coding_step WHERE run_id=$1 ORDER BY created_at",
          [run.id],
        )
      ).rows as CodingStep[],
    })),
  );
}

export async function changeCodingBranch(
  boss: PgBoss,
  directory: string,
  issueId: string,
  runId: string,
  stepId: string,
  branch: string,
) {
  try {
    await promisify(execFile)("/usr/bin/git", [
      "check-ref-format",
      "--branch",
      branch,
    ]);
  } catch {
    throw new CodingConflict("Enter a valid Git branch name.");
  }
  try {
    await access(join(directory, "coding", runId, "publication.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return codingTransaction(boss, async (db) => {
      const run = await codingRun(db, runId);
      if (
        run.issue_id !== issueId ||
        !(await currentCoding(db, run, undefined, true)) ||
        run.status !== "failed" ||
        run.current_step_id !== stepId ||
        branch === run.branch
      )
        throw new CodingConflict(
          "Choose a new branch for the current failed coding step.",
        );
      await db.executeSql(
        "UPDATE code_assist.coding_run SET branch=$2 WHERE id=$1",
        [run.id, branch],
      );
      await recordIntakeEvent(boss, db, issueId, "coding_branch_changed", {
        codingId: run.id,
        previousBranch: run.branch,
        branch,
      });
      const { rows } = await db.executeSql(
        "SELECT kind FROM code_assist.coding_step WHERE id=$1",
        [stepId],
      );
      return enqueue(boss, db, { ...run, branch }, rows[0].kind);
    });
  }
  throw new CodingConflict(
    "Reconcile the previous publication attempt before changing branches.",
  );
}
