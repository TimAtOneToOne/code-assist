import { currentAttention } from "../src/discovery.ts";
import assert from "node:assert/strict";
import type { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import {
  readCoding,
  finishCoding,
  requestCodingChanges,
  type startCoding,
} from "../src/coding.ts";
import {
  recordGitHubObservation,
  refreshGitHub,
  type PullRequestState,
} from "../src/github.ts";
import {
  codingIndexes,
  repositories,
  repositoryRun,
  publicationReady,
} from "../src/coding-repositories.ts";
import { publicationMarker } from "../src/publication-metadata.ts";
import type { PrChecks } from "../src/github-pr-checks.ts";

export async function exercisePrChecks(
  boss: PgBoss,
  issueId: string,
  next: () => ReturnType<typeof startCoding>,
) {
  const original = (await readCoding(boss.getDb(), issueId))[0];
  const index = repositories(original).length - 1;
  const state = repositories(original)[index];
  const observed = (run = original) => ({
    ...repositoryRun(run, index),
    pr_url: repositories(run)[index].pr_url,
  });
  const pr: PullRequestState = {
    url: state.pr_url!,
    state: "OPEN",
    baseRefName: "main",
    mergedAt: null,
    closedAt: null,
    mergeCommit: null,
    headRefOid: state.commit!,
    headRefName: original.branch,
    isCrossRepository: false,
    body: publicationMarker(original.id),
  };
  const failure: PrChecks = {
    commit: state.commit!,
    checks: [
      {
        id: 123,
        kind: "check",
        name: "CI",
        status: "completed",
        conclusion: "failure",
        url: state.pr_url,
        completedAt: "2026-10-23T12:00:00Z",
      },
    ],
    failureArtifact: randomUUID(),
  };
  let tick = Date.now();
  const read = async () => (await readCoding(boss.getDb(), issueId))[0];
  const observe = async (p = pr, checks = failure) =>
    recordGitHubObservation(boss, observed(await read()), new Date(++tick), {
      pr: p,
      checks,
    });
  const initial = original.change_requests?.length ?? 0;
  const activeBlockers = async () =>
    (
      await boss
        .getDb()
        .executeSql(
          `SELECT e.id FROM code_assist.intake_event e JOIN code_assist.intake_issue i ON i.id=e.issue_id WHERE i.id=$1 AND e.type='coding_pr_checks_blocked' AND ${currentAttention}`,
          [issueId],
        )
    ).rows.length;
  try {
    for (const conclusion of [null, "success", "skipped", "cancelled"]) {
      await observe(pr, {
        commit: failure.commit,
        checks: [
          {
            ...failure.checks[0],
            status: conclusion ? "completed" : "in_progress",
            conclusion,
          },
        ],
      });
      assert.equal((await read()).change_requests?.length ?? 0, initial);
    }
    await observe(pr, { commit: failure.commit, checks: [] });
    for (const bad of [
      { ...pr, body: "not-owned" },
      { ...pr, headRefName: "someone-else" },
      { ...pr, isCrossRepository: true },
      { ...pr, headRefOid: "e".repeat(40) },
    ]) {
      await observe(bad, { ...failure, commit: bad.headRefOid! });
      assert.equal((await read()).status, "pr_open");
      assert.match((await read()).github_error!, /ownership/);
    }
    await observe(pr, {
      ...failure,
      failureArtifact: undefined,
      error: "GitHub logs unavailable",
    });
    assert.match((await read()).github_error!, /logs unavailable/);
    assert.equal(await activeBlockers(), 1);
    assert.equal((await read()).change_requests?.length ?? 0, initial);
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET workspace_cleaned_at=now() WHERE id=$1",
        [original.id],
      );
    await observe();
    assert.match((await read()).github_error!, /workspace/);
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET workspace_cleaned_at=NULL WHERE id=$1",
        [original.id],
      );

    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.planning_run SET status='needs_direction' WHERE id=$1",
        [original.planning_id],
      );
    await observe();
    assert.match((await read()).github_error!, /current plan approval/);
    assert.equal((await read()).change_requests?.length ?? 0, initial);
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.planning_run SET status='approved' WHERE id=$1",
        [original.planning_id],
      );

    // A head change during network collection must not enqueue a revision.
    let reads = 0;
    await refreshGitHub(
      boss,
      { runId: original.id },
      new AbortController().signal,
      randomUUID(),
      async (run) =>
        run.pr_url === pr.url
          ? ++reads === 1
            ? pr
            : { ...pr, headRefOid: "e".repeat(40) }
          : { ...pr, url: run.pr_url!, headRefOid: undefined },
      async () => ({ runs: [] }),
      async () => failure,
    );
    assert.equal((await read()).change_requests?.length ?? 0, initial);

    if (original.repositories) {
      const partial = original.repositories.map((r, i) =>
        i === index
          ? r
          : {
              ...r,
              status: "done",
              merged_at: new Date().toISOString(),
              merge_commit: "f".repeat(40),
            },
      );
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
          [original.id, JSON.stringify(partial)],
        );
    }
    if (original.repositories) {
      // A newer corrective run owns recovery; historical parent observations cannot start another repair.
      const newerId = randomUUID();
      await boss.getDb().executeSql(
        `INSERT INTO code_assist.coding_run(id,issue_id,planning_id,version,input,plan,identifier,title,branch,status,parent_run_id)
      SELECT $2,issue_id,planning_id,version,input,plan,identifier,title,'fixture-newer','needs_direction',id FROM code_assist.coding_run WHERE id=$1`,
        [original.id, newerId],
      );
      await observe();
      assert.equal((await read()).change_requests?.length ?? 0, initial);
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.coding_run SET status='superseded' WHERE id=$1",
          [newerId],
        );
      await boss
        .getDb()
        .executeSql("DELETE FROM code_assist.coding_run WHERE id=$1", [
          newerId,
        ]);
    }
    if (original.repositories) {
      const current = await read();
      const states = current.repositories!.map((r, i) =>
        i === index
          ? r
          : {
              ...r,
              status: "main_failed",
              main_workflows: {
                runs: [
                  {
                    id: 77,
                    run_attempt: 1,
                    name: "Main CI",
                    html_url: r.pr_url,
                    head_sha: r.merge_commit,
                    head_branch: "main",
                    event: "push",
                    status: "completed",
                    conclusion: "failure",
                  },
                ],
                failureArtifact: randomUUID(),
              },
            },
      );
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
          [original.id, JSON.stringify(states)],
        );
    }
    const before = await read();
    const same = observed(before);
    await Promise.all([
      recordGitHubObservation(boss, same, new Date(++tick), {
        pr,
        checks: failure,
      }),
      recordGitHubObservation(boss, same, new Date(++tick), {
        pr,
        checks: failure,
      }),
    ]);
    let queued = await read();
    assert.equal(queued.status, "implement");
    assert.equal(
      (await readCoding(boss.getDb(), issueId)).length,
      1,
      "CI revision must not also start a companion main repair",
    );
    if (queued.repositories) {
      const states = queued.repositories.map((r, i) =>
        i === index ? r : { ...r, status: "done", main_workflows: null },
      );
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
          [original.id, JSON.stringify(states)],
        );
      queued = await read();
    }

    assert.equal(queued.change_requests!.length, initial + 1);
    assert.equal(queued.change_requests!.at(-1)!.kind, "pr_ci");
    assert.equal(
      queued.change_requests!.at(-1)!.requestedBy,
      "github-check-monitor",
    );
    assert.equal(
      queued.change_requests!.at(-1)!.prCi!.artifact,
      failure.failureArtifact,
    );
    assert.deepEqual(codingIndexes(queued), [index]);
    assert.equal(publicationReady(queued, original.steps), false);
    assert.equal(queued.branch, original.branch);
    assert.equal(queued.workspace_id, original.workspace_id);
    assert.equal(
      await recordGitHubObservation(boss, same, new Date(++tick), {
        pr,
        checks: failure,
      }),
      false,
    );
    // Owner-requested main reconciliation must retain a paused CI repair's repository scope.
    const paused = (await next())!;
    await finishCoding(
      boss,
      paused.run,
      paused.step,
      { disposition: "needs_direction", directionQuestion: "Bring in main." },
      "needs_direction",
    );
    await requestCodingChanges(
      boss,
      issueId,
      queued.id,
      paused.step.id,
      "Bring in main",
      "fixture-owner",
      "bring_in_main",
    );
    queued = await read();
    assert.deepEqual(codingIndexes(queued), [index]);
    assert.deepEqual(Object.keys(queued.change_requests!.at(-1)!.baseCommits), [
      state.name,
    ]);
    await boss.stop();
    await boss.start();
    for (const [kind, target, result] of [
      ["implement", "validate", {}],
      ["validate", "review", { passed: true }],
      ["review", "publish", { disposition: "ready", findings: [] }],
      ["publish", "pr_open", {}],
    ] as const) {
      const work = (await next())!;
      assert.equal(work.step.kind, kind);
      assert.equal(work.step.repository_index, index);
      assert.equal(
        work.step.change_request_id,
        queued.change_requests!.at(-1)!.id,
      );
      if (kind === "publish")
        assert(publicationReady(work.run, (await read()).steps));
      await finishCoding(boss, work.run, work.step, result, target);
    }
    const repaired = await read();
    assert.equal(repaired.pr_url, original.pr_url);
    if (repaired.repositories)
      assert.equal(
        repaired.repositories[0].status,
        "done",
        "the merged companion repository must stay untouched",
      );
    await observe();
    assert.equal(
      (await read()).change_requests!.length,
      initial + 2,
      "the same failure must not restart an unchanged repair",
    );
    assert.match((await read()).github_error!, /already has a recorded repair/);
    await observe(pr, {
      commit: failure.commit,
      checks: [{ ...failure.checks[0], conclusion: "success" }],
    });
    assert.equal((await read()).github_error, null);
    assert.equal(await activeBlockers(), 0);
    assert.equal(
      (await read()).status,
      "pr_open",
      "green PR CI must not declare Done",
    );
  } finally {
    // Restore the enclosing fixture's published baseline for its existing main-workflow assertions.
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET current_step_id=$2,status=$3,commit=$4,repository_index=$5,repositories=$6,change_requests=$7,github_checked_at=$8,github_error=$9,pr_checks=$10,workspace_cleaned_at=$11 WHERE id=$1",
        [
          original.id,
          original.current_step_id,
          original.status,
          original.commit,
          original.repository_index ?? 0,
          original.repositories ? JSON.stringify(original.repositories) : null,
          JSON.stringify(original.change_requests ?? []),
          original.github_checked_at,
          original.github_error,
          original.pr_checks ? JSON.stringify(original.pr_checks) : null,
          original.workspace_cleaned_at ?? null,
        ],
      );
  }
}
