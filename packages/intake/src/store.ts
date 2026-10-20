import { initializeCoding, readCoding, type CodingRun } from "./coding.ts";
import { initializeGitHub } from "./github.ts";
import {
  readPlanning,
  reconcilePlanningFailures,
  type PlanningRun,
} from "./planning.ts";
import { PgBoss, type Db } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { isReady, type Ticket } from "./linear.ts";
import {
  initializeDiscovery,
  syncDiscovery,
  reconcileDiscoveryFailures,
  currentAttention,
  type DiscoveryRun,
} from "./discovery.ts";
import {
  suggestRepositories,
  type Repository,
  type Suggestion,
} from "./repositories.ts";

export const intakeQueue = "linear-intake";
export const notificationQueue = "attention-notification";
export class SelectionConflict extends Error {}
export type WorkItem = {
  id: string;
  ticket: Ticket;
  suggestions: Suggestion[];
  selected_repositories: string[];
  selected_at: Date | null;
  eligible: boolean;
  removed_at: Date | null;
  current_discovery_id: string | null;
  discovery_status: DiscoveryRun["status"] | null;
  planning_status: PlanningRun["status"] | null;
  coding_status: CodingRun["status"] | null;
  created_at: Date;
  observed_at: Date;
};

// Read existing single-repository choices until the user saves a new selection.
const issueColumns =
  "*, COALESCE(selected_repositories, array_remove(ARRAY[selected_repository], NULL)) AS selected_repositories, (SELECT status FROM code_assist.discovery_run WHERE id=current_discovery_id) AS discovery_status, (SELECT status FROM code_assist.planning_run WHERE discovery_id=current_discovery_id) AS planning_status, (SELECT c.status FROM code_assist.coding_run c JOIN code_assist.planning_run p ON p.id=c.planning_id WHERE p.discovery_id=current_discovery_id AND p.current_version=c.version AND p.status='approved' AND c.status<>'superseded' ORDER BY c.created_at DESC,c.id DESC LIMIT 1) AS coding_status";

