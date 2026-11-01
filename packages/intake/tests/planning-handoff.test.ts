import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { planningPrompt, repositoryReadHook } from "../src/planning-agent.ts";
import {
  planningArtifact,
  planningHandoff,
  validateFindingResponses,
  writePlanningArtifacts,
} from "../src/planning-artifacts.ts";
import {
  parsePlan,
  type PlanningStep,
  type PlanVersion,
} from "../src/planning-types.ts";

const versions: PlanVersion[] = [1, 2, 3].map((number) => ({
  number,
  run_id: "run",
  hash: String(number),
  created_at: new Date("2026-11-01T12:00:00Z"),
  document: {
    markdown: `# Plan v${number}\n\nDESIGN_${number}`,
    changeSummary: `CHANGE_${number}`,
    responses:
      number === 1
        ? []
        : [
            {
              findingId: "owner-check",
              action: "not_accepted",
              response: `EVIDENCE_${number}: the existing boundary enforces ownership.`,
            },
          ],
  },
  review: {
    summary: `REVIEW_${number}`,
    disposition: "revise",
    directionQuestion: "",
    findings: [
      {
        id: "owner-check",
        severity: "high",
        title: "Verify Ownership",
        detail: `DETAIL_${number}`,
        recommendation: "Check the caller's ownership.",
      },
    ],
  },
}));
function step(kind: PlanningStep["kind"], version: number): PlanningStep {
  return {
    id: `${kind}-${version}`,
    run_id: "run",
    kind,
    version,
    input: {
      handoffVersion: 1,
      discovery: { ticket: { description: "REQUIREMENT" } },
      versions: versions.filter(
        (v) =>
          v.number < version || (kind === "review" && v.number === version),
      ),
      feedback: [
        { version: 1, note: "Keep retention.", created_at: new Date() },
        {
          version: 2,
          note: "Add active-run coverage.",
          created_at: new Date(),
        },
      ],
    },
  } as PlanningStep;
}

test("each planning pass receives its current documents and keeps owner direction", () => {
  assert.deepEqual(planningHandoff(step("draft", 1)), []);
  assert.deepEqual(
    planningHandoff(step("review", 1)).map((a) => a.name),
    ["plan_v1.md"],
  );
  assert.deepEqual(
    planningHandoff(step("draft", 2)).map((a) => a.name),
    ["plan_v1.md", "plan_v1_claude_feedback.md"],
  );
  const draft = step("draft", 3);
  assert.deepEqual(
    planningHandoff(draft).map((a) => a.name),
    ["plan_v2.md", "plan_v2_reasoning.md", "plan_v2_claude_feedback.md"],
  );
  const review = step("review", 3);
  assert.deepEqual(
    planningHandoff(review).map((a) => a.name),
    ["plan_v3.md", "plan_v3_reasoning.md", "plan_v2_claude_feedback.md"],
  );
  for (const current of [draft, review]) {
    const prompt = planningPrompt(current, undefined, undefined, "/archive");
    for (const value of [
      "REQUIREMENT",
      "Keep retention.",
      "Add active-run coverage.",
      "DETAIL_2",
      "/archive/README.md",
    ])
      assert(prompt.includes(value), value);
    assert(!prompt.includes("DESIGN_1"));
    assert(!prompt.includes("REVIEW_1"));
  }
  const reviewPrompt = planningPrompt(review);
  assert(reviewPrompt.includes("EVIDENCE_3"));
  assert(reviewPrompt.includes("DESIGN_3"));
  assert(!reviewPrompt.includes("DESIGN_2"));
});

test("Codex must account for every current finding; historical outputs remain readable", () => {
  const current = step("draft", 3);
  const plan = versions[2].document;
  validateFindingResponses(current, plan);
  for (const responses of [
    [],
    [plan.responses[0], plan.responses[0]],
    [{ ...plan.responses[0], findingId: "unknown" }],
    [{ findingId: "owner-check", response: "No action recorded." }],
  ])
    assert.throws(
      () => validateFindingResponses(current, { ...plan, responses }),
      /exactly once/,
    );
  assert.throws(() =>
    parsePlan({
      ...plan,
      responses: [{ ...plan.responses[0], action: "invalid" }],
    }),
  );
  const legacy = {
    ...current,
    input: { ...current.input, handoffVersion: undefined },
  };
  validateFindingResponses(legacy, { ...plan, responses: [] });
  assert.equal(parsePlan({ ...plan, responses: [] }).responses.length, 0);
  const reasoning = planningArtifact(versions[2], "reasoning")!;
  assert.match(reasoning.content, /owner-check — Not Accepted/);
  assert.match(reasoning.content, /EVIDENCE_3/);
  assert.equal(
    planningArtifact({ ...versions[2], review: null }, "claude_feedback"),
    null,
  );
});

test("older artifacts are preserved, readable by Claude and identical to downloads", async () => {
  const base = resolve("../../.tmp/planning-handoff/tests");
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(join(base, "workspace-"));
  try {
    const current = step("review", 3);
    const directory = await writePlanningArtifacts(workspace, current);
    for (const version of versions) {
      for (const kind of ["plan", "reasoning", "claude_feedback"] as const) {
        const artifact = planningArtifact(version, kind)!;
        assert.equal(
          await readFile(join(directory, artifact.name), "utf8"),
          artifact.content,
        );
      }
    }
    await writePlanningArtifacts(workspace, current);
    const hook = repositoryReadHook(workspace);
    const result = await hook(
      {
        hook_event_name: "PreToolUse",
        session_id: "test",
        transcript_path: "test",
        cwd: workspace,
        tool_use_id: "read-history",
        tool_name: "Read",
        tool_input: {
          file_path: join(directory, "plan_v1_claude_feedback.md"),
        },
      },
      undefined,
      { signal: new AbortController().signal },
    );
    assert("hookSpecificOutput" in result);
    assert.equal(
      result.hookSpecificOutput?.hookEventName === "PreToolUse" &&
        result.hookSpecificOutput.permissionDecision,
      "allow",
    );
    assert.match(
      await readFile(join(directory, "README.md"), "utf8"),
      /plan_v1_claude_feedback.md/,
    );
    await assert.rejects(
      writePlanningArtifacts(workspace, {
        ...current,
        input: {
          ...current.input,
          versions: [
            {
              ...versions[0],
              document: { ...versions[0].document, markdown: "Changed" },
            },
          ],
        },
      }),
      /Saved planning artifact changed/,
    );
    assert.match(
      await readFile(join(directory, "plan_v1.md"), "utf8"),
      /DESIGN_1/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
