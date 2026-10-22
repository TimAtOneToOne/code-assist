import {
  snapshots,
  repositories,
  repositoryIndex,
  commitSet,
  repositoryDirectory,
  codingIndexes,
} from "./coding-repositories.ts";
import { mainFailureKey } from "./github-workflows.ts";
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
  CodingContinuation,
} from "./coding-types.ts";
import { missingBrowserEvidence } from "./coding-types.ts";
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
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS workspace_cleaned_at timestamptz;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS workspace_cleanup_error text;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS repositories jsonb;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS repository_index integer NOT NULL DEFAULT 0;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS repository_index integer NOT NULL DEFAULT 0;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS input_commits jsonb;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS continuation jsonb;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS job_retry_count integer NOT NULL DEFAULT 0;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS recovery_step_id uuid;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS change_requests jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS direction_responses jsonb NOT NULL DEFAULT '[]';
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS direction_response_id uuid;
 ALTER TABLE code_assist.coding_step ADD COLUMN IF NOT EXISTS change_request_id uuid;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS github_checked_at timestamptz;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS github_error text;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS merged_at timestamptz;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS merge_commit text;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS pr_closed_at timestamptz;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS main_workflows jsonb;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES code_assist.coding_run(id);
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS repair_key text;
 ALTER TABLE code_assist.coding_run ADD COLUMN IF NOT EXISTS repair jsonb;
 ALTER TABLE code_assist.coding_run DROP CONSTRAINT IF EXISTS coding_run_planning_id_version_key;
 CREATE UNIQUE INDEX IF NOT EXISTS coding_original_plan ON code_assist.coding_run(planning_id,version) WHERE parent_run_id IS NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS coding_repair_failure ON code_assist.coding_run(parent_run_id,repair_key);
 -- Legacy merge-only completion predates per-repository workflow evidence.
 UPDATE code_assist.coding_run SET status='awaiting_main' WHERE status='done' AND repositories IS NULL AND main_workflows IS NULL;
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
  if (run.parent_run_id && !run.pr_url) {
    const parent = await codingRun(db, run.parent_run_id);
    const state = run.repair?.repository
      ? repositories(parent).find((r) => r.name === run.repair!.repository)!
      : parent;
    if (
      state.status !== "main_failed" ||
      !state.main_workflows ||
      mainFailureKey(state.main_workflows) !== run.repair_key
    )
      return false;
  }
  if (step) {
    const { rows } = await db.executeSql(
      "SELECT 1 FROM code_assist.coding_step WHERE id=$1 AND job_id=$2 AND job_retry_count=$3 AND status IN ('queued','running')",
      [step.id, step.job_id, step.job_retry_count ?? 0],
    );
    return current.current_step_id === step.id && rows.length > 0;
  }
  return true;
}
async function enqueue(
  boss: PgBoss,
  db: Db,
  run: CodingRun,
  kind: CodingKind,
  continuation?: CodingContinuation | null,
  recoveryStepId?: string | null,
) {
  const id = randomUUID(),
    job = await boss.send(
      codingQueue,
      { stepId: id },
      {
        db,
        expireInSeconds: 60 * 60,
        ...(kind === "checkpoint" || kind === "collect"
          ? { retryLimit: 2, retryDelay: 10 }
          : {}),
      },
    );
  if (!job) throw new Error("Could not queue coding.");
  await db.executeSql(
    "INSERT INTO code_assist.coding_step(id,run_id,job_id,kind,input_commit,status,repository_index,input_commits,continuation,recovery_step_id,change_request_id,direction_response_id) VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10,$11)",
    [
      id,
      run.id,
      job,
      kind,
      run.commit,
      repositoryIndex(run),
      run.repositories ? JSON.stringify(commitSet(run)) : null,
      continuation ? JSON.stringify(continuation) : null,
      recoveryStepId ?? null,
      run.change_requests?.at(-1)?.id ?? null,
      run.direction_responses?.at(-1)?.id ?? null,
    ],
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
    "SELECT id FROM code_assist.coding_run WHERE planning_id=$1 AND version=$2 AND parent_run_id IS NULL",
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
  if (input.snapshots)
    await db.executeSql(
      "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
      [
        id,
        JSON.stringify(
          snapshots(input).map((s) => ({
            name: s.name,
            commit: null,
            pr_url: null,
            status: "prepare",
          })),
        ),
      ],
    );
  await enqueue(boss, db, await codingRun(db, id), "prepare");
}
export async function queueMainRepair(boss: PgBoss, db: Db, run: CodingRun) {
  if (run.repositories) return queueRepositoryRepair(boss, db, run);
  if (
    !run.main_workflows?.failureArtifact ||
    !run.merge_commit ||
    run.status !== "main_failed"
  )
    return;
  if (!(await currentCoding(db, run))) return;
  const key = mainFailureKey(run.main_workflows);
  if (!key) return;
  const existing = await db.executeSql(
    "SELECT id FROM code_assist.coding_run WHERE parent_run_id=$1 AND repair_key=$2",
    [run.id, key],
  );
  if (existing.rows.length) return;
  const id = randomUUID();
  await db.executeSql(
    "INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status,parent_run_id,repair_key,repair) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'prepare',$10,$11,$12)",
    [
      id,
      run.issue_id,
      run.planning_id,
      run.version,
      JSON.stringify(run.input),
      JSON.stringify(run.plan),
      run.identifier,
      run.title,
      `feature/${run.identifier.toLowerCase()}-main-fix-${id}`,
      run.id,
      key,
      JSON.stringify({
        baseCommit: run.merge_commit,
        workflows: run.main_workflows,
      }),
    ],
  );
  await enqueue(boss, db, await codingRun(db, id), "prepare");
}
export async function syncApprovedCoding(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      `SELECT p.issue_id FROM code_assist.planning_run p JOIN code_assist.intake_issue i ON i.current_discovery_id=p.discovery_id JOIN code_assist.discovery_run d ON d.id=p.discovery_id WHERE p.status='approved' AND i.eligible AND i.removed_at IS NULL`,
    );
  for (const row of rows)
    await codingTransaction(boss, (db) => syncCoding(boss, db, row.issue_id));
}
export async function startCoding(
  boss: PgBoss,
  id: string,
  jobId: string,
  retryCount = 0,
) {
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
    const claimed = await boss.getJobById(codingQueue, jobId, { db });
    if (claimed?.retryCount !== retryCount) return null;
    await db.executeSql(
      "UPDATE code_assist.coding_step SET status='running',worker_pid=$2,job_retry_count=$3,error=NULL WHERE id=$1",
      [id, process.pid, retryCount],
    );
    await recordIntakeEvent(boss, db, run.issue_id, "coding_started", {
      codingId: run.id,
      stepId: id,
      kind: step.kind,
    });
    return {
      run,
      step: {
        ...step,
        status: "running" as const,
        worker_pid: process.pid,
        job_retry_count: retryCount,
      },
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
  progress?: {
    repositories: NonNullable<CodingRun["repositories"]>;
    index: number;
  },
  continuation?: CodingContinuation,
) {
  return codingTransaction(boss, async (db) => {
    if (!(await currentCoding(db, run, step, true))) return false;
    const job = await boss.getJobById(codingQueue, step.job_id, { db });
    if (
      job?.state !== "active" ||
      job.retryCount !== (step.job_retry_count ?? 0)
    )
      return false;
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
    if (progress) {
      await db.executeSql(
        "UPDATE code_assist.coding_run SET repositories=$2,repository_index=$3,commit=$4 WHERE id=$1",
        [
          run.id,
          JSON.stringify(progress.repositories),
          progress.index,
          progress.repositories[progress.index].commit,
        ],
      );
    }
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
    else
      await enqueue(boss, db, await codingRun(db, run.id), next, continuation);
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
      if (await currentCoding(db, run)) return;
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
    const previous = rows[0] as CodingStep;
    if (missingBrowserEvidence(run, previous))
      return enqueue(boss, db, run, "implement");
    return enqueue(
      boss,
      db,
      run,
      previous.kind,
      previous.continuation,
      previous.recovery_step_id ?? previous.id,
    );
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

export async function requestCodingChanges(
  boss: PgBoss,
  issueId: string,
  runId: string,
  stepId: string,
  text: string,
  requestedBy: string,
  kind?: "bring_in_main",
) {
  if (!text.trim())
    throw new CodingConflict("Describe the code changes you want.");
  return codingTransaction(boss, async (db) => {
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [issueId],
    );
    const run = await codingRun(db, runId);
    const states = repositories(run);
    const indexes = codingIndexes(run);
    const resuming =
      kind === "bring_in_main" &&
      run.status === "needs_direction" &&
      !!run.change_requests?.length;
    if (
      run.issue_id !== issueId ||
      !(await currentCoding(db, run)) ||
      (run.status !== "pr_open" && !resuming) ||
      run.current_step_id !== stepId ||
      !run.workspace_id ||
      run.workspace_cleaned_at ||
      indexes.some(
        (index) =>
          !states[index].pr_url ||
          !states[index].commit ||
          states[index].merged_at ||
          states[index].pr_closed_at ||
          (!resuming && states[index].status !== "pr_open"),
      )
    )
      throw new CodingConflict(
        "Code changes require the current open, unmerged PR and its saved workspace. Refresh the ticket before trying again.",
      );
    const request = {
      ...(kind ? { kind } : {}),
      id: randomUUID(),
      text: text.trim(),
      requestedBy,
      createdAt: new Date().toISOString(),
      baseCommits: Object.fromEntries(
        indexes.map((i) => [
          states[i].name,
          resuming
            ? run.change_requests!.at(-1)!.baseCommits[states[i].name]
            : states[i].commit!,
        ]),
      ),
      pullRequests: Object.fromEntries(
        indexes.map((i) => [states[i].name, states[i].pr_url!]),
      ),
    };
    await db.executeSql(
      "UPDATE code_assist.coding_run SET change_requests=change_requests || $2::jsonb,repository_index=$3,commit=$4 WHERE id=$1",
      [
        run.id,
        JSON.stringify([request]),
        indexes[0],
        states[indexes[0]].commit,
      ],
    );
    await recordIntakeEvent(boss, db, issueId, "coding_changes_requested", {
      codingId: run.id,
      request,
    });
    return enqueue(boss, db, await codingRun(db, run.id), "implement");
  });
}

export async function answerCodingDirection(
  boss: PgBoss,
  issueId: string,
  runId: string,
  stepId: string,
  text: string,
  requestedBy: string,
) {
  if (!text.trim())
    throw new CodingConflict("Enter your reply before continuing.");
  return codingTransaction(boss, async (db) => {
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [issueId],
    );
    const run = await codingRun(db, runId);
    const states = repositories(run);
    const indexes = codingIndexes(run);
    if (
      run.issue_id !== issueId ||
      !(await currentCoding(db, run)) ||
      run.status !== "needs_direction" ||
      run.current_step_id !== stepId ||
      !run.workspace_id ||
      run.workspace_cleaned_at ||
      indexes.some(
        (index) => states[index].merged_at || states[index].pr_closed_at,
      )
    )
      throw new CodingConflict(
        "This coding question is no longer current or its workspace is unavailable. Refresh the ticket before replying.",
      );
    const { rows } = await db.executeSql(
      "SELECT result FROM code_assist.coding_step WHERE id=$1 AND run_id=$2 AND status='completed'",
      [stepId, runId],
    );
    if (!rows.length)
      throw new CodingConflict(
        "Wait for the agent's result to be saved before replying.",
      );
    const response = {
      id: randomUUID(),
      stepId,
      question:
        typeof rows[0].result?.directionQuestion === "string"
          ? rows[0].result.directionQuestion
          : "",
      text: text.trim(),
      requestedBy,
      createdAt: new Date().toISOString(),
    };
    await db.executeSql(
      "UPDATE code_assist.coding_run SET direction_responses=direction_responses || $2::jsonb,repository_index=$3,commit=$4 WHERE id=$1",
      [
        runId,
        JSON.stringify([response]),
        indexes[0],
        states[indexes[0]].commit,
      ],
    );
    await recordIntakeEvent(boss, db, issueId, "coding_direction_answered", {
      codingId: runId,
      response,
    });
    return enqueue(boss, db, await codingRun(db, runId), "implement");
  });
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
    const run = await codingRun(boss.getDb(), runId);
    for (const index of repositories(run).keys()) {
      try {
        await access(
          join(
            repositoryDirectory(directory, { ...run, repository_index: index }),
            "publication.json",
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      throw new CodingConflict(
        "Reconcile the previous publication attempt before changing branches.",
      );
    }
    const missing = new Error("No publication intent") as NodeJS.ErrnoException;
    missing.code = "ENOENT";
    throw missing;
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
        "SELECT * FROM code_assist.coding_step WHERE id=$1",
        [stepId],
      );
      const previous = rows[0] as CodingStep;
      return enqueue(
        boss,
        db,
        { ...run, branch },
        previous.kind,
        previous.continuation,
        previous.recovery_step_id ?? previous.id,
      );
    });
  }
  throw new CodingConflict(
    "Reconcile the previous publication attempt before changing branches.",
  );
}

async function queueRepositoryRepair(boss: PgBoss, db: Db, run: CodingRun) {
  if (!(await currentCoding(db, run))) return;
  const latest = await db.executeSql(
    "SELECT id FROM code_assist.coding_run WHERE planning_id=$1 AND version=$2 AND status<>'superseded' ORDER BY created_at DESC LIMIT 1",
    [run.planning_id, run.version],
  );
  if (latest.rows[0]?.id !== run.id) return;
  const index = repositories(run).findIndex(
    (r) =>
      r.status === "main_failed" &&
      r.main_workflows?.failureArtifact &&
      r.merge_commit,
  );
  if (index < 0) return;
  const failed = repositories(run)[index];
  const key = mainFailureKey(failed.main_workflows!);
  if (!key) return;
  const existing = await db.executeSql(
    "SELECT id FROM code_assist.coding_run WHERE parent_run_id=$1 AND repair_key=$2",
    [run.id, key],
  );
  if (existing.rows.length) return;
  const id = randomUUID();
  const states = repositories(run).map((r, i) =>
    i === index
      ? {
          ...r,
          baseCommit: r.merge_commit!,
          commit: null,
          pr_url: null,
          status: "prepare",
          main_workflows: null,
          merged_at: null,
          merge_commit: null,
          github_checked_at: null,
          github_error: null,
          pr_closed_at: null,
        }
      : { ...r },
  );
  await db.executeSql(
    "INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status,parent_run_id,repair_key,repair,repositories,repository_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'prepare',$10,$11,$12,$13,$14)",
    [
      id,
      run.issue_id,
      run.planning_id,
      run.version,
      JSON.stringify(run.input),
      JSON.stringify(run.plan),
      run.identifier,
      run.title,
      `feature/${run.identifier.toLowerCase()}-main-fix-${id}`,
      run.id,
      key,
      JSON.stringify({
        repository: failed.name,
        baseCommit: failed.merge_commit,
        workflows: failed.main_workflows,
      }),
      JSON.stringify(states),
      index,
    ],
  );
  await enqueue(boss, db, await codingRun(db, id), "prepare");
}
