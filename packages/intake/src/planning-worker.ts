import { dirname, join } from "node:path";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { listConfiguration, revealSecret } from "@code-assist/secrets";
import { runAgentProcess } from "./discovery-agent.ts";
import {
  assumePlanningRole,
  verifyPlanningIdentity,
  awsEvidenceContext,
  removePlanningAwsProfile,
} from "./planning-aws.ts";
import { readAwsSettings } from "./aws-settings.ts";
import { planningPrompt } from "./planning-agent.ts";
import {
  planningQueue,
  planSchema,
  reviewSchema,
  startPlanningStep,
  finishPlanningStep,
  failPlanningStep,
  restartPlanningStep,
  isCurrentPlanningStep,
  reconcilePlanningFailures,
  syncReadyPlanning,
} from "./planning.ts";

export async function registerPlanningWorker(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
) {
  await reconcilePlanningFailures(boss);
  await syncReadyPlanning(boss);
  await boss.work<{ stepId: string }>(planningQueue, async ([job]) => {
    if (shutdown.aborted) throw new Error("Worker is stopping.");
    const step = await startPlanningStep(boss, job.data.stepId, job.id);
    if (!step) return;
    const cancelled = new AbortController(),
      signal = AbortSignal.any([job.signal, shutdown, cancelled.signal]);
    const provider = step.kind === "draft" ? "codex" : "claude",
      secretName =
        provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    let log = createLogger(
      "planning",
      {},
      {
        attempt_id: step.id,
        job_id: job.id,
        ticket_id: step.input.discovery.ticket.identifier,
      },
    );
    const home = join(directory, "planning", step.run_id, step.id, "home");
    let pending = Promise.resolve();
    let stage = "configuration";
    try {
      const secret = listConfiguration(directory).secrets.find(
        (s) => s.name === secretName,
      );
      if (!secret) throw new Error(`Save ${secretName} in Secrets.`);
      const apiKey = revealSecret(directory, secret.id);
      const workspaceSecret =
        provider === "claude"
          ? listConfiguration(directory).secrets.find(
              (s) => s.name === "ANTHROPIC_WORKSPACE_ID",
            )
          : undefined;
      const anthropicWorkspaceId = workspaceSecret
        ? revealSecret(directory, workspaceSecret.id)
        : undefined;
      log = createLogger(
        "planning",
        { environment: { ...process.env, [secretName]: apiKey } },
        {
          attempt_id: step.id,
          job_id: job.id,
          ticket_id: step.input.discovery.ticket.identifier,
        },
      );
      const snapshots = step.input.discovery.snapshots;
      if (!snapshots?.length)
        throw new Error("Planning has no recorded source snapshots.");
      const awsSettings = readAwsSettings(directory);
      stage = "AWS staging connection";
      const aws = await assumePlanningRole(
        directory,
        "code-assist-" + step.id,
        signal,
        awsSettings,
      );
      if (aws) {
        log = createLogger(
          "planning",
          {
            environment: {
              ...process.env,
              [secretName]: apiKey,
              AWS_ACCESS_KEY_ID: aws.credentials.accessKeyId,
              AWS_SECRET_ACCESS_KEY: aws.credentials.secretAccessKey,
              AWS_SESSION_TOKEN: aws.credentials.sessionToken,
            },
          },
          {
            attempt_id: step.id,
            job_id: job.id,
            ticket_id: step.input.discovery.ticket.identifier,
          },
        );
        const identity = await verifyPlanningIdentity(aws, signal);
        log.event(
          "info",
          "planning.aws.connected",
          "AWS staging role assumed for this step",
          { ...awsEvidenceContext(aws), identity },
        );
      }
      const prompt = planningPrompt(step, aws);
      log.payload(
        "planning.input",
        `${provider} ${step.kind} for plan v${step.version}`,
        { input: step.input, prompt },
      );
      stage = `${provider} ${step.kind}`;
      const result = await runAgentProcess(
        {
          apiKey,
          provider,
          anthropicWorkspaceId,
          workspace: dirname(snapshots[0].directory),
          home,
          aws,
          prompt,
          outputSchema: step.kind === "draft" ? planSchema : reviewSchema,
        },
        signal,
        (event) => {
          log.payload(`${provider}.event`, event.type, event);
          pending = pending
            .then(async () => {
              const session = event.thread_id ?? event.session_id;
              if (session && !step.session_id) {
                await boss
                  .getDb()
                  .executeSql(
                    "UPDATE code_assist.planning_step SET session_id=$2 WHERE id=$1",
                    [step.id, session],
                  );
                step.session_id = session;
                log = log.child({ session_id: session });
              }
              if (!(await isCurrentPlanningStep(boss.getDb(), step)))
                cancelled.abort(new Error("Planning inputs were superseded."));
            })
            .catch((error) => cancelled.abort(error));
        },
      );
      await pending;
      signal.throwIfAborted();
      stage = "saving the planning checkpoint";
      log.payload(
        "planning.output",
        `${provider} completed plan v${step.version} ${step.kind}`,
        result,
      );
      if (await finishPlanningStep(boss, step, result))
        log.event(
          "info",
          "planning.completed",
          `Saved ${provider} ${step.kind} for plan v${step.version}`,
        );
    } catch (error) {
      await pending;
      if (shutdown.aborted) {
        await restartPlanningStep(boss, step);
        log.event(
          "info",
          "planning.interrupted",
          "Planning step queued for the next worker",
        );
        return;
      }
      if (!(await isCurrentPlanningStep(boss.getDb(), step))) {
        log.event(
          "info",
          "planning.superseded",
          "Obsolete planning result discarded",
        );
        return;
      }
      log.payload(
        "planning.failure",
        `Planning failed during ${stage}`,
        { error },
        "error",
      );
      const message = `Planning failed during ${stage}. Check the activity logs and retry this step.${stage === "configuration" ? ` Confirm ${secretName} is saved in Secrets.` : ""}`;
      await failPlanningStep(boss, step, message);
      // eslint-disable-next-line preserve-caught-error -- Raw provider errors may contain credentials; the redacted artifact retains diagnostics.
      throw new Error(message);
    } finally {
      await removePlanningAwsProfile(home);
    }
  });
}
