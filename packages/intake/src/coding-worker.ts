import { readFile } from "node:fs/promises";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { artifactPath } from "@code-assist/observability/artifacts";
import {
  listConfiguration,
  revealSecret,
  resolveRepositoryEnvironment,
} from "@code-assist/secrets";
import { readModelSettings } from "./model-settings.ts";
import {
  prepareWorkspace,
  readWorkspace,
  type Workspace,
} from "./workspace.ts";
import { parseReview, reviewSchema } from "./planning-types.ts";
import {
  codingQueue,
  codingRun,
  currentCoding,
  startCoding,
  finishCoding,
  failCoding,
  syncApprovedCoding,
  readCoding,
  implementationSchema,
  parseImplementation,
  codeReviewReady,
  type CodingStep,
} from "./coding.ts";
import {
  setupCodingRuntime,
  guestCommands,
  checkpoint,
  codingPrompt,
  runGuestAgent,
  preserveEvidence,
  validation,
  stopCodingUnit,
} from "./coding-runtime.ts";
import { publishCoding } from "./coding-publish.ts";
export async function reconcileCodingFailures(boss: PgBoss) {
  const { rows } = await boss
    .getDb()
    .executeSql(
      "SELECT s.* FROM code_assist.coding_step s JOIN code_assist.coding_run r ON r.current_step_id=s.id WHERE s.status IN ('running','queued') AND r.status NOT IN ('failed','superseded','pr_open','needs_direction')",
    );
  for (const step of rows as CodingStep[]) {
    const job = await boss.getJobById(codingQueue, step.job_id);
    let dead = false;
    if (step.worker_pid && step.status === "running")
      try {
        process.kill(step.worker_pid, 0);
      } catch (error) {
        dead = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    if (
      dead ||
      !job ||
      ["failed", "cancelled", "completed"].includes(job.state)
    ) {
      const run = await codingRun(boss.getDb(), step.run_id);
      if (run.workspace_id && process.env.CODE_ASSIST_DATA_DIR)
        await stopCodingUnit(
          await readWorkspace(
            process.env.CODE_ASSIST_DATA_DIR,
            run.workspace_id,
          ),
          step.id,
          createLogger("coding"),
        );
      if (dead && job?.state === "active")
        await boss.fail(codingQueue, step.job_id);
      await failCoding(
        boss,
        run,
        step,
        "Coding was interrupted or its job expired. Completed checkpoints are preserved. Review the logs and retry.",
      );
    }
  }
}
export async function registerCodingWorker(
  boss: PgBoss,
  directory: string,
  shutdown: AbortSignal,
) {
  await reconcileCodingFailures(boss);
  await syncApprovedCoding(boss);
  await boss.work<{ stepId: string }>(codingQueue, async ([job]) => {
    if (shutdown.aborted) throw new Error("Worker is stopping.");
    const started = await startCoding(boss, job.data.stepId, job.id);
    if (!started) return;
    const { run, step } = started,
      cancelled = new AbortController(),
      signal = AbortSignal.any([job.signal, shutdown, cancelled.signal]);
    let pending = Promise.resolve(),
      workspace: Workspace | undefined,
      stage = step.kind as string;
    const mapped = resolveRepositoryEnvironment(
      directory,
      run.input.snapshot.source,
    );
    let log = createLogger(
      "coding",
      { environment: { ...process.env, ...mapped } },
      {
        attempt_id: step.id,
        ticket_id: run.identifier,
        job_id: job.id,
        repository_commit: step.input_commit ?? run.input.snapshot.commit,
      },
    );
    const assertCurrent = async () => {
      signal.throwIfAborted();
      if (!(await currentCoding(boss.getDb(), run, step)))
        throw new Error(
          "The approved scope or current coding attempt changed.",
        );
    };
    try {
      await assertCurrent();
      if (step.kind === "prepare") {
        workspace = await prepareWorkspace(
          directory,
          boss.getDb(),
          run.issue_id,
          signal,
          async (w) => {
            workspace = w;
            await boss
              .getDb()
              .executeSql(
                "UPDATE code_assist.coding_run SET workspace_id=$2 WHERE id=$1 AND current_step_id=$3",
                [run.id, w.id, step.id],
              );
          },
        );
        stage = "installing coding runtime";
        const commit = await setupCodingRuntime(
          directory,
          run,
          workspace,
          signal,
          log,
        );
        await finishCoding(
          boss,
          run,
          step,
          {
            summary:
              "Isolated workspace, agent SDKs and Playwright MCP prepared.",
            workspaceId: workspace.id,
          },
          "implement",
          commit,
          workspace.id,
        );
        return;
      }
      if (!run.workspace_id) throw new Error("Coding workspace is missing.");
      workspace = await readWorkspace(directory, run.workspace_id);
      const commands = guestCommands(workspace, signal, log);
      let environmentText = "";
      await commands.guest(
        ["cat", "/work/environment.json"],
        undefined,
        (line) => {
          environmentText += line;
        },
      );
      const environment = JSON.parse(environmentText) as Record<string, string>;
      log = createLogger(
        "coding",
        { environment: { ...process.env, ...environment } },
        {
          attempt_id: step.id,
          ticket_id: run.identifier,
          job_id: job.id,
          repository_commit: step.input_commit ?? undefined,
        },
      );
      if (step.kind === "implement") {
        // Only this attempt's disposable worktree is reset; completed checkpoints live in the host bare repository.
        await commands.git("reset", "--hard", step.input_commit!);
      }
      if (step.kind === "implement" || step.kind === "review") {
        const provider = step.kind === "implement" ? "codex" : "claude",
          name = provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
        const saved = listConfiguration(directory).secrets,
          secret = saved.find((s) => s.name === name);
        if (!secret) throw new Error(`Save ${name} in Secrets.`);
        const apiKey = revealSecret(directory, secret.id),
          workspaceSecret = saved.find(
            (s) => s.name === "ANTHROPIC_WORKSPACE_ID",
          );
        log = createLogger(
          "coding",
          { environment: { ...process.env, ...environment, [name]: apiKey } },
          {
            attempt_id: step.id,
            ticket_id: run.identifier,
            job_id: job.id,
            repository_commit: step.input_commit ?? undefined,
          },
        );
        const model = readModelSettings(directory)[provider],
          history = (await readCoding(boss.getDb(), run.issue_id)).find(
            (r) => r.id === run.id,
          )!.steps;
        const prompt = await codingPrompt(directory, run, step, history);
        log.payload("coding.input", `${provider} ${step.kind}`, {
          model,
          prompt,
          commit: step.input_commit,
        });
        const { result: value, browserCalls } = await runGuestAgent(
          workspace,
          step,
          {
            id: step.id,
            provider,
            apiKey,
            model,
            prompt,
            schema:
              step.kind === "implement" ? implementationSchema : reviewSchema,
            anthropicWorkspaceId: workspaceSecret
              ? revealSecret(directory, workspaceSecret.id)
              : undefined,
          },
          signal,
          log,
          () => {
            pending = pending
              .then(assertCurrent)
              .catch((error) => cancelled.abort(error));
          },
        );
        await pending;
        await assertCurrent();
        const reference = log.payload(
          "coding.output",
          `${provider} completed`,
          value,
        );
        const safe = JSON.parse(
          await readFile(
            artifactPath(
              process.env.CODE_ASSIST_ARTIFACT_DIR!,
              reference.artifact_id,
            ),
            "utf8",
          ),
        );
        const evidence = await preserveEvidence(
          directory,
          run,
          step,
          workspace,
          signal,
          log,
        );
        if (step.kind === "implement") {
          const result = parseImplementation(safe);
          if (result.disposition === "needs_direction") {
            await finishCoding(
              boss,
              run,
              step,
              { ...result, evidence },
              "needs_direction",
            );
            return;
          }
          if (
            !result.browserEvidence.length ||
            !browserCalls.some(
              (tool) =>
                tool === "browser_navigate" || tool === "browser_run_code",
            )
          )
            throw new Error(
              "The implementation did not supply browser evidence.",
            );
          for (const path of result.browserEvidence) {
            if (
              !path.startsWith("/work/evidence/") ||
              path.split("/").includes("..")
            )
              throw new Error(
                "Browser evidence must be saved under /work/evidence.",
              );
            await commands.guest(["test", "-f", path]);
          }
          const commit = await checkpoint(
            directory,
            run,
            step,
            workspace,
            signal,
            log,
          );
          await finishCoding(
            boss,
            run,
            step,
            { ...result, evidence, commit, browserCalls },
            "validate",
            commit,
          );
        } else {
          const result = parseReview(safe);
          if (
            (await commands.git("rev-parse", "HEAD")) !== run.commit ||
            (await commands.git("status", "--porcelain"))
          )
            throw new Error(
              "Review changed the code; validation and review must be repeated.",
            );
          await finishCoding(
            boss,
            run,
            step,
            { ...result, evidence, commit: run.commit },
            result.disposition === "needs_direction"
              ? "needs_direction"
              : codeReviewReady(result)
                ? "publish"
                : "implement",
          );
        }
      } else if (step.kind === "validate") {
        const result = await validation(
          directory,
          run,
          step,
          workspace,
          signal,
          log,
        );
        await assertCurrent();
        await finishCoding(
          boss,
          run,
          step,
          result,
          result.passed ? "review" : "implement",
        );
      } else {
        const history = (await readCoding(boss.getDb(), run.issue_id)).find(
          (r) => r.id === run.id,
        )!.steps;
        const review = history.findLast(
            (s) => s.kind === "review" && s.status === "completed",
          ),
          validated = history.findLast(
            (s) => s.kind === "validate" && s.status === "completed",
          );
        if (
          review?.input_commit !== run.commit ||
          validated?.input_commit !== run.commit ||
          !validated.result?.passed ||
          !codeReviewReady(parseReview(review?.result))
        )
          throw new Error(
            "Publication requires passing validation and review of this exact commit.",
          );
        const url = await publishCoding(
          directory,
          run,
          signal,
          log,
          assertCurrent,
        );
        await finishCoding(
          boss,
          run,
          step,
          {
            summary: "Pull request opened for Tim to review.",
            url,
            commit: run.commit,
          },
          "pr_open",
          undefined,
          undefined,
          url,
        );
      }
    } catch (error) {
      await pending;
      if (workspace) await stopCodingUnit(workspace, step.id, log);
      log.payload(
        "coding.failure",
        `Coding failed during ${stage}`,
        { error },
        "error",
      );
      await failCoding(
        boss,
        run,
        step,
        shutdown.aborted
          ? "Coding was interrupted by a worker update. The completed checkpoint is saved; retry to continue."
          : `Coding failed during ${stage}. Inspect this step's logs and retry after resolving the cause.`,
      );
      // eslint-disable-next-line preserve-caught-error -- Detailed failure is retained only in the redacted artifact.
      throw new Error(`Coding failed during ${stage}.`);
    }
  });
}
