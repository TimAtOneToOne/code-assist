import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  codingHistoryHandoff,
  writeCodingHistory,
  codingHistoryDirectory,
} from "../src/coding-history.ts";
import type { CodingRun, CodingStep } from "../src/coding-types.ts";

const run = {
  input: { snapshots: [{ name: "first" }, { name: "second" }] },
} as CodingRun;
function step(fields: Partial<CodingStep> = {}): CodingStep {
  return {
    id: randomUUID(),
    kind: "validate",
    status: "completed",
    repository_index: 0,
    result: { passed: true },
    ...fields,
  } as CodingStep;
}

test("handoff keeps current outcomes for every repository and full historical records on demand", async () => {
  const old = step({
    kind: "collect",
    continuation: { kind: "review" } as CodingStep["continuation"],
    result: {
      findings: [{ detail: "obsolete concern" }],
      tools: [{ output: "historical payload ".repeat(100000) }],
    },
  });
  const current = step({ kind: "implement", status: "running", result: null });
  const review = step({
    kind: "collect",
    continuation: { kind: "review" } as CodingStep["continuation"],
    result: {
      summary: "Ready after verification",
      findings: [],
      tools: [{ output: "tool detail" }],
    },
  });
  const implementation = step({
    kind: "collect",
    continuation: { kind: "implement" } as CodingStep["continuation"],
    result: {
      summary: "Current implementation",
      pullRequestDescription: "Retain operator prerequisite",
      tools: [{ output: "large tool transcript" }],
    },
  });
  const validation = step({
    result: {
      passed: false,
      commands: { test: 0 },
      sourceChanges: { status: " M lockfile", diff: "exact checksum diff" },
    },
  });
  const other = step({
    repository_index: 1,
    result: { passed: false, commands: { test: 1 } },
  });
  const failure = step({
    kind: "publish",
    status: "failed",
    error: "Merge conflict",
  });
  const history = [
    old,
    implementation,
    review,
    validation,
    other,
    failure,
    current,
  ];
  const prompt = codingHistoryHandoff(run, current, history);
  assert(prompt.includes("Ready after verification"));
  assert(prompt.includes("Retain operator prerequisite"));
  assert(prompt.includes("Merge conflict"));
  assert(prompt.includes(other.id));
  assert(prompt.includes(" M lockfile"));
  assert(!prompt.includes("obsolete concern"));
  assert(!prompt.includes("large tool transcript"));
  assert(!prompt.includes("exact checksum diff"));
  assert(prompt.length < 10000);
  const base = resolve("../../.tmp/coding-history-tests");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "archive-"));
  try {
    await writeCodingHistory(current, history, async (args, input) => {
      const payload = JSON.parse(input!);
      payload.directory = directory;
      // Execute the exact guest writer with a local stdin pipe.
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        const p = spawn(args[0], args.slice(1), {
          stdio: ["pipe", "ignore", "pipe"],
        });
        let error = "";
        p.stderr.on("data", (x) => (error += x));
        p.on("error", reject);
        p.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(error)),
        );
        p.stdin.end(JSON.stringify(payload));
      });
    });
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, old.id + ".json"), "utf8")),
      old,
    );
    assert.equal(
      JSON.parse(
        await readFile(join(directory, validation.id + ".json"), "utf8"),
      ).result.sourceChanges.diff,
      "exact checksum diff",
    );
    assert(
      (await readFile(join(directory, "README.md"), "utf8")).includes(old.id),
    );
    assert(codingHistoryDirectory(current).endsWith(current.id));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
