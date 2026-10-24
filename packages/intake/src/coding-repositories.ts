import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type {
  CodingRun,
  CodingStep,
  CodingRepository,
} from "./coding-types.ts";
import type { WorkspaceInput } from "./workspace.ts";

export function snapshots(input: WorkspaceInput) {
  return input.snapshots ?? [input.snapshot];
}
export function repositories(run: CodingRun): CodingRepository[] {
  return (
    run.repositories ?? [
      {
        name: run.input.snapshot.name,
        commit: run.commit,
        pr_url: run.pr_url,
        status: run.status,
        github_checked_at: run.github_checked_at,
        github_error: run.github_error,
        merged_at: run.merged_at,
        merge_commit: run.merge_commit,
        pr_closed_at: run.pr_closed_at,
        main_workflows: run.main_workflows,
        pr_checks: run.pr_checks,
      },
    ]
  );
}
export function repositoryIndex(run: CodingRun) {
  return run.repository_index ?? 0;
}
export function activeSnapshot(run: CodingRun) {
  return snapshots(run.input)[repositoryIndex(run)];
}
export function repositoryDirectory(directory: string, run: CodingRun) {
  const path = join(directory, "coding", run.id);
  return run.repositories ? join(path, activeSnapshot(run).name) : path;
}
export function codingIndexes(run: CodingRun) {
  const request = run.change_requests?.at(-1);
  if (request)
    return snapshots(run.input).flatMap((s, index) =>
      Object.hasOwn(request.baseCommits, s.name) ? [index] : [],
    );
  return run.repair?.repository
    ? [snapshots(run.input).findIndex((s) => s.name === run.repair!.repository)]
    : snapshots(run.input).map((_, index) => index);
}
export function commitSet(run: CodingRun) {
  return Object.fromEntries(repositories(run).map((r) => [r.name, r.commit]));
}
export function repositoryRun(run: CodingRun, index: number): CodingRun {
  const state = repositories(run)[index];
  return { ...run, repository_index: index, commit: state.commit };
}
export function publicationReady(run: CodingRun, steps: CodingStep[]) {
  steps = steps.filter(
    (step) =>
      (step.change_request_id ?? null) ===
        (run.change_requests?.at(-1)?.id ?? null) &&
      (step.direction_response_id ?? null) ===
        (run.direction_responses?.at(-1)?.id ?? null),
  );
  const review = steps.findLast(
    (s) => s.kind === "review" && s.status === "completed",
  );
  if (!review) return false;
  if (run.repositories) {
    if (!isDeepStrictEqual(review.input_commits, commitSet(run))) return false;
    return codingIndexes(run).every((index) => {
      const validation = steps.findLast(
        (s) =>
          s.kind === "validate" &&
          s.status === "completed" &&
          s.repository_index === index,
      );
      return (
        validation?.input_commit === repositories(run)[index].commit &&
        validation?.result?.passed === true
      );
    });
  }
  const validation = steps.findLast(
    (s) => s.kind === "validate" && s.status === "completed",
  );
  return (
    review.input_commit === run.commit &&
    validation?.input_commit === run.commit &&
    validation?.result?.passed === true
  );
}
export function aggregateStatus(
  states: CodingRepository[],
): CodingRun["status"] {
  if (states.every((r) => r.status === "done")) return "done";
  for (const status of [
    "main_failed",
    "pr_closed",
    "main_running",
    "awaiting_main",
  ] as const)
    if (states.some((r) => r.status === status)) return status;
  return "pr_open";
}
