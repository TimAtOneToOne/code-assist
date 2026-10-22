import assert from "node:assert/strict";
import type { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import {
  requestCodingChanges,
  readCoding,
  finishCoding,
  failCoding,
  retryCoding,
  type startCoding,
} from "../src/coding.ts";
import {
  codingIndexes,
  commitSet,
  publicationReady,
  repositories,
  repositoryRun,
} from "../src/coding-repositories.ts";
import { recordGitHubObservation } from "../src/github.ts";

export async function exerciseCodeChanges(
  boss: PgBoss,
  issueId: string,
  next: () => ReturnType<typeof startCoding>,
) {
  const original = (await readCoding(boss.getDb(), issueId))[0];
  const indexes = codingIndexes(original);
  for (const status of ["done", "pr_closed", "failed", "needs_direction"]) {
    await boss
      .getDb()
      .executeSql("UPDATE code_assist.coding_run SET status=$2 WHERE id=$1", [
        original.id,
        status,
      ]);
    await assert.rejects(
      requestCodingChanges(
        boss,
        issueId,
        original.id,
        original.current_step_id,
        "Change it",
        "owner",
      ),
    );
  }
  await boss
    .getDb()
    .executeSql(
      "UPDATE code_assist.coding_run SET status='pr_open' WHERE id=$1",
      [original.id],
    );
  if (original.repositories) {
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
        [
          original.id,
          JSON.stringify(
            original.repositories.map((r, i) =>
              i
                ? r
                : { ...r, status: "done", merged_at: new Date().toISOString() },
            ),
          ),
        ],
      );
    await assert.rejects(
      requestCodingChanges(
        boss,
        issueId,
        original.id,
        original.current_step_id,
        "Change it",
        "owner",
      ),
    );
    await boss
      .getDb()
      .executeSql(
        "UPDATE code_assist.coding_run SET repositories=$2 WHERE id=$1",
        [original.id, JSON.stringify(original.repositories)],
      );
  }
  for (const note of [
    "Clarify the button label.",
    "Keep that label and improve the confirmation.",
  ]) {
    const before = (await readCoding(boss.getDb(), issueId))[0];
    await assert.rejects(
      requestCodingChanges(
        boss,
        issueId,
        before.id,
        before.current_step_id,
        "  ",
        "owner",
      ),
    );
    await assert.rejects(
      requestCodingChanges(
        boss,
        issueId,
        before.id,
        randomUUID(),
        note,
        "owner",
      ),
    );
    const results = await Promise.allSettled([
      requestCodingChanges(
        boss,
        issueId,
        before.id,
        before.current_step_id,
        note,
        "owner",
      ),
      requestCodingChanges(
        boss,
        issueId,
        before.id,
        before.current_step_id,
        note,
        "owner",
      ),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const queued = (await readCoding(boss.getDb(), issueId))[0];
    const request = queued.change_requests!.at(-1)!;
    assert.equal(request.text, note);
    assert.equal(request.requestedBy, "owner");
    assert.deepEqual(
      request.baseCommits,
      Object.fromEntries(
        indexes.map((i) => [
          repositories(before)[i].name,
          repositories(before)[i].commit,
        ]),
      ),
    );
    assert.equal(queued.status, "implement");
    assert.equal(queued.branch, original.branch);
    assert.equal(queued.workspace_id, original.workspace_id);
    assert.equal(
      publicationReady(queued, before.steps),
      false,
      "previous review cannot authorize this request even when commits match",
    );
    const staleObservation = {
      ...repositoryRun(before, indexes[0]),
      pr_url: repositories(before)[indexes[0]].pr_url,
    };
    assert.equal(
      await recordGitHubObservation(boss, staleObservation, new Date(), {
        pr: {
          url: staleObservation.pr_url!,
          state: "OPEN",
          baseRefName: "main",
          mergedAt: null,
          closedAt: null,
          mergeCommit: null,
        },
      }),
      false,
    );
    assert.equal(
      (await readCoding(boss.getDb(), issueId))[0].status,
      "implement",
    );
    await boss.stop();
    await boss.start();
    for (const round of [0, 1]) {
      for (const index of indexes) {
        let work = (await next())!;
        assert.equal(work.step.kind, "implement");
        assert.equal(work.step.repository_index, index);
        assert.equal(work.step.change_request_id, request.id);
        assert.equal(
          work.step.input_commit,
          repositories(before)[index].commit,
        );
        if (!round && index === indexes[0]) {
          await failCoding(boss, work.run, work.step, "Interrupted revision");
          await boss.fail("approved-coding", work.step.job_id);
          await retryCoding(boss, issueId, work.run.id, work.step.id);
          work = (await next())!;
          assert.equal(work.step.change_request_id, request.id);
        }
        const progress = (target: number) =>
          work.run.repositories
            ? { repositories: work.run.repositories, index: target }
            : undefined;
        await finishCoding(
          boss,
          work.run,
          work.step,
          { summary: "Revised" },
          "validate",
        );
        work = (await next())!;
        assert.equal(work.step.kind, "validate");
        const following = indexes[indexes.indexOf(index) + 1];
        await finishCoding(
          boss,
          work.run,
          work.step,
          { passed: true },
          following === undefined ? "review" : "implement",
          undefined,
          undefined,
          undefined,
          progress(following ?? index),
        );
      }
      const review = (await next())!;
      assert.equal(review.step.kind, "review");
      assert.equal(review.step.change_request_id, request.id);
      await finishCoding(
        boss,
        review.run,
        review.step,
        {
          summary: round ? "Ready" : "Fix confirmation",
          disposition: round ? "ready" : "revise",
          findings: round ? [] : [{ severity: "high" }],
        },
        round ? "publish" : "implement",
        undefined,
        undefined,
        undefined,
        review.run.repositories
          ? { repositories: review.run.repositories, index: indexes[0] }
          : undefined,
      );
    }
    for (const index of indexes) {
      const publication = (await next())!;
      assert.equal(publication.step.kind, "publish");
      const detail = (await readCoding(boss.getDb(), issueId))[0];
      assert(publicationReady(publication.run, detail.steps));
      assert.deepEqual(commitSet(publication.run), commitSet(before));
      const following = indexes[indexes.indexOf(index) + 1];
      await finishCoding(
        boss,
        publication.run,
        publication.step,
        {},
        following === undefined ? "pr_open" : "publish",
        undefined,
        undefined,
        original.pr_url!,
        publication.run.repositories
          ? {
              repositories: publication.run.repositories,
              index: following ?? index,
            }
          : undefined,
      );
    }
    const after = (await readCoding(boss.getDb(), issueId))[0];
    assert.equal(after.status, "pr_open");
    assert.equal(after.pr_url, original.pr_url);
    assert.equal(
      after.change_requests!.length,
      (before.change_requests?.length ?? 0) + 1,
    );
    assert.equal(
      await recordGitHubObservation(boss, staleObservation, new Date(), {
        error: "Late response",
      }),
      false,
    );
  }
}
