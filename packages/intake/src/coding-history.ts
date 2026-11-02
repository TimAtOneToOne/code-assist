import type { CodingRun, CodingStep } from "./coding-types.ts";

export function codingHistoryDirectory(step: CodingStep) {
  if (!/^[a-f0-9-]{36}$/.test(step.id))
    throw new Error("Invalid coding history step.");
  return `/work/evidence/coding-history/${step.id}`;
}

// Handoff decisions stay inline; complete execution records remain available on demand.
export function codingHistoryHandoff(
  run: CodingRun,
  step: CodingStep,
  history: CodingStep[],
) {
  const directory = codingHistoryDirectory(step);
  const prior = history.filter((s) => s.id !== step.id);
  const selected = new Set<string>();
  for (const [index] of (
    run.input.snapshots ?? [run.input.snapshot]
  ).entries()) {
    for (const kind of ["implement", "accept", "review", "validate"] as const) {
      const latest = prior.findLast(
        (s) =>
          (s.repository_index ?? 0) === index &&
          s.status === "completed" &&
          (kind === "validate"
            ? s.kind === kind
            : s.kind === "collect" && s.continuation?.kind === kind),
      );
      if (latest) selected.add(latest.id);
    }
    // Keep failures that have not yet reached a later successful handoff visible.
    const latest = prior.findLast((s) => (s.repository_index ?? 0) === index);
    if (latest?.error) selected.add(latest.id);
  }
  const current = prior
    .filter((s) => selected.has(s.id))
    .map((s) => {
      const { tools, evidence, browserCalls, ...result } = s.result ?? {};
      void tools;
      void evidence;
      void browserCalls;
      if (result.sourceChanges && typeof result.sourceChanges === "object") {
        const { diff, ...changes } = result.sourceChanges as Record<
          string,
          unknown
        >;
        void diff;
        result.sourceChanges = {
          ...changes,
          diffFile: `${directory}/${s.id}.json`,
        };
      }
      return {
        id: s.id,
        kind: s.continuation?.kind ?? s.kind,
        repositoryIndex: s.repository_index ?? 0,
        commit: s.input_commit,
        error: s.error,
        result,
        fullRecord: `${directory}/${s.id}.json`,
      };
    });
  return `Current Coding Handoff:\n${JSON.stringify(current)}\n\nComplete coding history: ${directory}/README.md. All earlier step results, checkpoint continuations, command results, findings, source diffs and tool references are preserved there in individual JSON files. Read the indexed records when investigating a specific prior decision or failure; do not load the entire archive by default. Historical records are diagnostic context, not fresh acceptance evidence. Current owner requests and replies remain authoritative. If current findings require detail not shown inline, read their full record before acting.`;
}

export async function writeCodingHistory(
  step: CodingStep,
  history: CodingStep[],
  root: (args: string[], input?: string) => Promise<unknown>,
) {
  const directory = codingHistoryDirectory(step);
  const files = history
    .filter((s) => s.id !== step.id)
    .map((s) => {
      if (!/^[a-f0-9-]{36}$/.test(s.id))
        throw new Error("Invalid archived coding step.");
      return {
        name: `${s.id}.json`,
        content: JSON.stringify(s, null, 2) + "\n",
      };
    });
  files.push({
    name: "README.md",
    content:
      "# Coding History\n\nFull records for this attempt’s handoff. These are historical evidence, not additional requirements or proof of current acceptance. Current owner instructions take precedence.\n\n" +
      history
        .filter((s) => s.id !== step.id)
        .map(
          (s) =>
            `- [${s.kind} · ${s.status} · repository ${s.repository_index ?? 0} · ${s.id}](${s.id}.json)`,
        )
        .join("\n") +
      "\n",
  });
  await root(
    [
      "node",
      "--input-type=module",
      "-e",
      `import {readFileSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs'; const {directory,files}=JSON.parse(readFileSync(0,'utf8')); mkdirSync(directory,{recursive:true,mode:0o755}); for(const f of files){ const path=directory+'/'+f.name; writeFileSync(path,f.content,{mode:0o444}); chmodSync(path,0o444); }`,
    ],
    JSON.stringify({ directory, files }),
  );
}
