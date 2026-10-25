import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { CodingRun, CodingStep } from "../../src/coding-types.ts";
export async function cleanupFixture() {
  const base = join(
    import.meta.dirname,
    "../../../../.tmp/workspace-cleanup/tests",
  );
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "case-"));
  const source = join(directory, "source");
  await mkdir(source);
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", source, ...args], {
      encoding: "utf8",
    }).trim();
  git("init", "--quiet");
  await writeFile(join(source, "feature.txt"), "retained code\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const commit = git("rev-parse", "HEAD");
  const run = {
    id: randomUUID(),
    issue_id: randomUUID(),
    planning_id: randomUUID(),
    version: 1,
    current_step_id: randomUUID(),
    error: null,
    pr_url: null,
    github_checked_at: null,
    github_error: null,
    merged_at: null,
    pr_closed_at: null,
    parent_run_id: null,
    repair_key: null,
    repair: null,
    created_at: new Date(),
    workspace_id: randomUUID(),
    identifier: "ONE-999999",
    title: "Cleanup fixture",
    plan: { markdown: "# Fixture", changeSummary: "Fixture", responses: [] },
    branch: "feature/one-999999",
    status: "done",
    commit,
    merge_commit: commit,
    main_workflows: {
      runs: [
        {
          id: 1,
          run_attempt: 1,
          name: "CI",
          html_url: "https://github.com/example/fixture/actions/runs/1",
          event: "push",
          head_sha: commit,
          head_branch: "main",
          status: "completed",
          conclusion: "success",
        },
      ],
    },
    input: {
      issueId: randomUUID(),
      planningId: randomUUID(),
      version: 1,
      planHash: "fixture",
      inputHash: "fixture",
      snapshot: { name: "fixture", commit, source, directory: source },
    },
  } as CodingRun;
  const path = join(directory, "coding", run.id);
  await mkdir(path, { recursive: true });
  execFileSync("/usr/bin/git", [
    "clone",
    "--quiet",
    "--bare",
    source,
    join(path, "repository.git"),
  ]);
  const evidence = join(path, "agent-evidence.tar.gz");
  execFileSync("/usr/bin/tar", ["-czf", evidence, "-C", source, "feature.txt"]);
  const steps = (["implement", "validate", "review"] as const).map((kind) => ({
    id: randomUUID(),
    run_id: run.id,
    job_id: randomUUID(),
    kind,
    status: "completed",
    input_commit: commit,
    result: { evidence, passed: true },
    finished_at: new Date(),
    created_at: new Date(),
    worker_pid: null,
    error: null,
  })) as CodingStep[];
  return { directory, run, steps, path, evidence, source };
}
