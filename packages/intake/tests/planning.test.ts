import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { repositoryReadHook } from "../src/planning-agent.ts";
import {
  parsePlan,
  parseReview,
  blockingFindings,
} from "../src/planning-types.ts";
import { attentionMessage } from "../src/worker.ts";

test("Claude native tool authorization confines evidence reads to repository snapshots", async () => {
  const base = resolve("../../.tmp/planning/tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "permissions-")),
    workspace = join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "source.ts"), "fixture");
  await writeFile(join(dir, "secret"), "synthetic");
  await symlink(join(dir, "secret"), join(workspace, "escape"));
  const hook = repositoryReadHook(workspace);
  async function decision(
    tool_name: string,
    tool_input: Record<string, unknown>,
  ) {
    const result = await hook(
      {
        hook_event_name: "PreToolUse",
        session_id: "fixture",
        transcript_path: "fixture",
        cwd: workspace,
        tool_use_id: "fixture",
        tool_name,
        tool_input,
      },
      undefined,
      { signal: new AbortController().signal },
    );
    assert("hookSpecificOutput" in result);
    return result.hookSpecificOutput?.hookEventName === "PreToolUse"
      ? result.hookSpecificOutput.permissionDecision
      : undefined;
  }
  try {
    assert.equal(await decision("Read", { file_path: "source.ts" }), "allow");
    assert.equal(await decision("Grep", { pattern: "fixture" }), "allow");
    assert.equal(await decision("Read", { file_path: "../secret" }), "deny");
    assert.equal(await decision("Read", { file_path: "escape" }), "deny");
    assert.equal(
      await decision("Grep", { path: dir, pattern: "synthetic" }),
      "deny",
    );
    assert.equal(await decision("Glob", { pattern: "../*" }), "deny");
    assert.equal(await decision("Glob", { pattern: join(dir, "*") }), "deny");
    assert.equal(await decision("Bash", { command: "pwd" }), "deny");
    assert.equal(
      await decision("Write", { file_path: "source.ts", content: "changed" }),
      "deny",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("structured plans and adversarial findings reject incomplete output", () => {
  assert.throws(() =>
    parsePlan({ markdown: "", changeSummary: "x", responses: [] }),
  );
  assert.throws(() =>
    parseReview({
      summary: "x",
      disposition: "needs_direction",
      directionQuestion: "",
      findings: [],
    }),
  );
  const finding = {
    id: "f1",
    severity: "high",
    title: "Owner",
    detail: "Check ownership",
    recommendation: "Authorize",
  };
  const review = {
    summary: "Reviewed",
    disposition: "ready",
    directionQuestion: "",
    findings: [finding],
  };
  assert.equal(blockingFindings(parseReview(review)).length, 1);
  assert.throws(() => parseReview({ ...review, findings: [finding, finding] }));
  assert.match(
    attentionMessage(
      "fixture",
      "ONE-FIXTURE",
      "Title",
      new Date(),
      "plan_ready",
    ),
    /explicitly accept/,
  );
  assert.match(
    attentionMessage(
      "fixture",
      "ONE-FIXTURE",
      "Title",
      new Date(),
      "planning_direction",
    ),
    /agents have paused/,
  );
});
