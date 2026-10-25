import type { CodingRun, CodingStep } from "./coding-types.ts";
import { commitSet } from "./coding-repositories.ts";
import { planMarkdown } from "./planning-types.ts";
import { readWorkspace } from "./workspace.ts";
import { repositorySetupContext } from "./repository-settings.ts";
import { composeInstructions } from "./prompt-defaults.ts";
import { readPromptSettings } from "./prompt-settings.ts";

export async function acceptancePrompt(
  directory: string,
  run: CodingRun,
  step: CodingStep,
  history: unknown,
) {
  const workspace = await readWorkspace(directory, run.workspace_id!);
  const origin = step.recovery_step_id ?? step.id;
  return `You are Codex verifying acceptance for ${run.identifier}: ${run.title} after controller command validation. This is a verification attempt, not implementation. Do not edit tracked source, commit, switch branches, publish, merge, deploy, or change external systems. Run only the approved scenarios against the saved candidates and authorized local/synthetic fixtures. If prerequisites, credentials, services or authorized evidence are missing, report blocked with the concrete reason. Never turn inspection or a mock into a claim about a deployed production system.
Plan identity: ${run.input.planHash}. Candidate commits (all repositories): ${JSON.stringify(commitSet(run))}.
Repository commands MUST use node /work/run.mjs --repo <name> <command> [args], which loads the pinned working directory/environment. Saved setup/startup/readiness instructions: ${JSON.stringify(Object.fromEntries(Object.entries(workspace.profiles ?? {}).map(([name, p]) => [name, repositorySetupContext(p.configuration)])))}.
Run every approved scenario. Browser scenarios use native Playwright MCP against this guest's application. Start/restart the appropriate local test application from the candidate source using the repository's instructions so a previous process or build cannot stand in for current code; verify readiness. Command and API scenarios run the repository's own tests/tools with meaningful assertions; inspection scenarios read actual source/configuration and explain what that establishes. A browser navigation alone does not prove a behavior. Do not change tests or implementation to force a pass. Preserve legitimate test-generated local data outside tracked source.
Save any screenshots and other files under /work/evidence/${origin}/. Playwright's output directory is that directory. Do not cite files or tool calls from earlier attempts. The runtime records completed native tool calls in /work/evidence/${origin}/tool-events.json. Read that journal AFTER performing the checks to obtain the exact tool IDs for your result; inspect full tool outputs as needed in /work/logs/artifacts. Do not edit this journal. For every scenario return its approved ID, passed/failed/blocked status, concrete observed result, supporting toolCallIds from this attempt and any artifact paths. Include failures and blocked outcomes honestly. For passed scenarios cite successful supporting calls; rerun any failed supporting command before claiming proof. For negative cases, use a successful assertion command that checks the expected error/status rather than treating the failing tool invocation itself as a passing assertion. A successful tool invocation alone does not establish the expected outcome; compare actual assertions/observations to the plan.
${composeInstructions(readPromptSettings(directory), "coding", null, run.input.snapshots ?? [run.input.snapshot])}
Approved plan:\n${planMarkdown(run.plan)}
Prior steps and requests (history is diagnostic context, not fresh acceptance evidence):\n${JSON.stringify({ history, requests: run.change_requests, replies: run.direction_responses })}`;
}
