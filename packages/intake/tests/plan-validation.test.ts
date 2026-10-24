import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePlan,
  planMarkdown,
  type PlanDocument,
} from "../src/planning-types.ts";
import {
  additionalValidationCommands,
  assertPlanValidationResults,
  planValidationScripts,
} from "../src/plan-validation.ts";

const legacy: PlanDocument = {
  markdown: "# Feature",
  changeSummary: "Add tests",
  responses: [],
};
test("legacy plans retain their checks; additional checks are scoped to selected repositories", () => {
  assert.deepEqual(planValidationScripts(legacy, ["web"], "web"), []);
  assert.equal(planMarkdown(legacy), legacy.markdown);
  const plan = {
    ...legacy,
    additionalValidation: [
      { repository: "web", script: "npm test" },
      { repository: "api", script: "make test" },
      { repository: "web", script: "npm run test:browser" },
    ],
  };
  assert.deepEqual(planValidationScripts(plan, ["web", "api"], "web"), [
    "npm test",
    "npm run test:browser",
  ]);
  assert.deepEqual(planValidationScripts(plan, ["web", "api"], "api"), [
    "make test",
  ]);
  assert.throws(
    () => planValidationScripts(plan, ["web"], "web"),
    /invalid plan/,
  );
  assert.throws(
    () => planValidationScripts(legacy, ["web"], "unknown"),
    /outside/,
  );
});
test("malformed executable plan fields cannot become approved commands", () => {
  for (const value of [
    null,
    {},
    [null],
    [{ repository: "web", script: " " }],
    [{ repository: "web", script: "echo\0bad" }],
    [{ repository: "missing", script: "npm test" }],
  ]) {
    assert.throws(() =>
      parsePlan({ ...legacy, additionalValidation: value }, ["web"]),
    );
  }
});
test("plan review, comparison and downloads include exact executable scripts", () => {
  const script = "printf '%s' '``` literal'\nnpm test";
  const rendered = planMarkdown({
    ...legacy,
    additionalValidation: [{ repository: "web", script }],
  });
  assert.match(rendered, /Additional Controller Validation/);
  assert(rendered.includes("````bash\n" + script + "\n````"));
  assert.match(
    planMarkdown({ ...legacy, additionalValidation: [] }),
    /pinned checks still run/,
  );
});
test("each approved command needs its own exit result, including duplicate scripts", () => {
  const scripts = ["npm test", "npm test"];
  const commands = additionalValidationCommands(scripts);
  assert.deepEqual(
    commands.map((c) => c.args),
    [
      ["bash", "-euc", "npm test"],
      ["bash", "-euc", "npm test"],
    ],
  );
  const results = { [commands[0].task]: 1, [commands[1].task]: 0 };
  assert.doesNotThrow(() => assertPlanValidationResults(scripts, results));
  assert.equal(
    Object.values(results).every((code) => code === 0),
    false,
  );
  assert.throws(
    () => assertPlanValidationResults(scripts, { [commands[1].task]: 0 }),
    /Missing result/,
  );
  assert.throws(
    () => assertPlanValidationResults(scripts, {}),
    /Missing result/,
  );
  assert.throws(
    () =>
      assertPlanValidationResults(["npm test"], { [commands[0].task]: NaN }),
    /Missing result/,
  );
});