export async function withIntake<T>(
  connectionString: string,
  action: (boss: PgBoss) => Promise<T>,
): Promise<T> {
  const boss = new PgBoss({
    connectionString,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () =>
    createLogger("web").event(
      "error",
      "intake.database_error",
      "Intake database connection failed",
    ),
  );
  try {
    await boss.start();
    return await action(boss);
  } finally {
    await boss.stop();
  }
}

export async function initializeIntake(boss: PgBoss) {
  await boss.getDb().executeSql(`
    CREATE SCHEMA IF NOT EXISTS code_assist;
    CREATE TABLE IF NOT EXISTS code_assist.intake_issue (
      id uuid PRIMARY KEY, ticket jsonb NOT NULL, suggestions jsonb NOT NULL,
      eligible boolean NOT NULL, selected_repository text, selected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), observed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS code_assist.intake_event (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      issue_id uuid NOT NULL REFERENCES code_assist.intake_issue(id),
      type text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE code_assist.intake_issue ADD COLUMN IF NOT EXISTS selected_repositories text[];
    ALTER TABLE code_assist.intake_issue ADD COLUMN IF NOT EXISTS removed_at timestamptz;
    CREATE TABLE IF NOT EXISTS code_assist.intake_scan (
      job_id uuid PRIMARY KEY, status text NOT NULL,
      started_at timestamptz, finished_at timestamptz, issue_count integer, error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS code_assist.attention_outbox (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id bigint NOT NULL UNIQUE REFERENCES code_assist.intake_event(id),
      issue_id uuid NOT NULL REFERENCES code_assist.intake_issue(id),
      job_id uuid, attempts integer NOT NULL DEFAULT 0, sent_at timestamptz,
      error text, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await boss.createQueue(intakeQueue, { retryLimit: 0 });
  await boss.createQueue(notificationQueue, { retryLimit: 0 });
  await initializeDiscovery(boss);
  await initializeCoding(boss);
  await initializeGitHub(boss);
}

export async function requestScan(boss: PgBoss) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    const id = await boss.send(intakeQueue, {}, { db: tx.db });
    if (!id) throw new Error("Could not queue the Linear check.");
    await tx.db.executeSql(
      "INSERT INTO code_assist.intake_scan(job_id,status) VALUES($1,'queued')",
      [id],
    );
    await tx.commit();
    return id;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function trackedIds(db: Db): Promise<string[]> {
  const { rows } = await db.executeSql(
    "SELECT id FROM code_assist.intake_issue",
  );
  return rows.map((row: { id: string }) => row.id);
}

export async function recordScan(
  boss: PgBoss,
  jobId: string,
  tickets: Ticket[],
  repositories: Repository[],
) {
  const tx = await boss.getDb().beginTransaction!();
  try {
    for (const ticket of tickets) {
      const suggestions = suggestRepositories(ticket, repositories);
      const { rows } = await tx.db.executeSql(
        `INSERT INTO code_assist.intake_issue(id,ticket,suggestions,eligible)
         SELECT $1,$2,$3,$4 WHERE $4 ON CONFLICT(id) DO NOTHING RETURNING id`,
        [
          ticket.id,
          JSON.stringify(ticket),
          JSON.stringify(suggestions),
          isReady(ticket),
        ],
      );
      if (rows.length) {
        const { rows: events } = await tx.db.executeSql(
          "INSERT INTO code_assist.intake_event(issue_id,type) VALUES($1,'repository_needed') RETURNING id",
          [ticket.id],
        );
        const { rows: notifications } = await tx.db.executeSql(
          "INSERT INTO code_assist.attention_outbox(issue_id,event_id) VALUES($1,$2) RETURNING id",
          [ticket.id, events[0].id],
        );
        const notificationId = notifications[0].id;
        const notificationJob = await boss.send(
          notificationQueue,
          { notificationId },
          { db: tx.db },
        );
        if (!notificationJob)
          throw new Error("Could not queue the attention notification.");
        await tx.db.executeSql(
          "UPDATE code_assist.attention_outbox SET job_id=$2 WHERE id=$1",
          [notificationId, notificationJob],
        );
      } else {
        const { rows: current } = await tx.db.executeSql(
          `SELECT removed_at FROM code_assist.intake_issue
           WHERE id=$1 AND (ticket->>'updatedAt')::timestamptz <= $2::timestamptz FOR UPDATE`,
          [ticket.id, ticket.updatedAt],
        );
        if (!current.length) continue;
        const removed = !ticket.labels.includes("Plan");
        await tx.db.executeSql(
          `UPDATE code_assist.intake_issue SET ticket=$2,suggestions=$3,eligible=$4,observed_at=now(),
           removed_at=CASE WHEN $5 THEN COALESCE(removed_at,now()) ELSE NULL END
           WHERE id=$1`,
          [
            ticket.id,
            JSON.stringify(ticket),
            JSON.stringify(suggestions),
            isReady(ticket),
            removed,
          ],
        );
        if (removed !== (current[0].removed_at !== null))
          await tx.db.executeSql(
            "INSERT INTO code_assist.intake_event(issue_id,type) VALUES($1,$2)",
            [ticket.id, removed ? "issue_removed" : "issue_restored"],
          );
      }
      await syncDiscovery(boss, tx.db, ticket.id);
    }
    await tx.db.executeSql(
      "UPDATE code_assist.intake_scan SET status='completed',finished_at=now(),issue_count=$2,error=NULL WHERE job_id=$1",
      [jobId, tickets.length],
    );
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function dashboard(boss: PgBoss) {
  await reconcileDiscoveryFailures(boss);
  await reconcilePlanningFailures(boss);
  const db = boss.getDb();
  const { rows: issues } = await db.executeSql(
    `SELECT ${issueColumns} FROM code_assist.intake_issue WHERE removed_at IS NULL ORDER BY
     (cardinality(COALESCE(selected_repositories, array_remove(ARRAY[selected_repository], NULL))) = 0) DESC,
     created_at DESC,id`,
  );
  const { rows: scans } = await db.executeSql(
    "SELECT * FROM code_assist.intake_scan ORDER BY created_at DESC,job_id DESC LIMIT 1",
  );
  const { rows: notifications } = await db.executeSql(
    `SELECT n.id,n.issue_id,n.attempts,n.sent_at,n.error
     FROM code_assist.attention_outbox n JOIN code_assist.intake_issue i ON i.id=n.issue_id
     JOIN code_assist.intake_event e ON e.id=n.event_id
     WHERE n.sent_at IS NULL AND i.removed_at IS NULL AND ${currentAttention} ORDER BY n.id`,
  );
  const scan = scans[0] ?? null;
  if (scan && ["queued", "running"].includes(scan.status)) {
    const job = await boss.getJobById(intakeQueue, scan.job_id);
    if (!job || ["failed", "cancelled"].includes(job.state)) {
      scan.status = "failed";
      scan.error = "The queued check was interrupted or expired. Check again.";
    }
  }
  return { issues: issues as WorkItem[], scan, notifications };
}

export async function readWorkItem(db: Db, id: string) {
  const { rows } = await db.executeSql(
    `SELECT ${issueColumns} FROM code_assist.intake_issue WHERE id=$1`,
    [id],
  );
  if (!rows.length) return null;
  const { rows: events } = await db.executeSql(
    "SELECT type,details,created_at FROM code_assist.intake_event WHERE issue_id=$1 ORDER BY id",
    [id],
  );
  const { rows: discoveries } = await db.executeSql(
    "SELECT * FROM code_assist.discovery_run WHERE issue_id=$1 ORDER BY created_at,id",
    [id],
  );
  return {
    ...(rows[0] as WorkItem),
    events,
    discoveries: discoveries as DiscoveryRun[],
    planning: await readPlanning(db, id),
    coding: await readCoding(db, id),
  };
}

export async function selectRepositories(
  boss: PgBoss,
  id: string,
  repositories: string[],
  expectedUpdatedAt: string,
) {
  if (
    !repositories.length ||
    new Set(repositories).size !== repositories.length
  )
    throw new Error("Choose one or more distinct repositories.");
  const tx = await boss.getDb().beginTransaction!();
  try {
    const { rows } = await tx.db.executeSql(
      `SELECT ${issueColumns} FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const item = rows[0] as WorkItem | undefined;
    if (!item) throw new Error("Ticket not found.");
    if (item.removed_at)
      throw new SelectionConflict(
        "This ticket was removed because its Plan label is gone. Refresh to see its history.",
      );
    if (item.ticket.updatedAt !== expectedUpdatedAt)
      throw new SelectionConflict(
        "The ticket changed. Refresh and review it before choosing repositories.",
      );
    if (
      item.selected_repositories.length !== repositories.length ||
      repositories.some((path) => !item.selected_repositories.includes(path))
    ) {
      await tx.db.executeSql(
        "UPDATE code_assist.intake_issue SET selected_repositories=$2,selected_at=now() WHERE id=$1",
        [id, repositories],
      );
      await tx.db.executeSql(
        "INSERT INTO code_assist.intake_event(issue_id,type,details) VALUES($1,'repositories_selected',$2)",
        [
          id,
          JSON.stringify({ repositories, ticketUpdatedAt: expectedUpdatedAt }),
        ],
      );
    }
    await syncDiscovery(boss, tx.db, id);
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function requeuePendingNotifications(boss: PgBoss) {
  const { rows } = await boss.getDb().executeSql(
    `SELECT n.id,n.job_id FROM code_assist.attention_outbox n
       JOIN code_assist.intake_issue i ON i.id=n.issue_id
       JOIN code_assist.intake_event e ON e.id=n.event_id
       WHERE n.sent_at IS NULL AND i.removed_at IS NULL AND ${currentAttention}`,
  );
  for (const row of rows) {
    const job = row.job_id
      ? await boss.getJobById(notificationQueue, row.job_id)
      : null;
    if (job && !["failed", "cancelled", "completed"].includes(job.state))
      continue;
    const tx = await boss.getDb().beginTransaction!();
    try {
      const { rows: current } = await tx.db.executeSql(
        "SELECT job_id,sent_at FROM code_assist.attention_outbox WHERE id=$1 FOR UPDATE",
        [row.id],
      );
      if (current[0].sent_at === null && current[0].job_id === row.job_id) {
        const id = await boss.send(
          notificationQueue,
          { notificationId: row.id },
          { db: tx.db },
        );
        if (!id) throw new Error("Could not queue the attention notification.");
        await tx.db.executeSql(
          "UPDATE code_assist.attention_outbox SET job_id=$2 WHERE id=$1",
          [row.id, id],
        );
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}
