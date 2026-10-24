import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@code-assist/observability";
import {
  parsePrChecks,
  prFailureKey,
  readPrChecks,
} from "../src/github-pr-checks.ts";
import type { CodingRun } from "../src/coding-types.ts";
const commit = "a".repeat(40);
const raw = {
  id: 12,
  head_sha: commit,
  name: "unit",
  status: "completed",
  conclusion: "failure",
  completed_at: "2026-10-23T12:00:00Z",
  details_url: "https://github.com/example/repo/actions/runs/50/job/12",
  app: { slug: "github-actions" },
  output: { summary: "Assertion failed" },
};
const pr = {
  url: "https://github.com/example/repo/pull/1",
  state: "OPEN" as const,
  headRefOid: commit,
  headRefName: "feature/one-1",
  baseRefName: "main",
  mergedAt: null,
  closedAt: null,
  mergeCommit: null,
};

test("PR checks preserve all pages, reject a foreign head, and distinguish failed, pending and skipped checks", () => {
  const parse = (check: unknown = raw) =>
    parsePrChecks(
      [{ check_runs: [check] }, { check_runs: [] }],
      [
        {
          sha: commit,
          statuses: [
            {
              id: 15,
              context: "external",
              state: "pending",
              target_url: null,
              updated_at: "2026-10-23T12:00:00Z",
            },
          ],
        },
      ],
      commit,
    );
  assert(prFailureKey(parse()));
  for (const conclusion of ["success", "neutral", "skipped", "cancelled"])
    assert.equal(prFailureKey(parse({ ...raw, conclusion })), null);
  assert.equal(
    prFailureKey(parse({ ...raw, status: "in_progress", conclusion: null })),
    null,
  );
  assert.equal(
    prFailureKey(
      parsePrChecks(
        [{ check_runs: [] }],
        [{ sha: commit, statuses: [] }],
        commit,
      ),
    ),
    null,
  );
  assert.throws(() => parse({ ...raw, head_sha: "b".repeat(40) }));
  assert.throws(() => parse({ ...raw, details_url: "javascript:alert(1)" }));
  assert.throws(() =>
    parsePrChecks(
      [{ check_runs: [] }],
      [{ sha: "b".repeat(40), statuses: [] }],
      commit,
    ),
  );
  const first = parse();
  assert.notEqual(
    prFailureKey(first),
    prFailureKey({ ...first, commit: "b".repeat(40) }),
  );
  assert.notEqual(prFailureKey(first), prFailureKey(parse({ ...raw, id: 13 })));
});

test("native GitHub reads retain annotations and exact-attempt logs; missing logs never yield repair evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pr-checks-"));
  const log = createLogger("test", {
    logDirectory: directory,
    artifactDirectory: directory,
  });
  try {
    for (const scenario of [
      "complete",
      "inaccessible",
      "changed-attempt",
      "changed-conclusion",
    ]) {
      const execute: Parameters<typeof readPrChecks>[4] = async (
        _command,
        args,
      ) => {
        const path = args.at(-1)!;
        if (args[0] === "run") {
          assert.deepEqual(args, [
            "run",
            "view",
            "50",
            "--repo",
            "example/repo",
            "--attempt",
            "2",
            "--log-failed",
          ]);
          if (scenario === "inaccessible") throw new Error("logs unavailable");
          return "assert expected 42, got 41";
        }
        if (path.includes("/commits/") && path.includes("/check-runs"))
          return JSON.stringify([{ check_runs: [raw] }]);
        if (path.includes("/commits/") && path.includes("/status"))
          return JSON.stringify([{ sha: commit, statuses: [] }]);
        if (path.includes("/actions/runs?"))
          return JSON.stringify([
            {
              workflow_runs: [
                {
                  id: 50,
                  run_attempt: 2,
                  name: "CI",
                  head_sha: commit,
                  head_branch: pr.headRefName,
                  event: "pull_request",
                  status: "completed",
                  conclusion: "failure",
                  html_url: "https://github.com/example/repo/actions/runs/50",
                  updated_at: raw.completed_at,
                },
              ],
            },
          ]);
        if (path.endsWith("/check-runs/12")) return JSON.stringify(raw);
        if (path.includes("/annotations"))
          return JSON.stringify([
            [{ message: "first" }],
            [{ message: "second" }],
          ]);
        if (path.includes("/jobs?"))
          return JSON.stringify([{ jobs: [{ conclusion: "failure" }] }]);
        if (path.endsWith("/actions/runs/50"))
          return JSON.stringify({
            head_sha: commit,
            head_branch: pr.headRefName,
            repository: { full_name: "example/repo" },
            run_attempt: scenario === "changed-attempt" ? 3 : 2,
            status: "completed",
            conclusion:
              scenario === "changed-conclusion" ? "success" : "failure",
          });
        throw new Error("Unexpected API call " + path);
      };
      const result = await readPrChecks(
        {} as CodingRun,
        pr,
        new AbortController().signal,
        log,
        execute,
      );
      if (scenario !== "complete") {
        assert.equal(result.failureArtifact, undefined);
        assert.match(result.error!, /diagnostics/);
      } else {
        assert(result.failureArtifact);
        const evidence = await readFile(
          join(directory, result.failureArtifact + ".json"),
          "utf8",
        );
        for (const fragment of [
          "first",
          "second",
          "assert expected 42, got 41",
        ])
          assert(evidence.includes(fragment));
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
