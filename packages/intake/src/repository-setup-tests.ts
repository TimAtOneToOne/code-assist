import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import type { PgBoss } from "pg-boss";
import {
  compileRepositoryProfile,
  loadRepositoryProfile,
  type RepositorySetup,
} from "./repository-settings.ts";
import {
  destroyWorkspace,
  provisionWorkspace,
  readWorkspace,
} from "./workspace.ts";
import type { Workspace } from "./workspace.ts";

export const setupTestQueue = "repository-setup-test";
export type SetupTest = {
  job_id: string;
  repository: string;
  commit: string;
  configuration: RepositorySetup;
  profile_hash: string;
  status: "queued" | "running" | "passed" | "failed";
  stage: string;
  workspace_id: string | null;
  error: string | null;
  cleanup_error: string | null;
  cleaned_at: Date | null;
  checks: NonNullable<Workspace["checks"]>;
  created_at: Date;
  finished_at: Date | null;
};
export async function initializeSetupTests(boss: PgBoss) {
  await boss.getDb()
    .executeSql(`CREATE TABLE IF NOT EXISTS code_assist.repository_setup_test (
    job_id uuid PRIMARY KEY, repository text NOT NULL, commit text NOT NULL,
    configuration jsonb NOT NULL, profile_hash text NOT NULL, status text NOT NULL DEFAULT 'queued',
    stage text NOT NULL DEFAULT 'queued', workspace_id uuid, error text, cleanup_error text,
    cleaned_at timestamptz, checks jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
  )`);
  await boss.createQueue(setupTestQueue, { retryLimit: 0 });
}
export async function requestSetupTest(
  boss: PgBoss,
  directory: string,
  repository: string,
) {
  const profile = loadRepositoryProfile(directory, repository);
  const { stdout } = await promisify(execFile)("/usr/bin/git", [
    "-C",
    repository,
    "rev-parse",
    "HEAD",
  ]);
  const commit = stdout.trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit))
    throw new Error("Could not resolve the repository's source commit.");
  const tx = await boss.getDb().beginTransaction!();
  try {
    const id = await boss.send(
      setupTestQueue,
      {},
      { db: tx.db, expireInSeconds: 60 * 60 },
    );
    if (!id) throw new Error("Could not queue setup test.");
    await tx.db.executeSql(
      "INSERT INTO code_assist.repository_setup_test(job_id,repository,commit,configuration,profile_hash) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        repository,
        commit,
        JSON.stringify(profile.configuration),
        profile.hash,
      ],
    );
    await tx.commit();
    return id;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
export async function cleanupSetupTest(
  boss: PgBoss,
  directory: string,
  id: string,
) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT * FROM code_assist.repository_setup_test WHERE job_id=$1 AND status IN ('passed','failed')",
      [id],
    );
  const test = rows[0] as SetupTest | undefined;
  if (!test?.workspace_id) return;
  try {
    await destroyWorkspace(
      directory,
      test.workspace_id,
      new AbortController().signal,
    );
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.repository_setup_test SET cleanup_error=NULL,cleaned_at=now() WHERE job_id=$1",
        [id],
      );
  } catch {
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.repository_setup_test SET cleanup_error='Could not remove the test machine. Retry cleanup.' WHERE job_id=$1",
        [id],
      );
  }
}
export async function readSetupTests(
  boss: PgBoss,
  directory: string,
  repository: string,
): Promise<SetupTest[]> {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT * FROM code_assist.repository_setup_test WHERE repository=$1 ORDER BY created_at DESC",
      [repository],
    );
  for (const row of rows as SetupTest[]) {
    if (row.status === "running" && row.workspace_id) {
      const workspace = await readWorkspace(directory, row.workspace_id);
      row.stage = workspace.stage;
      row.checks = workspace.checks ?? [];
    }
  }
  return rows;
}
export async function runSetupTest(
  boss: PgBoss,
  directory: string,
  id: string,
  signal: AbortSignal,
) {
  const db = boss.getDb();
  const { rows } = await db.executeSql(
    "UPDATE code_assist.repository_setup_test SET status='running',stage='preparing workspace' WHERE job_id=$1 AND status='queued' RETURNING *",
    [id],
  );
  if (!rows.length) return;
  const test = rows[0] as SetupTest;
  let workspaceId: string | undefined;
  let failed = false;
  try {
    const snapshot = {
      name: basename(test.repository),
      source: test.repository,
      commit: test.commit,
      directory: test.repository,
    };
    await provisionWorkspace(directory, { snapshot }, [snapshot], signal, {
      onCreated: async (workspace) => {
        workspaceId = workspace.id;
        await db.executeSql(
          "UPDATE code_assist.repository_setup_test SET workspace_id=$2 WHERE job_id=$1",
          [id, workspace.id],
        );
      },
      profiles: {
        [snapshot.name]: compileRepositoryProfile(
          snapshot.name,
          test.configuration,
        ),
      },
      testSetup: true,
    });
  } catch {
    failed = true;
  } finally {
    const workspace = workspaceId
      ? await readWorkspace(directory, workspaceId)
      : null;
    const stage = workspace?.stage ?? "preparing workspace";
    await db.executeSql(
      "UPDATE code_assist.repository_setup_test SET status=$2,stage=$3,checks=$4,error=$5,finished_at=now() WHERE job_id=$1",
      [
        id,
        failed ? "failed" : "passed",
        stage,
        JSON.stringify(workspace?.checks ?? []),
        failed
          ? `Setup test ${signal.aborted ? "interrupted or timed out" : "failed"} during ${stage}. See workspace logs.`
          : null,
      ],
    );
    await cleanupSetupTest(boss, directory, id);
  }
  if (failed)
    throw new Error(
      "Repository setup test failed. See its recorded result and workspace logs.",
    );
}
export async function registerSetupTestWorker(
  boss: PgBoss,
  directory: string,
  stopping: AbortSignal,
) {
  // Only this worker owns setup tests; a process restart cannot resume guest commands.
  const { rows } = await boss
    .getDb()
    .executeSql(
      "UPDATE code_assist.repository_setup_test SET status='failed',error='Worker restarted during setup test. Run Test Setup again.',finished_at=now() WHERE status='running' RETURNING job_id",
    );
  for (const row of rows) {
    await boss.fail(setupTestQueue, row.job_id, {
      message: "Worker restarted",
    });
    await cleanupSetupTest(boss, directory, row.job_id);
  }
  const pendingCleanup = await boss
    .getDb()
    .executeSql(
      "SELECT job_id FROM code_assist.repository_setup_test WHERE status IN ('passed','failed') AND workspace_id IS NOT NULL AND cleaned_at IS NULL AND cleanup_error IS NULL",
    );
  for (const row of pendingCleanup.rows)
    await cleanupSetupTest(boss, directory, row.job_id);
  await boss.work(setupTestQueue, { includeMetadata: true }, async ([job]) => {
    await runSetupTest(
      boss,
      directory,
      job.id,
      AbortSignal.any([stopping, job.signal]),
    );
  });
}
