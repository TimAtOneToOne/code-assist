import assert from "node:assert/strict";
import { test } from "node:test";
import { codeReviewReady, parseImplementation } from "../src/coding-types.ts";
import type { PlanReview } from "../src/planning-types.ts";
test("code review cannot pass unresolved medium, high or critical concerns", () => {
  const review: PlanReview = {
    summary: "Reviewed",
    disposition: "ready",
    directionQuestion: "",
    findings: [],
  };
  assert(codeReviewReady(review));
  for (const severity of ["low", "medium", "high", "critical"] as const) {
    review.findings = [
      {
        id: "a",
        severity,
        title: "Issue",
        detail: "Evidence",
        recommendation: "Fix",
      },
    ];
    assert.equal(codeReviewReady(review), severity === "low");
  }
  review.findings = [];
  review.disposition = "needs_direction";
  assert.equal(codeReviewReady(review), false);
});
test("implementation must report material blockers explicitly", () => {
  assert.throws(() =>
    parseImplementation({
      summary: "Work",
      disposition: "needs_direction",
      directionQuestion: "",
      browserEvidence: [],
    }),
  );
  assert.equal(
    parseImplementation({
      summary: "Work",
      disposition: "needs_direction",
      directionQuestion: "Which behavior?",
      browserEvidence: [],
    }).disposition,
    "needs_direction",
  );
});
