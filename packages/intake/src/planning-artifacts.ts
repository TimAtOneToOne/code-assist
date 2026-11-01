import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findingActions,
  planMarkdown,
  type PlanDocument,
  type PlanVersion,
  type PlanningStep,
} from "./planning-types.ts";

export type PlanningArtifactKind = "plan" | "reasoning" | "claude_feedback";

export function planningArtifact(
  version: PlanVersion,
  kind: PlanningArtifactKind,
) {
  const prefix = `plan_v${version.number}`;
  if (kind === "plan")
    return { name: `${prefix}.md`, content: planMarkdown(version.document) };
  if (kind === "reasoning")
    return {
      name: `${prefix}_reasoning.md`,
      content: `# Codex Reasoning for Plan v${version.number}\n\n## Changes\n\n${version.document.changeSummary}\n\n## Responses to Claude's Feedback${version.number > 1 ? ` on v${version.number - 1}` : ""}\n\n${
        version.document.responses.length
          ? version.document.responses
              .map(
                (r) =>
                  `### ${r.findingId}${r.action ? ` — ${findingActions[r.action]}` : ""}\n\n${r.response}`,
              )
              .join("\n\n")
          : "No individual finding responses were recorded."
      }\n`,
    };
  const review = version.review;
  if (!review) return null;
  return {
    name: `${prefix}_claude_feedback.md`,
    content: `# Claude Feedback on Plan v${version.number}\n\nDisposition: ${review.disposition}\n\n## Summary\n\n${review.summary}\n\n## Unresolved Findings\n\n${
      review.findings.length
        ? review.findings
            .map(
              (f) =>
                `### ${f.id}: ${f.title}\n\nSeverity: ${f.severity}\n\n${f.detail}\n\nRecommendation: ${f.recommendation}`,
            )
            .join("\n\n")
        : "No unresolved findings."
    }${review.directionQuestion ? `\n\n## Direction Needed\n\n${review.directionQuestion}` : ""}\n`,
  };
}

export function planningHandoff(step: PlanningStep) {
  const current = step.input.versions.find(
    (v) =>
      v.number === (step.kind === "draft" ? step.version - 1 : step.version),
  );
  const reviewed = step.input.versions.find(
    (v) => v.number === step.version - 1,
  );
  return [
    ...(current
      ? [
          planningArtifact(current, "plan"),
          ...(current.number > 1
            ? [planningArtifact(current, "reasoning")]
            : []),
        ]
      : []),
    ...(reviewed ? [planningArtifact(reviewed, "claude_feedback")] : []),
  ].filter((artifact) => artifact !== null);
}

export function validateFindingResponses(
  step: PlanningStep,
  plan: PlanDocument,
) {
  // Steps already in flight retain their original output contract.
  if (step.input.handoffVersion !== 1) return;
  const findings =
    step.input.versions.find((v) => v.number === step.version - 1)?.review
      ?.findings ?? [];
  const ids = new Set(plan.responses.map((r) => r.findingId));
  if (
    ids.size !== plan.responses.length ||
    ids.size !== findings.length ||
    findings.some((f) => !ids.has(f.id)) ||
    plan.responses.some((r) => !r.action)
  )
    throw new Error(
      "Codex must respond exactly once to each finding in the previous review, with an action and rationale.",
    );
}

export async function writePlanningArtifacts(
  workspace: string,
  step: PlanningStep,
) {
  const directory = join(workspace, ".planning", step.run_id, step.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const artifacts = step.input.versions.flatMap((version) =>
    (["plan", "reasoning", "claude_feedback"] as const)
      .map((kind) => planningArtifact(version, kind))
      .filter((artifact) => artifact !== null),
  );
  artifacts.push({
    name: "README.md",
    content: `# Planning History\n\nThese documents are preserved history, not additional current requirements. The current handoff names the documents for this pass. Read older documents only to investigate a specific decision or disagreement. Tim's saved direction remains authoritative.\n\n${artifacts.map((a) => `- [${a.name}](${a.name})`).join("\n")}\n`,
  });
  for (const artifact of artifacts) {
    const path = join(directory, artifact.name);
    try {
      await writeFile(path, artifact.content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await readFile(path, "utf8")) !== artifact.content)
        throw new Error(`Saved planning artifact changed: ${artifact.name}`, {
          cause: error,
        });
    }
  }
  return directory;
}
