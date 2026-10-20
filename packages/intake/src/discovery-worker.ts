import { readPromptSettings } from "./prompt-settings.ts";
import { readModelSettings } from "./model-settings.ts";
import { dirname, join } from "node:path";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { findSecretByName, revealSecret } from "@code-assist/secrets";
import { discoverRepositories } from "./repositories.ts";
import {
  discoveryQueue,
  startDiscovery,
  finishDiscovery,
  isCurrentDiscovery,
  reconcileDiscoveryFailures,
  syncSelectedDiscoveries,
  restartInterruptedDiscovery,
} from "./discovery.ts";
import {
  discoveryPrompt,
  runAgentProcess,
  snapshotRepositories,
} from "./discovery-agent.ts";

export async function registerDiscoveryWorker(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
) {
  await reconcileDiscoveryFailures(boss);
  await syncSelectedDiscoveries(boss);
  await boss.work<{ runId: string }>(discoveryQueue, async ([job]) => {
    if (shutdown.aborted) throw new Error("Worker is stopping.");
    const run = await startDiscovery(boss, job.data.runId, job.id);
    if (!run) return;
    const cancelled = new AbortController();
    const signal = AbortSignal.any([job.signal, shutdown, cancelled.signal]);
    let stage = "configuration";
    let log = createLogger(
      "discovery",
      {},
      { attempt_id: run.id, job_id: job.id, ticket_id: run.ticket.identifier },
    );
    let pending = Promise.resolve();
    try {
      const model = readModelSettings(directory).codex;
      const secret = findSecretByName(directory, "OPENAI_API_KEY");
      if (!secret)
        throw new Error(
          "Save OPENAI_API_KEY in Secrets before running discovery.",
        );
      const apiKey = revealSecret(directory, secret.id);
      log = createLogger(
        "discovery",
        { environment: { ...process.env, OPENAI_API_KEY: apiKey } },
        {
          attempt_id: run.id,
          job_id: job.id,
          ticket_id: run.ticket.identifier,
        },
      );
      log.event(
        "info",
        "discovery.started",
        "Codex is inspecting the ticket and selected repositories",
        { model },
      );
      stage = "repository snapshots";
      const available = await discoverRepositories(directory);
      if (
        run.repositories.some(
          (path) => !available.some((repo) => repo.path === path),
        )
      )
        throw new Error(
          "A selected repository is no longer in the configured clone folder.",
        );
      const prepared = run.snapshots
        ? {
            snapshots: run.snapshots,
            workspace: dirname(run.snapshots[0].directory),
          }
        : await snapshotRepositories(directory, run, signal);
      run.snapshots = prepared.snapshots;
      await boss
        .getDb()
        .executeSql(
          "UPDATE code_assist.discovery_run SET snapshots=$2 WHERE id=$1",
          [run.id, JSON.stringify(run.snapshots)],
        );
      const { rows: priorAnswers } = await boss
        .getDb()
        .executeSql(
          "SELECT ticket->>'updatedAt' AS ticket_updated_at,repositories,result,answers,notes FROM code_assist.discovery_run WHERE issue_id=$1 AND answers IS NOT NULL ORDER BY created_at",
          [run.issue_id],
        );
      const prompt = discoveryPrompt(
        run,
        run.snapshots,
        priorAnswers,
        readPromptSettings(directory),
      );
      log.payload(
        "discovery.input",
        "Discovery ticket, repository commits and prompt",
        { ticket: run.ticket, snapshots: run.snapshots, prompt, model },
      );
      stage = "Codex investigation";
      const result = await runAgentProcess(
        {
          apiKey,
          model,
          workspace: prepared.workspace,
          home: join(directory, "discovery", run.id, "home"),
          prompt,
        },
        signal,
        (event) => {
          log.payload("codex.event", event.type, event);
          pending = pending
            .then(async () => {
              if (event.type === "thread.started" && event.thread_id) {
                await boss
                  .getDb()
                  .executeSql(
                    "UPDATE code_assist.discovery_run SET thread_id=$2 WHERE id=$1",
                    [run.id, event.thread_id],
                  );
                log = log.child({ session_id: event.thread_id });
              }
              if (!(await isCurrentDiscovery(boss.getDb(), run)))
                cancelled.abort(new Error("Discovery inputs were superseded."));
            })
            .catch((error) => {
              cancelled.abort(error);
            });
        },
      );
      await pending;
      signal.throwIfAborted();
      stage = "saving questions";
      if (await finishDiscovery(boss, run, result))
        log.event(
          "info",
          "discovery.questions",
          "Initial discovery is ready for scope confirmation",
          { question_count: result.questions.length },
        );
    } catch (error) {
      await pending;
      if (shutdown.aborted) {
        await restartInterruptedDiscovery(boss, run);
        log.event(
          "info",
          "discovery.interrupted",
          "Discovery checkpoint queued for the next worker",
        );
        return;
      }
      if (!(await isCurrentDiscovery(boss.getDb(), run))) {
        log.event(
          "info",
          "discovery.superseded",
          "Inputs changed; old discovery result discarded",
        );
        return;
      }
      log.payload(
        "discovery.failure",
        `Discovery failed during ${stage}`,
        { error },
        "error",
      );
      await finishDiscovery(
        boss,
        run,
        null,
        `Initial discovery failed during ${stage}. Check the discovery logs and retry. ${stage === "configuration" ? "Confirm OPENAI_API_KEY is saved in Secrets." : ""}`,
      );
      // eslint-disable-next-line preserve-caught-error -- Raw SDK failures can contain credentials; the redacted artifact retains diagnostics.
      throw new Error(
        `Discovery failed during ${stage}. See the discovery log.`,
      );
    }
  });
}
