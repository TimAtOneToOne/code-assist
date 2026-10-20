import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePullRequest } from "../src/github.ts";

test("PR observations require the expected GitHub URL and complete merge evidence", () => {
  const url = "https://github.com/example/repo/pull/125";
  const pr = {
    url,
    state: "MERGED",
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
