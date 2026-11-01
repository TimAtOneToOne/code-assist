import assert from "node:assert/strict";
import type { PgBoss } from "pg-boss";
import {
  answerCodingDirection,
  codingQueue,
  finishCoding,
  readCoding,
  type startCoding,
} from "../src/coding.ts";
import { finishValidation } from "../src/coding-validation-outcome.ts";
import { publicationReady } from "../src/coding-repositories.ts";

export async function exerciseValidationLoop(
  boss: PgBoss,
  work: NonNullable<Awaited<ReturnType<typeof startCoding>>>,
  next: () => ReturnType<typeof startCoding>,
) {
  async function validate(implementation: typeof work, mutation = false) {
    assert.equal(implementation.step.kind, "implement");
    for (const kind of ["checkpoint", "collect", "validate"] as const) {
      assert(
        await finishCoding(
          boss,
          implementation.run,
          implementation.step,
          {},
          kind,
        ),
      );
      implementation = (await next())!;
    }
    assert.equal(implementation.step.kind, "validate");
    const result = {
      commit: implementation.run.commit!,
      commands: { lint: 0, test: mutation ? 0 : 2 },
      passed: mutation,
      ...(mutation
        ? { sourceChanges: { status: " M lockfile", diff: "+linux-checksum" } }
        : {}),
    };
    assert(
      await finishValidation(
        boss,
        implementation.run,
        implementation.step,
        result,
      ),
    );
    return implementation;
  }
  const changed = await validate(work, true);
  const repair = (await next())!;
  assert.equal(repair.step.kind, "implement");
  assert.equal(repair.step.recovery_step_id, changed.step.id);
  assert.equal(repair.run.commit, changed.run.commit);
  const savedChange = (await readCoding(boss.getDb(), work.run.issue_id))[0];
  assert.equal(publicationReady(savedChange, savedChange.steps), false);
  assert.equal(
    savedChange.steps.find((s) => s.id === changed.step.id)!.result?.passed,
    false,
  );
  assert.match(
    savedChange.steps.find((s) => s.id === changed.step.id)!.result
      ?.summary as string,
    /Checks passed, but validation changed files/,
  );
  const first = changed;
  const second = await validate(repair, true);
  const paused = (await readCoding(boss.getDb(), work.run.issue_id))[0];
  assert.equal(paused.status, "needs_direction");
  assert.equal(paused.current_step_id, second.step.id);
  assert.equal(paused.commit, work.run.commit);
  assert.equal(paused.workspace_id, work.run.workspace_id);
  if (paused.repositories)
    assert.equal(
      paused.repositories[paused.repository_index ?? 0].status,
      "needs_direction",
    );
  assert.equal(publicationReady(paused, paused.steps), false);
  const saved = paused.steps.find((s) => s.id === second.step.id)!;
  assert.equal(saved.result?.passed, false);
  assert.equal(saved.result?.previousValidationStepId, first.step.id);
  assert.match(
    saved.result?.directionQuestion as string,
    /passing validation and independent review/,
  );
  assert.equal((await boss.fetch(codingQueue)).length, 0);
  assert.equal(
    await finishValidation(boss, second.run, second.step, {
      commit: second.run.commit!,
      commands: { test: 0 },
      passed: true,
    }),
    false,
  );
  await answerCodingDirection(
    boss,
    paused.issue_id,
    paused.id,
    second.step.id,
    "Investigate the baseline failure without changing unrelated code.",
    "owner",
  );
  await boss.stop();
  await boss.start();
  const resumed = (await next())!;
  assert.equal(
    resumed.run.direction_responses!.at(-1)!.question,
    saved.result?.directionQuestion,
  );
  await validate(resumed);
  const fresh = (await next())!;
  assert.equal(resumed.step.recovery_step_id, second.step.id);
  assert.equal(fresh.step.kind, "implement");
  assert.equal(fresh.run.workspace_id, work.run.workspace_id);
  return fresh;
}
