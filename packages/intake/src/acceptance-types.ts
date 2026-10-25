export type AcceptanceScenario = {
  id: string;
  title: string;
  repositories: string[];
  method: "browser" | "command" | "inspection";
  procedure: string;
  expectedOutcome: string;
};
export type ToolEvidence = {
  id: string;
  name: string;
  kind: "browser" | "command" | "inspection";
  succeeded: boolean;
};
export type AcceptanceResult = {
  summary: string;
  scenarios: {
    id: string;
    status: "passed" | "failed" | "blocked";
    observed: string;
    toolCallIds: string[];
    artifacts: string[];
  }[];
};
export type AcceptanceReport = AcceptanceResult & {
  attemptId: string;
  planHash: string;
  commits: Record<string, string | null>;
  tools: ToolEvidence[];
  issues: string[];
  passed: boolean;
};
export const acceptanceScenariosSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "repositories",
      "method",
      "procedure",
      "expectedOutcome",
    ],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      repositories: { type: "array", minItems: 1, items: { type: "string" } },
      method: { type: "string", enum: ["browser", "command", "inspection"] },
      procedure: { type: "string" },
      expectedOutcome: { type: "string" },
    },
  },
};
export const acceptanceResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "scenarios"],
  properties: {
    summary: { type: "string" },
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "observed", "toolCallIds", "artifacts"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["passed", "failed", "blocked"] },
          observed: { type: "string" },
          toolCallIds: { type: "array", items: { type: "string" } },
          artifacts: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
export function validAcceptanceScenarios(
  value: unknown,
  repositories?: string[],
): value is AcceptanceScenario[] {
  if (!Array.isArray(value) || !value.length) return false;
  return (
    value.every(
      (s) =>
        s &&
        [s.id, s.title, s.procedure, s.expectedOutcome].every(
          (v) => typeof v === "string" && v.trim(),
        ) &&
        ["browser", "command", "inspection"].includes(s.method) &&
        Array.isArray(s.repositories) &&
        s.repositories.length &&
        s.repositories.every(
          (r: unknown) =>
            typeof r === "string" &&
            r.trim() &&
            (!repositories || repositories.includes(r)),
        ),
    ) && new Set(value.map((s) => s.id)).size === value.length
  );
}
export function parseAcceptanceResult(value: unknown): AcceptanceResult {
  const r = value as AcceptanceResult;
  if (
    !r ||
    typeof r.summary !== "string" ||
    !r.summary.trim() ||
    !Array.isArray(r.scenarios) ||
    r.scenarios.some(
      (s) =>
        !s ||
        typeof s.id !== "string" ||
        !s.id.trim() ||
        !["passed", "failed", "blocked"].includes(s.status) ||
        typeof s.observed !== "string" ||
        !s.observed.trim() ||
        !Array.isArray(s.toolCallIds) ||
        !s.toolCallIds.every((v) => typeof v === "string" && v.trim()) ||
        !Array.isArray(s.artifacts) ||
        !s.artifacts.every((v) => typeof v === "string" && v.trim()),
    ) ||
    new Set(r.scenarios.map((s) => s.id)).size !== r.scenarios.length
  )
    throw new Error("Invalid acceptance result.");
  return r;
}
