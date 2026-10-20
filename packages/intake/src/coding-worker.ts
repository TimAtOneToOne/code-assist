import {
  snapshots,
  repositories,
  repositoryIndex,
  repositoryRun,
  activeSnapshot,
  codingIndexes,
  publicationReady,
} from "./coding-repositories.ts";
import { workspaceLogEnvironment } from "./workspace-environment.ts";
import { readFile } from "node:fs/promises";
import type { PgBoss } from "pg-boss";
import { createLogger } from "@code-assist/observability";
import { artifactPath } from "@code-assist/observability/artifacts";
import {
  findSecretByName,
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
  prepareCodingSource,
  ensureCodingRuntime,
  guestCommands,
  checkpoint,
  codingPrompt,
  runGuestAgent,
  preserveEvidence,
  validation,
  stopCodingUnit,
} from "./coding-runtime.ts";
import {
  publishCoding,
  checkCodingBranch,
  CodingBranchConflict,
} from "./coding-publish.ts";
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
    const startedAt = performance.now();
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
      activeSnapshot(run).source,
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
        const sources = [];
        for (const index of snapshots(run.input).keys()) {
          const current = repositoryRun(run, index);
          if (codingIndexes(run).includes(index))
            await checkCodingBranch(current, signal, log);
          sources.push(
            await prepareCodingSource(directory, current, signal, log),
          );
        }
        await assertCurrent();
        workspace = await prepareWorkspace(
          directory,
          boss.getDb(),
          run.issue_id,
          signal,
          async (w) => {
            workspace = w;
            log.event(
              "info",
              "coding.workspace",
              "Workspace preparation started",
              { workspace_id: w.id },
            );
            await boss
              .getDb()
              .executeSql(
                "UPDATE code_assist.coding_run SET workspace_id=$2 WHERE id=$1 AND current_step_id=$3",
                [run.id, w.id, step.id],
              );
          },
          sources,
        );
        stage = "installing coding runtime";
        const states = repositories(run).map((r) => ({ ...r }));
        for (const index of snapshots(run.input).keys()) {
          states[index].commit = await setupCodingRuntime(
            directory,
            repositoryRun(run, index),
            workspace,
            signal,
            log,
          );
        }
        const commit = states[repositoryIndex(run)].commit!;
        if (run.repair) {
          const artifacts = process.env.CODE_ASSIST_ARTIFACT_DIR;
          if (!artifacts || !run.repair.workflows.failureArtifact)
            throw new Error("Main failure evidence is missing.");
          const evidence = await readFile(
            artifactPath(artifacts, run.repair.workflows.failureArtifact),
            "utf8",
          );
          await guestCommands(workspace, signal, log).guest(
            ["bash", "-c", "cat > /work/evidence/main-workflow-failure.json"],
            evidence,
          );
        }
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
          undefined,
          run.repositories
            ? { repositories: states, index: repositoryIndex(run) }
            : undefined,
        );
        return;
      }
      if (!run.workspace_id) throw new Error("Coding workspace is missing.");
      workspace = await readWorkspace(directory, run.workspace_id);
      await ensureCodingRuntime(directory, run, workspace, signal, log);
      const commands = guestCommands(
        workspace,
        signal,
        log,
        activeSnapshot(run).name,
      );
      const environment: Record<string, string> = {};
      for (const snapshot of snapshots(run.input)) {
        let environmentText = "";
        await commands.guest(
          [
            "cat",
            workspace.environments
              ? "/work/environments/" + snapshot.name + ".json"
              : "/work/environment.json",
          ],
          undefined,
          (line) => {
            environmentText += line;
          },
        );
        for (const [key, value] of Object.entries(JSON.parse(environmentText)))
          environment[snapshot.name + "_" + key] = String(value);
      }
      const unchanged = async (except?: number) => {
        for (const [index, state] of repositories(run).entries()) {
          if (index === except) continue;
          const git = guestCommands(workspace!, signal, log, state.name).git;
          if (
            (await git("rev-parse", "HEAD")) !== state.commit ||
            (await git("status", "--porcelain"))
          )
            throw new Error(
              "Unexpected changes in " +
                state.name +
                "; validation and review must use the saved candidate commits.",
            );
        }
      };
      const progress = (
        index = repositoryIndex(run),
        commit?: string,
        status?: typeof run.status,
        url?: string,
      ) => {
        if (!run.repositories) return undefined;
        const states = repositories(run).map((r) => ({ ...r }));
        const active = states[repositoryIndex(run)];
        if (commit) active.commit = commit;
        if (status) active.status = status;
        if (url) active.pr_url = url;
        return { repositories: states, index };
      };
      log = createLogger(
        "coding",
        {
          environment: workspaceLogEnvironment({
            ...process.env,
            ...environment,
          }),
        },
        {
          attempt_id: step.id,
          ticket_id: run.identifier,
          job_id: job.id,
          repository_commit: step.input_commit ?? undefined,
        },
      );
      if (step.kind === "implement") {
        await checkCodingBranch(run, signal, log);
        if ((await commands.git("branch", "--show-current")) !== run.branch)
          await commands.git("checkout", "-b", run.branch, step.input_commit!);
        // Only this attempt's disposable worktree is reset; completed checkpoints live in the host bare repository.
        await commands.git("reset", "--hard", step.input_commit!);
      }
      if (step.kind === "implement" || step.kind === "review") {
        const provider = step.kind === "implement" ? "codex" : "claude",
          name = provider === "codex" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
        const secret = findSecretByName(directory, name);
        if (!secret) throw new Error(`Save ${name} in Secrets.`);
        const apiKey = revealSecret(directory, secret.id),
          workspaceSecret = findSecretByName(
            directory,
            "ANTHROPIC_WORKSPACE_ID",
          );
        log = createLogger(
          "coding",
          {
            environment: workspaceLogEnvironment({
              ...process.env,
              ...environment,
              [name]: apiKey,
            }),
          },
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
            repository: activeSnapshot(run).name,
            repositories: snapshots(run.input).map((s) => s.name),
            environments: workspace.environments,
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
            repositoryIndex(run) === codingIndexes(run).at(-1) &&
            (!result.browserEvidence.length ||
              !browserCalls.some(
                (tool) =>
                  tool === "browser_navigate" || tool === "browser_run_code",
              ))
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
          await unchanged(repositoryIndex(run));
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
            undefined,
            undefined,
            progress(repositoryIndex(run), commit, "validate"),
          );
        } else {
          const result = parseReview(safe);
          await unchanged();
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
            undefined,
            undefined,
            undefined,
            progress(codingIndexes(run)[0]),
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
        await unchanged();
        const indexes = codingIndexes(run);
        const following = indexes[indexes.indexOf(repositoryIndex(run)) + 1];
        await finishCoding(
          boss,
          run,
          step,
          result,
          result.passed
            ? following === undefined
              ? "review"
              : "implement"
            : "implement",
          undefined,
          undefined,
          undefined,
          progress(
            result.passed
              ? (following ?? repositoryIndex(run))
              : repositoryIndex(run),
            undefined,
            result.passed ? "review" : "implement",
          ),
        );
      } else {
        const history = (await readCoding(boss.getDb(), run.issue_id)).find(
          (r) => r.id === run.id,
        )!.steps;
        const review = history.findLast(
          (s) => s.kind === "review" && s.status === "completed",
        );
        if (
          !publicationReady(run, history) ||
          !codeReviewReady(parseReview(review?.result))
        )
          throw new Error(
            "Publication requires passing validation and review of this exact commit.",
          );
        await unchanged();
        const url = await publishCoding(
          directory,
          run,
          signal,
          log,
          assertCurrent,
        );
        const indexes = codingIndexes(run);
        const following = indexes[indexes.indexOf(repositoryIndex(run)) + 1];
        await finishCoding(
          boss,
          run,
          step,
          {
            summary: "Pull request opened for Tim to review.",
            url,
            commit: run.commit,
          },
          following === undefined ? "pr_open" : "publish",
          undefined,
          undefined,
          run.pr_url ?? url,
          progress(
            following ?? repositoryIndex(run),
            undefined,
            "pr_open",
            url,
          ),
        );
      }
    } catch (error) {
      const timedOut =
        job.signal.aborted &&
        !shutdown.aborted &&
        !cancelled.signal.aborted &&
        performance.now() - startedAt >= job.expireInSeconds * 1000;
      const message =
        error instanceof CodingBranchConflict
          ? error.message
          : shutdown.aborted
            ? "Coding was interrupted by a worker update. The completed checkpoint is saved; retry to continue."
            : timedOut
              ? `Coding timed out after ${job.expireInSeconds / 60} minutes during ${stage}. Completed checkpoints are preserved; retry to continue.`
              : `Coding failed during ${stage}. Inspect this step's logs and retry after resolving the cause.`;
      await pending;
      if (workspace) await stopCodingUnit(workspace, step.id, log);
      log.payload("coding.failure", message, { error }, "error");
      await failCoding(boss, run, step, message);
      // eslint-disable-next-line preserve-caught-error -- Detailed failure is retained only in the redacted artifact.
      throw new Error(message);
    }
  });
}
