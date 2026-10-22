import assert from "node:assert/strict";
import type { PgBoss } from "pg-boss";
import {
  finishCoding,
  failCoding,
  retryCoding,
  type startCoding,
} from "../src/coding.ts";
import {
  missingBrowserEvidence,
  browserEvidenceRequiredMessage,
} from "../src/coding-types.ts";

export async function exerciseMissingBrowserEvidence(
  boss: PgBoss,
  work: NonNullable<Awaited<ReturnType<typeof startCoding>>>,
  next: () => ReturnType<typeof startCoding>,
) {
  const original = work;
  const continuation = {
    agentStepId: work.step.id,
    kind: "implement" as const,
    result: {
      summary: "No changes; reused old screenshots",
      disposition: "implemented",
      directionQuestion: "",
      browserEvidence: ["/work/evidence/old.png"],
    },
    browserCalls: [],
  };
  await finishCoding(
    boss,
    work.run,
    work.step,
    continuation.result,
    "checkpoint",
    undefined,
    undefined,
    undefined,
    undefined,
    continuation,
  );
  work = (await next())!;
  await finishCoding(
    boss,
    work.run,
    work.step,
    { commit: work.run.commit },
    "collect",
    work.run.commit!,
    undefined,
    undefined,
    undefined,
    continuation,
  );
  work = (await next())!;
  assert.equal(
    missingBrowserEvidence(work.run, work.step),
    false,
    "archive must be preserved before sending back to the agent",
  );
  await failCoding(
    boss,
    work.run,
    work.step,
    "Old generic evidence collection error",
  );
  await retryCoding(boss, work.run.issue_id, work.run.id, work.step.id);
  work = (await next())!;
  assert.equal(
    work.step.kind,
    "collect",
    "unknown or transport failures must retry collection first",
  );
  work.step.error = browserEvidenceRequiredMessage;
  assert(missingBrowserEvidence(work.run, work.step));
  assert.equal(
    missingBrowserEvidence(work.run, {
      ...work.step,
      continuation: {
        ...continuation,
        browserCalls: ["browser_run_code_unsafe"],
      },
    }),
    false,
  );
  assert.equal(
    missingBrowserEvidence(work.run, {
      ...work.step,
      continuation: {
        ...continuation,
        result: { ...continuation.result, disposition: "needs_direction" },
      },
    }),
    false,
  );
  const multi = {
    ...work.run,
    input: {
      ...work.run.input,
      snapshots: [
        work.run.input.snapshot,
        { ...work.run.input.snapshot, name: "second" },
      ],
    },
  };
  assert.equal(
    missingBrowserEvidence(multi, work.step),
    false,
    "intermediate repositories can defer combined browser acceptance",
  );
  await failCoding(boss, work.run, work.step, browserEvidenceRequiredMessage);
  await retryCoding(boss, work.run.issue_id, work.run.id, work.step.id);
  const resumed = (await next())!;
  assert.equal(resumed.step.kind, "implement");
  assert.equal(
    resumed.step.continuation,
    null,
    "must not replay the same incomplete receipt",
  );
  assert.equal(resumed.step.recovery_step_id, null);
  assert.equal(resumed.step.input_commit, original.step.input_commit);
  assert.equal(resumed.run.workspace_id, original.run.workspace_id);
  assert.deepEqual(
    resumed.run.direction_responses,
    original.run.direction_responses,
  );
  return resumed;
}
