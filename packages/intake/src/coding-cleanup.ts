import { createReadStream } from "node:fs";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { codingRun, codingTransaction } from "./coding.ts";
import type { CodingRun, CodingStep } from "./coding-types.ts";
import {
  codingIndexes,
  repositories,
  repositoryDirectory,
  repositoryRun,
  snapshots,
  publicationReady,
} from "./coding-repositories.ts";
import { mainWorkflowStatus } from "./github-workflows.ts";
import {
  codingDirectory,
  executeCoding,
  guestCommands,
} from "./coding-runtime.ts";
import {
  readWorkspace,
  destroyWorkspace,
  workspaceExists,
} from "./workspace.ts";
import { recordIntakeEvent } from "./intake-events.ts";

export const cleanupQueue = "completed-workspace-cleanup";
const eligible = `c.status='done' AND c.workspace_id IS NOT NULL AND c.workspace_cleaned_at IS NULL
 AND (SELECT max(e.created_at) FROM code_assist.intake_event e
 WHERE e.issue_id=c.issue_id AND e.type='coding_done' AND e.details->>'codingId'=c.id::text) < now()-interval '24 hours'`;

type Log = ReturnType<typeof createLogger>;
export class CleanupBlocked extends Error {}
export type CleanupManifest = {
  version: 1;
  runId: string;
  workspaceId: string;
  archivedAt: string;
  archive: string;
  sha256: string;
  repositories: { name: string; commit: string }[];
};
export async function fileHash(path: string) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
export function assertCleanupEvidence(run: CodingRun, steps: CodingStep[]) {
  if (!publicationReady(run, steps))
    throw new CleanupBlocked(
      "The saved final review and validation do not match the code checkpoints.",
    );
  if (
    repositories(run).some(
      (r) =>
        r.status !== "done" ||
        !r.commit ||
        !r.merge_commit ||
        !r.main_workflows ||
        mainWorkflowStatus(r.main_workflows) !== "done" ||
        r.main_workflows.runs.some((w) => w.head_sha !== r.merge_commit),
    )
  )
    throw new CleanupBlocked(
      "Every repository must have successful main workflow evidence for its merge commit.",
    );
  for (const step of steps.filter(
    (s) => s.status === "completed" && ["implement", "review"].includes(s.kind),
  )) {
    const evidence =
      step.result?.evidence ??
      steps.find(
        (s) =>
          s.kind === "collect" &&
          s.status === "completed" &&
          s.continuation?.agentStepId === (step.recovery_step_id ?? step.id),
      )?.result?.evidence;
    if (typeof evidence !== "string")
      throw new CleanupBlocked(
        "An agent step is missing its saved evidence archive.",
      );
  }
}
export async function verifySavedCoding(
  directory: string,
  run: CodingRun,
  steps: CodingStep[],
  signal: AbortSignal,
  log: Log,
) {
  assertCleanupEvidence(run, steps);
  for (const snapshot of snapshots(run.input)) await access(snapshot.directory);
  for (const index of codingIndexes(run)) {
    const bare = join(
      repositoryDirectory(directory, repositoryRun(run, index)),
      "repository.git",
    );
    await executeCoding(
      "/usr/bin/git",
      [
        "--git-dir",
        bare,
        "cat-file",
        "-e",
        repositories(run)[index].commit + "^{commit}",
      ],
      signal,
      log,
    );
    await executeCoding(
      "/usr/bin/git",
      ["--git-dir", bare, "fsck", "--full", "--no-dangling"],
      signal,
      log,
    );
  }
  const root = codingDirectory(directory, run.id);
  for (const step of steps) {
    const path = step.result?.evidence;
    if (typeof path !== "string") continue;
    const rel = relative(root, resolve(path));
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new CleanupBlocked("Saved evidence is outside this coding run.");
    await executeCoding(
      "/usr/bin/tar",
      ["-tzf", path],
      signal,
      log,
      undefined,
      () => {},
    );
  }
}
export async function verifyCleanupManifest(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  log: Log,
) {
  const root = codingDirectory(directory, run.id);
  const manifest: CleanupManifest = JSON.parse(
    await readFile(join(root, "workspace-cleanup.json"), "utf8"),
  );
  const expected = repositories(run).map((r) => ({
    name: r.name,
    commit: r.commit,
  }));
  if (
    manifest.version !== 1 ||
    manifest.runId !== run.id ||
    manifest.workspaceId !== run.workspace_id ||
    manifest.archive !== join(root, "workspace-final-evidence.tar.gz") ||
    JSON.stringify(manifest.repositories) !== JSON.stringify(expected) ||
    (await fileHash(manifest.archive)) !== manifest.sha256
  )
    throw new CleanupBlocked(
      "The final workspace archive does not match its saved manifest.",
    );
  await executeCoding(
    "/usr/bin/tar",
    ["-tzf", manifest.archive],
    signal,
    log,
    undefined,
    () => {},
  );
  return manifest;
}
export async function archiveWorkspace(
  directory: string,
  run: CodingRun,
  steps: CodingStep[],
  signal: AbortSignal,
  log: Log,
) {
  await verifySavedCoding(directory, run, steps, signal, log);
  const workspace = await readWorkspace(directory, run.workspace_id!);
  if (
    workspace.input.issueId !== run.issue_id ||
    workspace.input.planningId !== run.planning_id ||
    workspace.input.version !== run.version
  )
    throw new CleanupBlocked(
      "Workspace ownership does not match this approved coding run.",
    );
  if (!(await workspaceExists(workspace.machine, signal))) {
    // Deletion may have succeeded just before the worker or database connection failed.
    return verifyCleanupManifest(directory, run, signal, log);
  }
  const { guest, root } = guestCommands(workspace, signal, log);
  const units = await root([
    "systemctl",
    "list-units",
    "--state=active,activating,deactivating",
    "--no-legend",
    "--no-pager",
    "ca-step-*.service",
  ]);
  if (units.trim())
    throw new CleanupBlocked(
      "An agent or validation process is still active in the workspace.",
    );
  async function checkCheckouts() {
    for (const repo of repositories(run)) {
      const { git } = guestCommands(workspace, signal, log, repo.name);
      if (await git("status", "--porcelain", "--untracked-files=all"))
        throw new CleanupBlocked(
          `${repo.name} has unsaved workspace changes. Nothing was deleted.`,
        );
      if ((await git("rev-parse", "HEAD")) !== repo.commit)
        throw new CleanupBlocked(
          `${repo.name} differs from its saved code checkpoint. Nothing was deleted.`,
        );
    }
  }
  await checkCheckouts();
  const archive = join(
    codingDirectory(directory, run.id),
    "workspace-final-evidence.tar.gz",
  );
  // Only evidence locations are archived; runtime credentials, databases, and dependencies are disposable.
  await guest(
    [
      "bash",
      "-c",
      'set -e; cd /work; paths=(evidence logs); for p in results receipts; do if test -d "$p"; then paths+=("$p"); fi; done; for repo in "$@"; do if test -d "$repo/.tmp"; then paths+=("$repo/.tmp"); fi; done; tar -czf - -- "${paths[@]}"',
      "cleanup",
      ...repositories(run).map((r) => r.name),
    ],
    undefined,
    undefined,
    archive + ".tmp",
  );
  await executeCoding(
    "/usr/bin/tar",
    ["-tzf", archive + ".tmp"],
    signal,
    log,
    undefined,
    () => {},
  );
  await rename(archive + ".tmp", archive);
  const manifest: CleanupManifest = {
    version: 1,
    runId: run.id,
    workspaceId: workspace.id,
    archivedAt: new Date().toISOString(),
    archive,
    sha256: await fileHash(archive),
    repositories: repositories(run).map((r) => ({
      name: r.name,
      commit: r.commit!,
    })),
  };
  await checkCheckouts();
  const path = join(
    codingDirectory(directory, run.id),
    "workspace-cleanup.json",
  );
  await writeFile(path + ".tmp", JSON.stringify(manifest) + "\n", {
    mode: 0o600,
    flush: true,
  });
  await rename(path + ".tmp", path);
  return verifyCleanupManifest(directory, run, signal, log);
}
export const cleanupRuntime = {
  archive: archiveWorkspace,
  destroy: destroyWorkspace,
};
export async function cleanupCodingRun(
  boss: PgBoss,
  directory: string,
  id: string,
  signal: AbortSignal,
  runtime = cleanupRuntime,
) {
  return codingTransaction(boss, async (db) => {
    const initial = await codingRun(db, id);
    // Use the same issue lock as coding, approval, and GitHub transitions through deletion.
    await db.executeSql(
      "SELECT id FROM code_assist.intake_issue WHERE id=$1 FOR UPDATE",
      [initial.issue_id],
    );
    const { rows } = await db.executeSql(
      `SELECT c.* FROM code_assist.coding_run c WHERE c.id=$1 AND ${eligible} FOR UPDATE`,
      [id],
    );
    if (!rows.length) return false;
    const run = rows[0] as CodingRun;
    const dependencies = await db.executeSql(
      `SELECT id FROM code_assist.coding_run WHERE (workspace_id=$1 AND id<>$2) OR (parent_run_id=$2 AND status NOT IN ('done','superseded'))
 UNION ALL SELECT run_id FROM code_assist.coding_step WHERE status IN ('queued','running') AND run_id IN (SELECT id FROM code_assist.coding_run WHERE workspace_id=$1 OR parent_run_id=$2)`,
      [run.workspace_id, id],
    );
    if (dependencies.rows.length)
      throw new CleanupBlocked(
        "Another coding run or unfinished step still depends on this workspace.",
      );
    const steps = (
      await db.executeSql(
        "SELECT * FROM code_assist.coding_step WHERE run_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows as CodingStep[];
    const log = createLogger("workspace-cleanup").child({
      ticket_id: run.identifier,
    });
    const manifest = await runtime.archive(directory, run, steps, signal, log);
    signal.throwIfAborted();
    await runtime.destroy(directory, run.workspace_id!, signal);
    await db.executeSql(
      "UPDATE code_assist.coding_run SET workspace_cleaned_at=now(),workspace_cleanup_error=NULL WHERE id=$1",
      [id],
    );
    await recordIntakeEvent(
      boss,
      db,
      run.issue_id,
      "coding_workspace_cleaned",
      {
        codingId: id,
        workspaceId: run.workspace_id,
        archive: manifest.archive,
        sha256: manifest.sha256,
      },
    );
    log.event(
      "info",
      "workspace.cleaned",
      "Completed workspace removed; code, evidence, and history retained.",
      { coding_id: id, workspace_id: run.workspace_id },
    );
    return true;
  });
}
export async function cleanupCompletedWorkspaces(
  boss: PgBoss,
  directory: string,
  signal: AbortSignal,
) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      `SELECT c.id FROM code_assist.coding_run c WHERE ${eligible} ORDER BY c.created_at`,
    );
  for (const row of rows) {
    signal.throwIfAborted();
    try {
      await cleanupCodingRun(boss, directory, row.id, signal);
    } catch (error) {
      signal.throwIfAborted();
      const message =
        error instanceof CleanupBlocked
          ? error.message
          : "Workspace cleanup could not verify or preserve all resources. Nothing further was removed; see cleanup logs.";
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.coding_run SET workspace_cleanup_error=$2 WHERE id=$1 AND workspace_cleaned_at IS NULL",
          [row.id, message],
        );
      createLogger("workspace-cleanup").event(
        "error",
        "workspace.cleanup_failed",
        message,
        { coding_id: row.id, error },
      );
    }
  }
}
export async function registerCleanupWorker(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
) {
  await boss.createQueue(cleanupQueue, { retryLimit: 0 });
  await boss.schedule(cleanupQueue, "*/5 * * * *", {});
  await boss.work(cleanupQueue, async ([job]) => {
    await cleanupCompletedWorkspaces(
      boss,
      directory,
      AbortSignal.any([shutdown, job.signal]),
    );
  });
}
