import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePullRequest } from "../src/github.ts";

test("PR observations require the expected GitHub URL and complete merge evidence", () => {
  const url = "https://github.com/example/repo/pull/125";
  const pr = {
    url,
    state: "MERGED",
    baseRefName: "main",
    mergedAt: "2026-10-20T20:24:17Z",
    closedAt: "2026-10-20T20:24:17Z",
    mergeCommit: { oid: "a".repeat(40) },
  };
  assert.equal(parsePullRequest(pr, url).state, "MERGED");
  for (const invalid of [
    null,
    { ...pr, url: "https://github.com/example/other/pull/125" },
    { ...pr, state: "APPROVED" },
    { ...pr, mergedAt: null },
    { ...pr, mergeCommit: null },
    { ...pr, state: "CLOSED", closedAt: null },
  ]) {
    assert.throws(() => parsePullRequest(invalid, url));
  }
  assert.throws(() =>
    parsePullRequest(
      { ...pr, url: "https://example.invalid/pull/125" },
      "https://example.invalid/pull/125",
    ),
  );
});

import {
  parseMainWorkflows,
  mainWorkflowStatus,
  mainFailureKey,
  mergedCompletionStatus,
} from "../src/github-workflows.ts";

const workflow = {
  id: 42,
  run_attempt: 1,
  name: "Deploy",
  html_url: "https://github.com/example/repo/actions/runs/42",
  head_sha: "a".repeat(40),
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
};
test("merge-only completion is explicit and still requires main", () => {
  assert.equal(mergedCompletionStatus("merge", "main"), "done");
  assert.equal(mergedCompletionStatus("merge", "prod"), "awaiting_main");
  assert.equal(
    mergedCompletionStatus("main_workflows", "main"),
    "awaiting_main",
  );
  assert.equal(
    mergedCompletionStatus("main_workflows", "main", { runs: [] }),
    "awaiting_main",
  );
  assert.equal(
    mergedCompletionStatus("main_workflows", "main", { runs: [workflow] }),
    "done",
  );
  assert.equal(
    mergedCompletionStatus("main_workflows", "main", {
      runs: [{ ...workflow, conclusion: "failure" }],
    }),
    "main_failed",
  );
});
test("Done requires successful main runs for the exact merge, not PR checks or prod promotion", () => {
  const parse = (run: unknown) =>
    parseMainWorkflows(
      [{ workflow_runs: [run] }],
      "example/repo",
      workflow.head_sha,
    );
  assert.equal(parse(workflow).length, 1);
  for (const invalid of [
    { ...workflow, head_sha: "b".repeat(40) },
    { ...workflow, head_branch: "prod" },
    { ...workflow, event: "pull_request" },
    { ...workflow, event: "workflow_dispatch" },
    { ...workflow, html_url: "https://github.com/other/repo/actions/runs/42" },
    { ...workflow, conclusion: null },
    { ...workflow, run_attempt: 0 },
  ])
    assert.throws(() => parse(invalid));
  assert.equal(mainWorkflowStatus({ runs: [] }), "awaiting_main");
  assert.equal(
    mainWorkflowStatus({
      runs: [
        workflow,
        { ...workflow, id: 43, status: "in_progress", conclusion: null },
      ],
    }),
    "main_running",
  );
  assert.equal(mainWorkflowStatus({ runs: [workflow] }), "done");
  for (const conclusion of [
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "neutral",
    "skipped",
    "startup_failure",
  ])
    assert.equal(
      mainWorkflowStatus({ runs: [{ ...workflow, conclusion }] }),
      "main_failed",
    );
  assert.equal(mainFailureKey({ runs: [workflow] }), null);
  const failed = { ...workflow, conclusion: "failure" };
  assert.notEqual(
    mainFailureKey({ runs: [failed] }),
    mainFailureKey({ runs: [{ ...failed, run_attempt: 2 }] }),
  );
});
