import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PgBoss } from "pg-boss";
import {
  answerCodingDirection,
  finishCoding,
  readCoding,
  type startCoding,
} from "../src/coding.ts";
import { publicationReady } from "../src/coding-repositories.ts";

export async function exerciseCodingDirection(
  boss: PgBoss,
  work: NonNullable<Awaited<ReturnType<typeof startCoding>>>,
  next: () => ReturnType<typeof startCoding>,
) {
  const { run, step } = work;
  const question = "Can you provide deployment examples?";
  const text =
    "I accept failed jobs during deployment. Drop the ordering change.";
  await assert.rejects(
    answerCodingDirection(boss, run.issue_id, run.id, step.id, text, "owner"),
  );
  await finishCoding(
    boss,
    run,
    step,
    {
      disposition: "needs_direction",
      directionQuestion: question,
      summary: "Waiting for direction",
    },
    "needs_direction",
  );
  const before = (await readCoding(boss.getDb(), run.issue_id)).find(
    (r) => r.id === run.id,
  )!;
  await assert.rejects(
    answerCodingDirection(boss, run.issue_id, run.id, step.id, "  ", "owner"),
  );
  await assert.rejects(
    answerCodingDirection(
      boss,
      run.issue_id,
      run.id,
      randomUUID(),
      text,
      "owner",
    ),
  );
  await assert.rejects(
    answerCodingDirection(boss, randomUUID(), run.id, step.id, text, "owner"),
  );
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      answerCodingDirection(boss, run.issue_id, run.id, step.id, text, "owner"),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await boss.stop();
  await boss.start();
  const resumed = (await next())!;
  const reply = resumed.run.direction_responses!.at(-1)!;
  assert.equal(reply.question, question);
  assert.equal(reply.text, text);
  assert.equal(reply.requestedBy, "owner");
  assert.equal(reply.stepId, step.id);
  assert.equal(resumed.step.direction_response_id, reply.id);
  assert.equal(resumed.step.kind, "implement");
  assert.equal(resumed.run.workspace_id, run.workspace_id);
  assert.equal(resumed.run.branch, run.branch);
  assert.deepEqual(resumed.run.change_requests, run.change_requests);
  assert.deepEqual(resumed.run.plan, run.plan);
  assert.equal(publicationReady(resumed.run, before.steps), false);
  assert.equal(
    resumed.run.direction_responses!.length,
    (run.direction_responses?.length ?? 0) + 1,
  );
  return resumed;
}
