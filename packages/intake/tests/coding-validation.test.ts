import assert from "node:assert/strict";
import { test } from "node:test";
import { repeatedValidationFailure } from "../src/coding-validation-outcome.ts";
import type { CodingStep } from "../src/coding-types.ts";

const commit = "a".repeat(40);
const result = { commit, commands: { lint: 0, test: 2 }, passed: false };
function step(overrides: Partial<CodingStep> = {}): CodingStep {
  return {
    id: "current",
    run_id: "run",
    job_id: "job",
    kind: "validate",
    input_commit: commit,
    input_commits: { first: commit, second: "b".repeat(40) },
    repository_index: 0,
    status: "running",
    worker_pid: null,
    result: null,
    error: null,
    created_at: new Date(),
    finished_at: null,
    ...overrides,
  };
}
const previous = step({ id: "previous", status: "completed", result });
const implementation = step({
  id: "implementation",
  kind: "implement",
  status: "completed",
});
const history = [previous, implementation];

test("unchanged candidate and command failures pause after another implementation attempt", () => {
  assert.equal(repeatedValidationFailure(step(), result, history), previous.id);
  assert.equal(
    repeatedValidationFailure(
      step(),
      { ...result, commands: { test: 2, lint: 0 } },
      history,
    ),
    previous.id,
  );
});

test("first failure, actual progress and successful validation continue normally", () => {
  for (const [current, validation, steps] of [
    [step(), result, []],
    [step(), result, [previous]],
    [
      step(),
      { ...result, passed: true, commands: { lint: 0, test: 0 } },
      history,
    ],
    [step(), { ...result, commit: "c".repeat(40) }, history],
    [step(), { ...result, commands: { lint: 0, test: 1 } }, history],
    [step(), { ...result, commands: { lint: 2, test: 0 } }, history],
    [
      step({ input_commits: { first: commit, second: "c".repeat(40) } }),
      result,
      history,
    ],
    [
      step(),
      result,
      [
        previous,
        step({
          id: "passed",
          status: "completed",
          result: { ...result, passed: true },
        }),
        implementation,
      ],
    ],
  ] as const)
    assert.equal(
      repeatedValidationFailure(current, validation, [...steps]),
      undefined,
    );
});

test("failure comparisons stay within the run, repository and latest human instruction", () => {
  for (const overrides of [
    { run_id: "another" },
    { repository_index: 1 },
    { change_request_id: "new-request" },
    { direction_response_id: "new-reply" },
  ])
    assert.equal(
      repeatedValidationFailure(step(overrides), result, history),
      undefined,
    );
  assert.equal(
    repeatedValidationFailure(step(), result, [
      { ...previous, status: "failed" },
      implementation,
    ]),
    undefined,
  );
  assert.equal(
    repeatedValidationFailure(step(), result, [
      previous,
      { ...implementation, status: "failed" },
    ]),
    undefined,
  );
});

test("legacy single-repository steps without commit sets still pause", () => {
  assert.equal(
    repeatedValidationFailure(step({ input_commits: null }), result, [
      { ...previous, input_commits: null },
      implementation,
    ]),
    previous.id,
  );
});
