import pg from "pg";

export async function deploymentActivity(connectionString: string) {
  const client = new pg.Client({
    connectionString,
    application_name: "code-assist-deployment-status",
  });
  try {
    await client.connect();
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const jobs = await client.query<{
      id: string;
      name: string;
      state: string;
      start_after: Date;
    }>(
      "SELECT id,name,state,start_after FROM pgboss.job WHERE state IN ('created','retry','active') ORDER BY name,id",
    );
    const steps = await client.query<{
      phase: string;
      id: string;
      status: string;
      worker_pid: number | null;
    }>(`
      SELECT 'discovery' AS phase,id,status,worker_pid
      FROM code_assist.discovery_run WHERE status IN ('queued','running')
      UNION ALL
      SELECT 'planning',s.id,s.status,s.worker_pid
      FROM code_assist.planning_step s JOIN code_assist.planning_run r ON r.id=s.run_id
      WHERE s.status IN ('queued','running') AND r.current_step_id=s.id
        AND r.status IN ('drafting','reviewing','revising')
      UNION ALL
      SELECT 'coding',s.id,s.status,s.worker_pid
      FROM code_assist.coding_step s JOIN code_assist.coding_run r ON r.id=s.run_id
      WHERE s.status IN ('queued','running') AND r.current_step_id=s.id
        AND r.status IN ('prepare','implement','checkpoint','collect','validate','review','publish')
      UNION ALL
      SELECT 'setup',job_id,status,NULL::integer
      FROM code_assist.repository_setup_test WHERE status IN ('queued','running')
      ORDER BY phase,id
    `);
    await client.query("COMMIT");
    return { jobs: jobs.rows, steps: steps.rows };
  } finally {
    await client.end();
  }
}
