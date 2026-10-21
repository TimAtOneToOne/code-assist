import pg from "pg";
import type { Db } from "pg-boss";
import { createLogger } from "@code-assist/observability";

const channel = "code_assist_dashboard";

export async function initializeDashboardEvents(db: Db) {
  await db.executeSql(`
    CREATE OR REPLACE FUNCTION code_assist.notify_dashboard() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_notify('${channel}', '');
      RETURN NULL;
    END $$;
  `);
  // Watch the dashboard's source tables so every writer, including recovery, is covered.
  for (const table of [
    "intake_issue",
    "intake_event",
    "intake_scan",
    "attention_outbox",
    "discovery_run",
    "planning_run",
    "coding_run",
  ]) {
    await db.executeSql(`
      CREATE OR REPLACE TRIGGER dashboard_insert_delete
      AFTER INSERT OR DELETE ON code_assist.${table}
      FOR EACH ROW EXECUTE FUNCTION code_assist.notify_dashboard();
      CREATE OR REPLACE TRIGGER dashboard_update
      AFTER UPDATE ON code_assist.${table}
      FOR EACH ROW WHEN (OLD IS DISTINCT FROM NEW)
      EXECUTE FUNCTION code_assist.notify_dashboard();
    `);
  }
}

export function dashboardEvents(connectionString: string, signal: AbortSignal) {
  const client = new pg.Client({
    connectionString,
    application_name: "code-assist-dashboard-events",
  });
  const encoder = new TextEncoder();
  let closed = false;
  let end: Promise<void> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const disconnect = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", disconnect);
    controller.close();
    end = client.end().catch(() => {});
  };
  client.on("error", () => {
    createLogger("web").event(
      "error",
      "dashboard.connection_failed",
      "Dashboard live update connection failed",
    );
    disconnect();
  });
  client.on("end", disconnect);
  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      controller = streamController;
      signal.addEventListener("abort", disconnect, { once: true });
      if (signal.aborted) return disconnect();
      const changed = () => {
        if (!closed) controller.enqueue(encoder.encode("data: changed\n\n"));
      };
      client.on("notification", changed);
      try {
        await client.connect();
        if (closed) return;
        await client.query(`LISTEN ${channel}`);
        // Refresh after LISTEN is active, including changes missed during a disconnect.
        changed();
      } catch {
        if (!closed) {
          createLogger("web").event(
            "error",
            "dashboard.connection_failed",
            "Could not subscribe to dashboard changes",
          );
          disconnect();
        }
      }
    },
    cancel() {
      // The stream is already closed when its consumer cancels it.
      if (!closed) {
        closed = true;
        signal.removeEventListener("abort", disconnect);
        end = client.end().catch(() => {});
      }
      return end;
    },
  });
}
