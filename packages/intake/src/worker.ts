import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { revealSecret } from "@code-assist/secrets";
import { fetchTickets, LinearScanError } from "./linear.ts";
import { discoverRepositories } from "./repositories.ts";
import { readSettings } from "./settings.ts";
import { currentAttention, reconcileDiscoveryFailures } from "./discovery.ts";
import {
  intakeQueue,
  notificationQueue,
  recordScan,
  requeuePendingNotifications,
  trackedIds,
} from "./store.ts";

const logger = createLogger("intake");
export const applicationOrigin = "http://100.91.0.83:3000";
export const html = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function attentionMessage(
  id: string,
  identifier: string,
  title: string,
  date = new Date(),
  eventType = "repository_needed",
) {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "long",
  }).format(date);
  const heading =
    eventType === "discovery_failed"
      ? "⚠️ Blocked · Initial discovery failed"
      : eventType === "discovery_questions"
        ? "🔎 Ready for review · Confirm scope and answer questions"
        : "🔎 Ready for review · Choose repositories";
  const outcome =
    eventType === "discovery_failed"
      ? "Codex could not finish the initial investigation. The ticket page has the failure and a Retry action."
      : eventType === "discovery_questions"
        ? "Codex inspected the ticket and selected repositories. Initial findings and any open questions are saved. Full planning has not started."
        : "This Plan ticket is waiting for your repository selection. Review the prefilled selection and add or remove repositories from Mia's clones. Planning has not started.";
  const action =
    eventType === "discovery_failed"
      ? "Review the failure, correct any missing configuration, and retry."
      : eventType === "discovery_questions"
        ? "Review the findings, answer any questions, and confirm scope."
        : "Confirm the applicable repositories on the ticket page.";
  return `<p><b>Code Assist · ${html(identifier)}</b><br><b>${heading}</b><br><br><b>Time:</b> ${html(timestamp)}<br><br>${html(title)}<br><br>${outcome}<br><br><b>Action needed:</b> ${action}<br><br><a href="${applicationOrigin}/tickets/${encodeURIComponent(id)}">Review ${html(identifier)}</a></p>`;
}

export async function reconcileSchedule(boss: PgBoss, directory: string) {
  const settings = readSettings(directory);
  if (settings?.pollMinutes)
    await boss.schedule(intakeQueue, `*/${settings.pollMinutes} * * * *`, {});
  else await boss.unschedule(intakeQueue);
}

export async function deliverNotification(
  boss: PgBoss,
  directory: string,
  notificationId: string,
  jobId: string,
) {
  const { rows } = await boss.getDb().executeSql(
    `UPDATE code_assist.attention_outbox n SET attempts=attempts+1,error=NULL
     WHERE n.id=$1 AND n.job_id=$2 AND n.sent_at IS NULL
     AND EXISTS (SELECT 1 FROM code_assist.intake_issue i JOIN code_assist.intake_event e ON e.id=n.event_id
                 WHERE i.id=n.issue_id AND i.removed_at IS NULL AND ${currentAttention})
     RETURNING issue_id`,
    [notificationId, jobId],
  );
  if (!rows.length) return;
  let failure =
    "Attention notification failed. Check the Teams secrets and flow; retry from Home.";
  try {
    const settings = readSettings(directory);
    if (!settings) throw new Error("Configure attention notifications.");
    const { rows: issues } = await boss
      .getDb()
      .executeSql(
        "SELECT i.ticket,e.type FROM code_assist.intake_issue i JOIN code_assist.attention_outbox n ON n.issue_id=i.id JOIN code_assist.intake_event e ON e.id=n.event_id WHERE n.id=$1",
        [notificationId],
      );
    const ticket = issues[0].ticket;
    const response = await fetch(
      revealSecret(directory, settings.teamsWebhookSecretId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: attentionMessage(
            ticket.id,
            ticket.identifier,
            ticket.title,
            new Date(),
            issues[0].type,
          ),
          "conversation-id": revealSecret(
            directory,
            settings.teamsConversationSecretId,
          ),
        }),
      },
    );
    if (!response.ok) {
      failure = `Attention flow rejected the request (HTTP ${response.status}). Check the flow and retry from Home.`;
      throw new Error(failure);
    }
    await response.body?.cancel();
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.attention_outbox SET sent_at=now(),error=NULL WHERE id=$1 AND job_id=$2",
        [notificationId, jobId],
      );
    logger
      .child({ job_id: jobId })
      .event(
        "info",
        "notification.accepted",
        "Attention flow accepted notification",
        {
          notification_id: notificationId,
          issue_id: ticket.id,
          http_status: response.status,
        },
      );
  } catch {
    // Fetch errors can include the signed URL; persist a safe message instead.
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.attention_outbox SET error=$2 WHERE id=$1 AND job_id=$3",
        [notificationId, failure, jobId],
      );
    throw new Error(failure);
  }
}

export async function registerIntakeWorker(boss: PgBoss, directory: string) {
  await reconcileSchedule(boss, directory);
  await requeuePendingNotifications(boss);
  await boss.work(intakeQueue, async ([job]) => {
    const log = logger.child({ job_id: job.id, attempt_id: job.id });
    await boss.getDb().executeSql(
      `INSERT INTO code_assist.intake_scan(job_id,status,started_at) VALUES($1,'running',now())
       ON CONFLICT(job_id) DO UPDATE SET status='running',started_at=now(),error=NULL`,
      [job.id],
    );
    log.event("info", "intake.started", "Linear check started");
    let stage = "configuration";
    try {
      const settings = readSettings(directory);
      if (!settings)
        throw new Error(
          "Configure the Linear connection before checking tickets.",
        );
      stage = "repository discovery";
      const repositories = await discoverRepositories(directory);
      stage = "Linear API";
      const tickets = await fetchTickets(
        revealSecret(directory, settings.linearSecretId),
        await trackedIds(boss.getDb()),
        settings.linearTokenType,
      );
      stage = "saving ticket state";
      await recordScan(boss, job.id, tickets, repositories);
      log.event("info", "intake.completed", "Linear check completed", {
        issue_count: tickets.length,
      });
    } catch (error) {
      const message =
        error instanceof LinearScanError
          ? error.message
          : `Linear check failed during ${stage}. Check configuration and try again.`;
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.intake_scan SET status='failed',finished_at=now(),error=$2 WHERE job_id=$1",
          [job.id, message],
        );
      log.event("error", "intake.failed", message, { stage });
      // eslint-disable-next-line preserve-caught-error -- Persist only the credential-safe boundary error.
      throw new Error(message);
    } finally {
      await reconcileDiscoveryFailures(boss);
      await requeuePendingNotifications(boss);
    }
  });
  await boss.work<{ notificationId: string }>(
    notificationQueue,
    async ([job]) => {
      await deliverNotification(
        boss,
        directory,
        job.data.notificationId,
        job.id,
      );
    },
  );
}
