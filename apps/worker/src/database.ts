import { PgBoss } from "pg-boss";

export function connectBoss(instanceName: string) {
  const connectionString = process.env.CODE_ASSIST_DATABASE_URL;
  if (!connectionString)
    throw new Error("CODE_ASSIST_DATABASE_URL is required");
  const boss = new PgBoss({ connectionString, instanceName });
  boss.on("error", (error) => console.error("pg-boss error:", error.message));
  boss.on("warning", (warning) => console.warn("pg-boss warning:", warning));
  return boss;
}
