import type { Db, PgBoss } from "pg-boss";

export async function recordIntakeEvent(
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
