import { syncCoding } from "./coding.ts";
import { createHash, randomUUID } from "node:crypto";
import type { Db, PgBoss } from "pg-boss";
import type { DiscoveryRun } from "./discovery.ts";
import { recordIntakeEvent } from "./intake-events.ts";
import {
  blockingFindings,
  parsePlan,
  parseReview,
  type PlanningRun,
  type PlanningStep,
  type PlanningInput,
  type PlanningDetail,
  type PlanVersion,
  type PlanFeedback,
  type PlanApproval,
} from "./planning-types.ts";
export * from "./planning-types.ts";
export const planningQueue = "adversarial-planning";
export class PlanningConflict extends Error {}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function initializePlanning(boss: PgBoss) {
  await boss.getDb().executeSql(`
    CREATE TABLE IF NOT EXISTS code_assist.planning_run (
      id uuid PRIMARY KEY, issue_id uuid NOT NULL REFERENCES code_assist.intake_issue(id),
      discovery_id uuid NOT NULL UNIQUE REFERENCES code_assist.discovery_run(id), input_hash text NOT NULL,
      current_step_id uuid, current_version integer NOT NULL DEFAULT 0, status text NOT NULL,
      error text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS code_assist.planning_step (
      id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES code_assist.planning_run(id), job_id uuid NOT NULL,
      kind text NOT NULL, version integer NOT NULL, input jsonb NOT NULL, status text NOT NULL,
      worker_pid integer, session_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS code_assist.plan_version (
      run_id uuid NOT NULL REFERENCES code_assist.planning_run(id), number integer NOT NULL,
      step_id uuid NOT NULL UNIQUE REFERENCES code_assist.planning_step(id), hash text NOT NULL, document jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,number)
    );
    CREATE TABLE IF NOT EXISTS code_assist.plan_review (
      run_id uuid NOT NULL, version integer NOT NULL, step_id uuid NOT NULL UNIQUE REFERENCES code_assist.planning_step(id),
      result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,version),
      FOREIGN KEY(run_id,version) REFERENCES code_assist.plan_version(run_id,number)
    );
    CREATE TABLE IF NOT EXISTS code_assist.plan_feedback (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL, version integer NOT NULL,
      note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(run_id,version) REFERENCES code_assist.plan_version(run_id,number)
    );
    CREATE TABLE IF NOT EXISTS code_assist.plan_approval (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL, version integer NOT NULL,
      plan_hash text NOT NULL, input_hash text NOT NULL, approver text NOT NULL, accepted_medium_ids jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,version),
      FOREIGN KEY(run_id,version) REFERENCES code_assist.plan_version(run_id,number)
    );
  `);
  await boss.createQueue(planningQueue, { retryLimit: 0 });
}
async function transaction<T>(boss: PgBoss, action: (db: Db) => Promise<T>) {
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
async function readRun(db: Db, id: string): Promise<PlanningRun | null> {
  return (
    (
      await db.executeSql(
        "SELECT * FROM code_assist.planning_run WHERE id=$1",
        [id],
      )
    ).rows[0] ?? null
  );
}
export async function readPlanningStep(
  db: Db,
  id: string,
): Promise<PlanningStep | null> {
  return (
    (
      await db.executeSql(
        "SELECT * FROM code_assist.planning_step WHERE id=$1",
        [id],
      )
    ).rows[0] ?? null
  );
}
async function versions(db: Db, runId: string): Promise<PlanVersion[]> {
  return (
    await db.executeSql(
      "SELECT v.*,r.result AS review FROM code_assist.plan_version v LEFT JOIN code_assist.plan_review r ON r.run_id=v.run_id AND r.version=v.number WHERE v.run_id=$1 ORDER BY v.number",
      [runId],
    )
  ).rows as PlanVersion[];
}
async function feedback(db: Db, runId: string): Promise<PlanFeedback[]> {
  return (
    await db.executeSql(
      "SELECT version,note,created_at FROM code_assist.plan_feedback WHERE run_id=$1 ORDER BY id",
      [runId],
    )
  ).rows as PlanFeedback[];
}
async function inputFor(db: Db, run: PlanningRun): Promise<PlanningInput> {
  const discovery = (
    await db.executeSql("SELECT * FROM code_assist.discovery_run WHERE id=$1", [
      run.discovery_id,
    ])
  ).rows[0] as DiscoveryRun;
  return {
    discovery,
    versions: await versions(db, run.id),
    feedback: await feedback(db, run.id),
  };
}
async function enqueue(
  boss: PgBoss,
  db: Db,
  run: PlanningRun,
  kind: PlanningStep["kind"],
  version: number,
  input?: PlanningInput,
) {
  const id = randomUUID();
  const jobId = await boss.send(planningQueue, { stepId: id }, { db });
  if (!jobId) throw new Error("Could not queue planning step.");
  await db.executeSql(
    "INSERT INTO code_assist.planning_step(id,run_id,job_id,kind,version,input,status) VALUES($1,$2,$3,$4,$5,$6,'queued')",
    [
      id,
      run.id,
      jobId,
      kind,
      version,
      JSON.stringify(input ?? (await inputFor(db, run))),
    ],
  );
  const status =
    kind === "review" ? "reviewing" : version === 1 ? "drafting" : "revising";
  await db.executeSql(
    "UPDATE code_assist.planning_run SET current_step_id=$2,status=$3,error=NULL WHERE id=$1",
    [run.id, id, status],
  );
  await recordIntakeEvent(boss, db, run.issue_id, "planning_queued", {
    planningId: run.id,
    stepId: id,
    kind,
    version,
  });
  return id;
}
// Discovery/issue changes and planning commands share the issue-row lock.
export async function syncPlanning(boss: PgBoss, db: Db, discoveryId: string) {
  const { rows } = await db.executeSql(
    "SELECT d.* FROM code_assist.discovery_run d JOIN code_assist.intake_issue i ON i.current_discovery_id=d.id WHERE d.id=$1 AND d.status='ready' AND i.eligible AND i.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM code_assist.intake_event e WHERE e.issue_id=i.id AND e.type='issue_completed_by_owner') FOR UPDATE OF i",
    [discoveryId],
  );
  const discovery = rows[0] as DiscoveryRun | undefined;
  if (!discovery || discovery.setup_pending) return;
  const existing = (
    await db.executeSql(
      "SELECT id FROM code_assist.planning_run WHERE discovery_id=$1",
      [discoveryId],
    )
  ).rows[0];
  if (existing) return existing.id as string;
  if (!discovery.snapshots?.length || !discovery.answers)
    throw new PlanningConflict(
      "Discovery must have saved repository commits and confirmed answers before planning.",
    );
  const id = randomUUID(),
    hash = digest({
      ticket: discovery.ticket,
      answers: discovery.answers,
      notes: discovery.notes,
      snapshots: discovery.snapshots,
      repository_setups: discovery.repository_setups,
    });
  await db.executeSql(
    "INSERT INTO code_assist.planning_run(id,issue_id,discovery_id,input_hash,status) VALUES($1,$2,$3,$4,'drafting')",
    [id, discovery.issue_id, discovery.id, hash],
  );
  const run = (await readRun(db, id))!;
  await enqueue(boss, db, run, "draft", 1);
  return id;
}
export async function syncReadyPlanning(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT id FROM code_assist.discovery_run WHERE status='ready'",
    );
  for (const row of rows)
    await transaction(boss, (db) => syncPlanning(boss, db, row.id));
}
export async function supersedePlanning(
  boss: PgBoss,
  db: Db,
  discoveryId: string,
) {
  const { rows } = await db.executeSql(
    "UPDATE code_assist.planning_run SET status='superseded' WHERE discovery_id=$1 AND status<>'superseded' RETURNING id,issue_id",
    [discoveryId],
  );
  for (const run of rows)
    await recordIntakeEvent(boss, db, run.issue_id, "planning_superseded", {
      planningId: run.id,
    });
}
async function lockCurrent(db: Db, id: string): Promise<PlanningRun> {
  let run = await readRun(db, id);
  if (!run) throw new PlanningConflict("Planning run not found.");
  const { rows } = await db.executeSql(
    "SELECT i.current_discovery_id,i.eligible,i.removed_at,d.status AS discovery_status FROM code_assist.intake_issue i JOIN code_assist.discovery_run d ON d.id=i.current_discovery_id WHERE i.id=$1 FOR UPDATE OF i",
    [run.issue_id],
  );
  run = (await readRun(db, id))!;
  const issue = rows[0];
  if (
    !issue ||
    issue.current_discovery_id !== run.discovery_id ||
    !issue.eligible ||
    issue.removed_at ||
    issue.discovery_status !== "ready" ||
    run.status === "superseded"
  )
    throw new PlanningConflict(
      "The ticket or confirmed scope changed. Refresh before continuing planning.",
    );
  return run;
}
export async function isCurrentPlanningStep(db: Db, step: PlanningStep) {
  const { rows } = await db.executeSql(
    `SELECT 1 FROM code_assist.planning_run p JOIN code_assist.intake_issue i ON i.id=p.issue_id JOIN code_assist.discovery_run d ON d.id=p.discovery_id JOIN code_assist.planning_step s ON s.id=p.current_step_id
    WHERE p.id=$1 AND s.id=$2 AND s.job_id=$3 AND s.status IN ('queued','running') AND p.status IN ('drafting','reviewing','revising') AND i.current_discovery_id=d.id AND d.status='ready' AND i.eligible AND i.removed_at IS NULL`,
    [step.run_id, step.id, step.job_id],
  );
  return rows.length > 0;
}
export async function startPlanningStep(
  boss: PgBoss,
  id: string,
  jobId: string,
) {
  return transaction(boss, async (db) => {
    let step = await readPlanningStep(db, id);
    if (!step || step.job_id !== jobId) return null;
    try {
      await lockCurrent(db, step.run_id);
    } catch (error) {
      if (error instanceof PlanningConflict) return null;
      throw error;
    }
    step = await readPlanningStep(db, id);
    if (
      !step ||
      step.status !== "queued" ||
      !(await isCurrentPlanningStep(db, step))
    )
      return null;
    const job = await boss.getJobById(planningQueue, jobId, { db });
    if (job?.state !== "active") return null;
    await db.executeSql(
      "UPDATE code_assist.planning_step SET status='running',worker_pid=$2 WHERE id=$1",
      [id, process.pid],
    );
    await recordIntakeEvent(
      boss,
      db,
      step.input.discovery.issue_id,
      "planning_started",
      {
        planningId: step.run_id,
        stepId: id,
        kind: step.kind,
        version: step.version,
      },
    );
    return { ...step, status: "running" as const, worker_pid: process.pid };
  });
}
export async function finishPlanningStep(
  boss: PgBoss,
  step: PlanningStep,
  value: unknown,
) {
  const result = step.kind === "draft" ? parsePlan(value) : parseReview(value);
  return transaction(boss, async (db) => {
    let run: PlanningRun;
    try {
      run = await lockCurrent(db, step.run_id);
    } catch (error) {
      if (error instanceof PlanningConflict) return false;
      throw error;
    }
    if (!(await isCurrentPlanningStep(db, step))) return false;
    const job = await boss.getJobById(planningQueue, step.job_id, { db });
    if (job?.state !== "active") return false;
    await boss.complete(
      planningQueue,
      { id: step.job_id, retryCount: job.retryCount },
      null,
      { db },
    );
    if (
      (await boss.getJobById(planningQueue, step.job_id, { db }))?.state !==
      "completed"
    )
      return false;
    await db.executeSql(
      "UPDATE code_assist.planning_step SET status='completed',finished_at=now() WHERE id=$1",
      [step.id],
    );
    if (step.kind === "draft") {
      const plan = parsePlan(result);
      const hash = digest({
        input: run.input_hash,
        version: step.version,
        plan,
      });
      await db.executeSql(
        "INSERT INTO code_assist.plan_version(run_id,number,step_id,hash,document) VALUES($1,$2,$3,$4,$5)",
        [run.id, step.version, step.id, hash, JSON.stringify(plan)],
      );
      await db.executeSql(
        "UPDATE code_assist.planning_run SET current_version=$2 WHERE id=$1",
        [run.id, step.version],
      );
      await recordIntakeEvent(boss, db, run.issue_id, "plan_drafted", {
        planningId: run.id,
        version: step.version,
      });
      await enqueue(boss, db, run, "review", step.version);
    } else {
      const review = parseReview(result);
      await db.executeSql(
        "INSERT INTO code_assist.plan_review(run_id,version,step_id,result) VALUES($1,$2,$3,$4)",
        [run.id, step.version, step.id, JSON.stringify(review)],
      );
      await recordIntakeEvent(boss, db, run.issue_id, "plan_reviewed", {
        planningId: run.id,
        version: step.version,
        disposition: review.disposition,
      });
      if (review.disposition === "needs_direction") {
        await db.executeSql(
          "UPDATE code_assist.planning_run SET status='needs_direction' WHERE id=$1",
          [run.id],
        );
        await recordIntakeEvent(
          boss,
          db,
          run.issue_id,
          "planning_direction",
          { planningId: run.id, version: step.version },
          true,
        );
      } else if (
        review.disposition === "revise" ||
        blockingFindings(review).length
      )
        await enqueue(boss, db, run, "draft", step.version + 1);
      else {
        await db.executeSql(
          "UPDATE code_assist.planning_run SET status='awaiting_approval' WHERE id=$1",
          [run.id],
        );
        await recordIntakeEvent(
          boss,
          db,
          run.issue_id,
          "plan_ready",
          { planningId: run.id, version: step.version },
          true,
        );
      }
    }
    return true;
  });
}
export async function failPlanningStep(
  boss: PgBoss,
  step: PlanningStep,
  message: string,
) {
  return transaction(boss, async (db) => {
    try {
      await lockCurrent(db, step.run_id);
    } catch (error) {
      if (error instanceof PlanningConflict) return false;
      throw error;
    }
    if (!(await isCurrentPlanningStep(db, step))) return false;
    await db.executeSql(
      "UPDATE code_assist.planning_step SET status='failed',error=$2,finished_at=now() WHERE id=$1",
      [step.id, message],
    );
    await db.executeSql(
      "UPDATE code_assist.planning_run SET status='failed',error=$2 WHERE id=$1",
      [step.run_id, message],
    );
    await recordIntakeEvent(
      boss,
      db,
      step.input.discovery.issue_id,
      "planning_failed",
      { planningId: step.run_id, stepId: step.id, version: step.version },
      true,
    );
    return true;
  });
}
export async function restartPlanningStep(boss: PgBoss, step: PlanningStep) {
  return transaction(boss, async (db) => {
    let run: PlanningRun;
    try {
      run = await lockCurrent(db, step.run_id);
    } catch (error) {
      if (error instanceof PlanningConflict) return;
      throw error;
    }
    if (!(await isCurrentPlanningStep(db, step))) return;
    await db.executeSql(
      "UPDATE code_assist.planning_step SET status='interrupted',finished_at=now() WHERE id=$1",
      [step.id],
    );
    await recordIntakeEvent(boss, db, run.issue_id, "planning_interrupted", {
      planningId: run.id,
      stepId: step.id,
      version: step.version,
    });
    await enqueue(boss, db, run, step.kind, step.version, step.input);
  });
}
export async function retryPlanning(
  boss: PgBoss,
  issueId: string,
  runId: string,
  stepId: string,
) {
  return transaction(boss, async (db) => {
    const run = await lockCurrent(db, runId);
    if (
      run.issue_id !== issueId ||
      run.status !== "failed" ||
      run.current_step_id !== stepId
    )
      throw new PlanningConflict(
        "This failed step has changed. Refresh before retrying.",
      );
    const step = (await readPlanningStep(db, stepId))!;
    return enqueue(boss, db, run, step.kind, step.version, step.input);
  });
}
async function currentVersion(
  db: Db,
  run: PlanningRun,
  issueId: string,
  version: number,
  hash: string,
) {
  const plan = (await versions(db, run.id)).find(
    (v) => v.number === run.current_version,
  );
  if (
    run.issue_id !== issueId ||
    run.current_version !== version ||
    !plan ||
    plan.hash !== hash ||
    !plan.review
  )
    throw new PlanningConflict(
      "This plan or its review changed. Refresh and review the current version.",
    );
  return plan;
}
export async function submitPlanFeedback(
  boss: PgBoss,
  issueId: string,
  runId: string,
  version: number,
  hash: string,
  note: string,
) {
  if (!note.trim())
    throw new PlanningConflict(
      "Describe what should change or provide the requested direction.",
    );
  return transaction(boss, async (db) => {
    const run = await lockCurrent(db, runId);
    await currentVersion(db, run, issueId, version, hash);
    if (
      !["awaiting_approval", "needs_direction", "approved"].includes(run.status)
    )
      throw new PlanningConflict(
        "The agents are already working on this plan. Refresh to see their progress.",
      );
    await db.executeSql(
      "INSERT INTO code_assist.plan_feedback(run_id,version,note) VALUES($1,$2,$3)",
      [run.id, version, note],
    );
    await recordIntakeEvent(boss, db, issueId, "plan_feedback", {
      planningId: run.id,
      version,
    });
    return enqueue(boss, db, run, "draft", version + 1);
  });
}
export async function approvePlan(
  boss: PgBoss,
  issueId: string,
  runId: string,
  version: number,
  hash: string,
  acceptedMediumIds: string[],
  approver: string,
) {
  if (!approver)
    throw new PlanningConflict("An authenticated approver is required.");
  return transaction(boss, async (db) => {
    const run = await lockCurrent(db, runId),
      plan = await currentVersion(db, run, issueId, version, hash);
    if (
      !["awaiting_approval", "approved"].includes(run.status) ||
      plan.review!.disposition !== "ready" ||
      blockingFindings(plan.review!).length
    )
      throw new PlanningConflict(
        "This plan is not ready for approval. Critical/high findings must be addressed first.",
      );
    const medium = plan
      .review!.findings.filter((f) => f.severity === "medium")
      .map((f) => f.id)
      .sort();
    if (
      JSON.stringify([...acceptedMediumIds].sort()) !== JSON.stringify(medium)
    )
      throw new PlanningConflict(
        "Explicitly accept each remaining medium concern before approving this version.",
      );
    if (run.status === "approved") return;
    await db.executeSql(
      "INSERT INTO code_assist.plan_approval(run_id,version,plan_hash,input_hash,approver,accepted_medium_ids) VALUES($1,$2,$3,$4,$5,$6)",
      [run.id, version, hash, run.input_hash, approver, JSON.stringify(medium)],
    );
    await db.executeSql(
      "UPDATE code_assist.planning_run SET status='approved' WHERE id=$1",
      [run.id],
    );
    await recordIntakeEvent(boss, db, issueId, "plan_approved", {
      planningId: run.id,
      version,
      hash,
      approver,
    });
    await syncCoding(boss, db, issueId);
  });
}
export async function reconcilePlanningFailures(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT s.* FROM code_assist.planning_step s JOIN code_assist.planning_run p ON p.current_step_id=s.id WHERE p.status IN ('drafting','reviewing','revising') AND s.status IN ('queued','running')",
    );
  for (const step of rows as PlanningStep[]) {
    const job = await boss.getJobById(planningQueue, step.job_id);
    let interrupted = false;
    if (step.worker_pid && step.status === "running")
      try {
        process.kill(step.worker_pid, 0);
      } catch (error) {
        interrupted = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    if (
      interrupted ||
      !job ||
      ["failed", "cancelled", "completed"].includes(job.state)
    ) {
      if (interrupted && job?.state === "active")
        await boss.fail(planningQueue, step.job_id);
      await failPlanningStep(
        boss,
        step,
        "Planning was interrupted or its job expired. Retry this step; completed versions and reviews are preserved.",
      );
    }
  }
}
export async function readPlanning(
  db: Db,
  issueId: string,
): Promise<PlanningDetail[]> {
  const { rows } = await db.executeSql(
    "SELECT * FROM code_assist.planning_run WHERE issue_id=$1 ORDER BY created_at",
    [issueId],
  );
  const result: PlanningDetail[] = [];
  for (const run of rows as PlanningRun[]) {
    const [v, f, s, a] = await Promise.all([
      versions(db, run.id),
      feedback(db, run.id),
      db.executeSql(
        "SELECT id,run_id,job_id,kind,version,status,worker_pid,session_id,error,created_at,finished_at FROM code_assist.planning_step WHERE run_id=$1 ORDER BY created_at",
        [run.id],
      ),
      db.executeSql(
        "SELECT version,plan_hash,input_hash,approver,accepted_medium_ids,created_at FROM code_assist.plan_approval WHERE run_id=$1 ORDER BY id",
        [run.id],
      ),
    ]);
    result.push({
      ...run,
      versions: v,
      feedback: f,
      steps: s.rows as Omit<PlanningStep, "input">[],
      approvals: a.rows as PlanApproval[],
    });
  }
  return result;
}
