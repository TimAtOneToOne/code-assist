import assert from "node:assert/strict";
import { test } from "node:test";
import { rm } from "node:fs/promises";
import { acceptanceReady, assessAcceptance } from "../src/acceptance.ts";
import {
  parseAcceptanceResult,
  type AcceptanceScenario,
  type AcceptanceResult,
  type ToolEvidence,
} from "../src/acceptance-types.ts";
import { parsePlan, planMarkdown } from "../src/planning-types.ts";
import { publicationReady } from "../src/coding-repositories.ts";
import { parseReceipt } from "../src/coding-receipt.ts";
import { toolEvidenceCollector } from "../src/tool-evidence.ts";
import { cleanupFixture } from "./fixtures/cleanup.ts";
import type { CodingStep } from "../src/coding-types.ts";
const scenario: AcceptanceScenario = {
  id: "api-rejection",
  title: "Reject Invalid Input",
  repositories: ["fixture"],
  method: "command",
  procedure:
    "Exercise local API with invalid input and assert status and stored data.",
  expectedOutcome: "422 response and no database mutation",
};
const tools: ToolEvidence[] = [
  { id: "item_1", name: "node test-api.mjs", kind: "command", succeeded: true },
];
const result: AcceptanceResult = {
  summary: "API contract verified",
  scenarios: [
    {
      id: scenario.id,
      status: "passed",
      observed: "Invalid input returned 422; row count unchanged.",
      toolCallIds: ["item_1"],
      artifacts: [],
    },
  ],
};
test("acceptance is repository scoped, supports non-UI work and preserves historical plans", () => {
  const legacy = {
    markdown: "# Change",
    changeSummary: "Contract validation",
    responses: [],
  };
  assert.equal(planMarkdown(legacy), legacy.markdown);
  const plan = { ...legacy, acceptanceScenarios: [scenario] };
  assert.deepEqual(parsePlan(plan, ["fixture"]), plan);
  assert.match(planMarkdown(plan), /422 response/);
  for (const value of [
    [],
    [scenario, scenario],
    [{ ...scenario, method: "guess" }],
    [{ ...scenario, repositories: ["other"] }],
    [{ ...scenario, expectedOutcome: " " }],
  ])
    assert.throws(() =>
      parsePlan({ ...plan, acceptanceScenarios: value }, ["fixture"]),
    );
  assert.throws(() =>
    parseAcceptanceResult({
      ...result,
      scenarios: [result.scenarios[0], result.scenarios[0]],
    }),
  );
});
test("missing, failed, unrelated and stale tool evidence cannot satisfy acceptance", async () => {
  const { directory, run } = await cleanupFixture();
  try {
    run.plan.acceptanceScenarios = [scenario];
    assert(assessAcceptance(run, "attempt", result, tools).passed);
    assert.equal(assessAcceptance(run, "attempt", null, tools).passed, false);
    const cases: AcceptanceResult[] = [
      { ...result, scenarios: [] },
      {
        ...result,
        scenarios: [{ ...result.scenarios[0], toolCallIds: ["invented"] }],
      },
      { ...result, scenarios: [{ ...result.scenarios[0], status: "failed" }] },
      { ...result, scenarios: [{ ...result.scenarios[0], status: "blocked" }] },
      {
        ...result,
        scenarios: [
          {
            ...result.scenarios[0],
            artifacts: ["/work/evidence/old/proof.json"],
          },
        ],
      },
      {
        ...result,
        scenarios: [
          {
            ...result.scenarios[0],
            artifacts: ["/work/evidence/attempt/../old/proof.json"],
          },
        ],
      },
      {
        ...result,
        scenarios: [{ ...result.scenarios[0], id: "outside-plan" }],
      },
      {
        ...result,
        scenarios: [
          { ...result.scenarios[0], toolCallIds: ["item_1", "failed"] },
        ],
      },
    ];
    for (const value of cases)
      assert.equal(
        assessAcceptance(run, "attempt", value, [
          ...tools,
          { ...tools[0], id: "failed", succeeded: false },
        ]).passed,
        false,
      );
    run.plan.acceptanceScenarios = [{ ...scenario, method: "browser" }];
    assert.equal(assessAcceptance(run, "attempt", result, tools).passed, false);
    assert.equal(
      assessAcceptance(run, "attempt", result, [
        { ...tools[0], kind: "browser", name: "browser_navigate" },
      ]).passed,
      false,
    );
    assert(
      assessAcceptance(run, "attempt", result, [
        { ...tools[0], kind: "browser", name: "browser_run_code" },
      ]).passed,
    );
    run.plan.acceptanceScenarios = [
      {
        ...scenario,
        method: "inspection",
        expectedOutcome: "Configuration routes only the intended requests",
      },
    ];
    assert(assessAcceptance(run, "attempt", result, tools).passed);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("publication requires current complete acceptance before independent review for the whole commit set", async () => {
  const { directory, run, steps } = await cleanupFixture();
  try {
    assert(publicationReady(run, steps));
    run.plan.acceptanceScenarios = [scenario];
    run.input.planHash = "approved";
    assert.equal(publicationReady(run, steps), false);
    const collect = {
      ...steps[0],
      id: "collect",
      kind: "collect",
      continuation: {
        kind: "accept",
        agentStepId: "attempt",
        result,
        browserCalls: [],
        tools,
      },
      result: assessAcceptance(run, "attempt", result, tools),
    } as unknown as CodingStep;
    const attempt: CodingStep = { ...steps[0], id: "attempt", kind: "accept" };
    const complete = [steps[0], steps[1], attempt, collect, steps[2]];
    assert(acceptanceReady(run, complete));
    assert(publicationReady(run, complete));
    assert.equal(
      acceptanceReady(run, [
        ...complete,
        { ...attempt, id: "new-attempt", status: "failed" },
      ]),
      false,
    );
    assert.equal(acceptanceReady(run, [...complete, steps[1]]), false);
    assert.equal(publicationReady(run, [...steps, attempt, collect]), false);
    for (const patch of [
      { planHash: "older" },
      { attemptId: "older" },
      { commits: { fixture: "different" } },
    ]) {
      assert.equal(
        acceptanceReady(run, [
          attempt,
          { ...collect, result: { ...collect.result, ...patch } },
        ]),
        false,
      );
    }
    assert.equal(
      acceptanceReady(
        { ...run, direction_responses: [{ id: "new" }] as never },
        complete,
      ),
      false,
    );
    assert.equal(
      acceptanceReady(
        { ...run, change_requests: [{ id: "new" }] as never },
        complete,
      ),
      false,
    );
    run.repositories = [
      { name: "fixture", commit: run.commit },
      { name: "service", commit: "service-v1" },
    ] as typeof run.repositories;
    collect.result = assessAcceptance(run, "attempt", result, tools);
    assert(acceptanceReady(run, [attempt, collect]));
    run.repositories![1].commit = "service-v2";
    assert.equal(acceptanceReady(run, [attempt, collect]), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("native SDK tool evidence records completed calls and survives receipt recovery", () => {
  const collector = toolEvidenceCollector();
  collector.observe({
    type: "item.started",
    item: { id: "pending", type: "command_execution", command: "test" },
  });
  collector.observe({
    type: "item.completed",
    item: {
      id: "ok",
      type: "command_execution",
      command: "test",
      exit_code: 0,
      status: "completed",
    },
  });
  collector.observe({
    type: "item.completed",
    item: {
      id: "failed",
      type: "command_execution",
      command: "test",
      exit_code: 1,
      status: "failed",
    },
  });
  collector.observe({
    type: "item.completed",
    item: {
      id: "browser",
      type: "mcp_tool_call",
      server: "playwright",
      tool: "browser_snapshot",
      status: "completed",
    },
  });
  collector.observe({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "claude",
          name: "mcp__playwright__browser_run_code",
        },
        { type: "tool_use", id: "read", name: "Read" },
      ],
    },
  });
  assert.equal(collector.completed.length, 3);
  collector.observe({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "claude", is_error: true },
        { type: "tool_result", tool_use_id: "read", is_error: false },
      ],
    },
  });
  assert.deepEqual(
    collector.completed.map((t) => [t.id, t.succeeded]),
    [
      ["ok", true],
      ["failed", false],
      ["browser", true],
      ["claude", false],
      ["read", true],
    ],
  );
  assert.deepEqual(
    parseReceipt(
      JSON.stringify({ result, browserCalls: [], tools: collector.completed }),
    ).tools,
    collector.completed,
  );
  assert.throws(() =>
    parseReceipt(
      JSON.stringify({ result, browserCalls: [], tools: [{ id: "fake" }] }),
    ),
  );
});
