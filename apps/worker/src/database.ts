import { PgBoss } from "pg-boss";
import { logger } from "./logging.ts";

export function connectBoss(instanceName: string) {
  const connectionString = process.env.CODE_ASSIST_DATABASE_URL;
  if (!connectionString)
    throw new Error("CODE_ASSIST_DATABASE_URL is required");
  const boss = new PgBoss({ connectionString, instanceName });
  boss.on("error", (error) =>
    logger.event("error", "queue.error", "pg-boss error", { error }),
  );
  boss.on("warning", (warning) =>
    logger.event("warn", "queue.warning", "pg-boss warning", { warning }),
  );
  return boss;
}
