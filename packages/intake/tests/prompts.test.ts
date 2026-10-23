import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  isPromptScope,
  readPromptSettings,
  writePromptSetting,
} from "../src/prompt-settings.ts";
import {
  composeInstructions,
  privateWorkflowInstructions,
  promptText,
  type PromptSettings,
} from "../src/prompt-defaults.ts";
import { discoveryPrompt } from "../src/discovery-agent.ts";
import { planningPrompt } from "../src/planning-agent.ts";
import type { DiscoveryRun } from "../src/discovery.ts";
import type { PlanningStep } from "../src/planning-types.ts";

test("prompt edits persist independently, blank overrides are deliberate, and reset restores defaults", async () => {
  const base = resolve("../../.tmp/prompts/tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "settings-"));
  try {
    const initial = readPromptSettings(dir);
    assert.match(promptText(initial, "global"), /Status and Evidence/);
    assert(promptText(initial, "global").includes(privateWorkflowInstructions));
    writePromptSetting(dir, "global", "Operator's global instructions");
    writePromptSetting(dir, "planning", "Planning guidance");
    writePromptSetting(dir, "coding", "Coding guidance", "/repos/api");
    writePromptSetting(dir, "global", "");
    const saved = readPromptSettings(dir);
    assert.equal(promptText(saved, "global"), "");
    assert.equal(promptText(saved, "planning"), "Planning guidance");
    assert.equal(promptText(saved, "coding", "/repos/api"), "Coding guidance");
    assert.equal((await stat(join(dir, "prompts.json"))).mode & 0o777, 0o600);
    assert.throws(() => writePromptSetting(dir, "draft", "x", "/repos/api"));
    assert.throws(() => writePromptSetting(dir, "global", "x", "../api"));
    assert.equal(isPromptScope("__proto__"), false);
    writePromptSetting(dir, "global", null);
    writePromptSetting(dir, "coding", null, "/repos/api");
    const reset = readPromptSettings(dir);
    assert.match(promptText(reset, "global"), /Title Case/);
    assert.equal(promptText(reset, "planning"), "Planning guidance");
    assert.deepEqual(reset.repositories, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const settings: PromptSettings = {
  prompts: {
    global: "GLOBAL_GUIDANCE",
    planning: "PLANNING_GUIDANCE",
    coding: "CODING_GUIDANCE",
    discovery: "DISCOVERY_TASK",
    draft: "DRAFT_TASK",
    review: "REVIEW_TASK",
  },
  repositories: {
    "/repos/api": {
      global: "API_GLOBAL",
      planning: "API_PLANNING",
      coding: "API_CODING",
    },
    "/repos/ui": { planning: "UI_PLANNING" },
    "/repos/unselected": { global: "UNSELECTED_GUIDANCE" },
  },
};
const snapshots = ["api", "ui"].map((name) => ({
  name,
  source: `/repos/${name}`,
  directory: `/snapshots/${name}`,
  commit: "a".repeat(40),
}));

test("multi-repository prompts use source paths, include both selected scopes, and exclude other phases/repos", () => {
  const planning = composeInstructions(
    settings,
    "planning",
    "review",
    snapshots,
  );
  for (const expected of [
    "GLOBAL_GUIDANCE",
    "PLANNING_GUIDANCE",
    "REVIEW_TASK",
    'Repository Instructions for "api"',
    "API_GLOBAL",
    "API_PLANNING",
    'Repository Instructions for "ui"',
    "UI_PLANNING",
  ])
    assert(planning.includes(expected), expected);
  for (const excluded of [
    "UNSELECTED_GUIDANCE",
    "CODING_GUIDANCE",
    "API_CODING",
    "DRAFT_TASK",
  ])
    assert(!planning.includes(excluded), excluded);
  const coding = composeInstructions(settings, "coding", null, snapshots);
  assert(coding.includes("CODING_GUIDANCE"));
  assert(coding.includes("API_CODING"));
  assert(!coding.includes("PLANNING_GUIDANCE"));
});

test("discovery, Codex drafts and Claude reviews receive configured prompts while retaining runtime context and permissions", () => {
  const discovery = {
    ticket: { identifier: "ONE-123", description: "Full ticket evidence" },
    snapshots,
  } as DiscoveryRun;
  const step = {
    kind: "draft",
    version: 3,
    input: { discovery, versions: [], feedback: [] },
  } as unknown as PlanningStep;
  const initial = discoveryPrompt(
    discovery,
    snapshots,
    ["Saved answer"],
    settings,
  );
  assert.match(initial, /DISCOVERY_TASK/);
  assert.match(initial, /API_PLANNING/);
  assert.match(initial, /Saved answer/);
  assert.match(initial, /Do not write a plan, change code/);
  const draft = planningPrompt(step, undefined, settings);
  assert.match(draft, /DRAFT_TASK/);
  assert.doesNotMatch(draft, /REVIEW_TASK/);
  const review = planningPrompt(
    { ...step, kind: "review" },
    undefined,
    settings,
  );
  assert.match(review, /REVIEW_TASK/);
  assert.doesNotMatch(review, /DRAFT_TASK/);
  for (const prompt of [initial, draft, review]) {
    assert.match(prompt, /GLOBAL_GUIDANCE/);
    assert.match(prompt, /PLANNING_GUIDANCE/);
    assert.match(prompt, /Full ticket evidence/);
    assert.doesNotMatch(prompt, /UNSELECTED_GUIDANCE/);
  }
  for (const prompt of [draft, review]) {
    assert.match(prompt, /Do not edit files/);
    assert.match(prompt, /not human approval/);
    assert.match(prompt, /plan v3/);
  }
  assert.match(planningPrompt(step), /Status and Evidence/);
  assert.match(discoveryPrompt(discovery, snapshots, []), /Title Case/);
  assert(planningPrompt(step).includes(privateWorkflowInstructions));
  assert(
    discoveryPrompt(discovery, snapshots, []).includes(
      privateWorkflowInstructions,
    ),
  );
});
