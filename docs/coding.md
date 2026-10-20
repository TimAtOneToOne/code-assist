# Coding Workflow

Approved plans enter the `approved-coding` pg-boss queue. Repository setup profiles currently cover `internal-chat-ui`, `elation_companion`, and `workplace-agents`. An unsupported repository produces a visible preparation failure rather than silently leaving an approved plan idle.

## Lifecycle

Each run is bound to the approved plan version, plan hash, requirements hash and source commit. Each step has a separate ID, job, input commit, result and logs. The stages are workspace preparation, Codex implementation, repository validation, Claude adversarial review and controller-owned GitHub publication. Findings of critical, high or medium severity return to implementation; a material decision pauses for Tim. There is no review-round budget or provider fallback.

The ticket page shows these steps, summaries, findings, validation results and log links. Failed steps have a Retry action and a deliberate Use Branch and Retry form when a fresh branch is needed. A publication already in flight must be reconciled before its branch can change. A changed ticket, removed Plan label, changed repository selection or revised plan prevents obsolete attempts from advancing. A revised approved plan starts a separate run; previously used branches are not silently reused.

Linear's `updatedAt` timestamp alone does not change discovery inputs. PR integrations can update that timestamp without changing the ticket's content. Intake compares saved ticket content and repository selections, including for runs created before this correction; existing approval hashes remain unchanged.

## Execution and Evidence

Each ticket run uses one isolated OrbStack workspace with a private container engine and repository-owned local services. Candidate checkouts live together at `/work/<repository>`, allowing paired acceptance tests. Repository commands run through `/work/run.mjs --repo <repository>`, which loads only the repository's mapped and attempt-owned environment. The source is restored from the approved commit into an independent Git repository. Synced clones are read-only inputs. Provider credentials arrive through stdin, not command arguments or the controller's environment. GitHub and notification credentials are not copied into the guest.

New steps ensure the guest runtime matches the deployed worker release, including its frozen SDK dependencies. Running steps keep their existing runtime.

Both SDKs use Agent Models settings at the start of each step. Global, coding and repository-specific prompt settings apply to implementation and review. The guest has its own official Playwright MCP server, browser profile and Chromium installation. Its localhost points to its own app. The repository's locked Playwright browser is installed separately for its tests.

SDK events, tool results and validation output enter central Logs under service `coding`, ticket and step ID. A redacted mirror lives in `/work/logs/structured/coding.jsonl`, with full payloads in `/work/logs/artifacts`, allowing agents to inspect their own failures without credentials to other tickets' logs. Application/test screenshots and other evidence live under `/work/evidence`. The host retains evidence archives in `data/coding/<run>/<step>-evidence.tar.gz`. Logs and saved step results are redacted using the provider key and the attempt environment before persistence.

Codex implements repositories sequentially in confirmed repository order. The controller saves each checkpoint in its own bare repository, validates it, then advances to the next repository. ICU runs `pnpm lint/check/test/build`; Companion runs its existing `bash ./build.sh`; Workplace Agents runs root `make validate`. Agents must also execute the approved plan’s acceptance tests. Intermediate repositories can defer paired browser acceptance until the final candidate exists; the final implementation must supply real browser evidence.

Claude then reviews the complete candidate set, including cross-repository behavior. Unresolved critical/high/medium findings restart a sequential revision pass; all candidate commits must have passing validation and the combined review before publication. No repository is published after only its individual validation. Checkpoint sets are captured on each step, so changing either candidate invalidates publication evidence. Source changes in other checkouts during implementation, or any checkout during review/validation, fail the step.

Multi-repository checkpoints and publication intents live under `data/coding/<run>/<repository>/`; legacy single-repository paths remain readable. PR publication proceeds one repository per durable job. Each successful PR URL is persisted before advancing, and retries reconcile the current repository’s saved intent instead of republishing the previous repository. The detail page shows ordered repository progress and every PR.

## Recovery and Publication

Guest agents and validation run in named systemd units with process-group ownership. Cancellation stops the owned unit, including SDK, shell and browser descendants. A worker interruption leaves a visible failure and completed checkpoints; Retry restores the last completed input commit. Failed/preparing workspaces are retained for diagnosis, with their IDs in the workspace manifests. They are not automatically deleted. The queue currently inherits pg-boss's default 15-minute step expiration; an expired step becomes a visible failure rather than silently retrying. Longer execution policy remains to be decided if a real step exceeds it.

Publication runs from Mia's login-session worker, where the operator's GitHub keychain identity is available. SSH sessions cannot necessarily access that keychain. The controller requires passing validation and code review for the exact commit, inspects all existing PR states and the remote branch, checks compatibility with the current default branch, and records publication intent before writing. A new branch is pushed with an expected-absent ref lease. On an uncertain retry, an existing branch/PR must match the saved intent and exact commit. Unexpected changes, closed/merged branches and merge conflicts require attention. Agents never merge, enable auto-merge or deploy the managed application.

## GitHub PR and Main Workflow Tracking

The existing `github-pr-refresh` pg-boss queue checks published, unfinished coding runs every five minutes, independently of Linear intake. The worker uses Mia’s login-session GitHub CLI credentials. Home’s **Refresh GitHub** queues a check of unfinished runs; the ticket button checks a specific run, including completed work. Use **Refresh** to reload the observed result.

Each repository retains its own PR, merge commit, workflow runs and observation timestamp. A multi-repository ticket reaches Done only when every repository satisfies the completion rule. A merge saves the PR’s merge commit and time. **Done** requires the PR to have merged into `main`, at least one matching workflow, and success for every observed GitHub Actions run with `event=push`, `head_branch=main`, and that exact merge SHA. This is repository-independent: PR checks, manual workflows, unrelated commits, and separate production promotions cannot satisfy the rule. No matching run means **Waiting for Main Workflow**; pending runs mean **Main Workflows Running**. Non-success terminal conclusions, including cancelled or skipped workflows, mean **Main Workflow Failed**. Done and active states are green; failures and closed-unmerged PRs are yellow. The detail page links each workflow and shows its attempt and outcome.

All pages of matching workflow runs are read through the GitHub REST API. The workflow’s reported conclusion is the completion evidence; Code Assist does not independently verify application health or require a repository-specific deployment job. A later matching run cannot be anticipated: Done reflects all runs observed at that check. Completed runs can be explicitly refreshed. Previous merge-only Done records are reopened for a workflow check on upgrade.

GitHub read failures preserve the previous state and show an error. If workflow metadata is available but failure logs are unavailable, the failure remains visible and repair waits for diagnostic evidence. Scheduled/manual refresh reads again. Observations are ordered by check start time so delayed responses cannot overwrite newer evidence. Events and central Logs (`service=github`) retain the transitions; failures, completion and closed-unmerged PRs use the existing Teams flow. Observation never changes Linear state or grants new plan approval.

On Home, tickets remain in the main list for 24 hours after their latest transition to Done. Older completed tickets appear in the collapsed **Completed** section at the bottom, with the same links and green badges. This uses the current coding run’s saved completion event, not the PR merge time or last GitHub check. Refreshing Home updates the grouping; reopened or corrective work returns to the main list.

## Corrective Coding After a Failed Main Workflow

For a still-current approved plan, a failed main workflow captures the complete failed-job logs and the attempt-specific job list in a redacted central artifact. A separate coding run retains the original plan approval, parent run, merge commit, workflow IDs and attempts. Repeated observations of that failure do not create duplicate coding jobs. A changed failure attempt or observed recovery supersedes unpublished stale repair work; existing published corrective PRs remain for Tim to review.

The new run provisions its own isolated OrbStack workspace from the failed merge commit, which already contains the feature. Git objects are fetched into the run’s private bare repository; synced clones and old workspaces are preserved. The controller verifies that this base remains in main’s history. Agents read full evidence at `/work/evidence/main-workflow-failure.json` and use the existing central logging and Playwright MCP integration. Codex diagnoses and repairs only defects within the approved feature/repository. Missing credentials, transient/environmental incidents, shared CI/IAM changes, or expanded scope require a concrete diagnosis and Tim’s direction.

A justified code fix follows the same implementation → lint/type checks/tests/build → Claude review loop. It opens a fresh `feature/<ticket>-main-fix-<run-id>` branch and corrective PR, preserving the merged PR and never reusing its branch. Tim merges; agents do not dispatch deployment workflows or deploy. The corrective PR must merge and its own main workflows must succeed before the current ticket shows Done. Old failures remain visible as history. Removed or superseded approvals still permit observation, but do not authorize automatic repair.

For multi-repository runs, repair targets one failed repository at a time while retaining the other candidate checkouts and their PR outcomes. Combined review still covers the pair. A new corrective PR replaces only the failed repository’s completion requirement; every other repository must also complete. Workspaces and evidence remain on disk for deliberate operator cleanup. PR feedback handling and automatic rebase/revalidation remain unimplemented.

GitHub fields use [gh pr view](https://cli.github.com/manual/gh_pr_view), [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), and [workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

Optional optimizations and controls: none. Approval fencing, commit-bound validation/review, process ownership and expected-head publication are required workflow integrity checks.

## Verification — October 20, 2026

The full project verification and four PostgreSQL integration suites pass. Both actual selected SDK models completed a guest-local Playwright MCP interaction and screenshot, then read the workspace log mirror through native tools. The deployed ticket page rendered without browser errors. Initial execution exposed and fixed missing Codex home setup and over-redaction of LocalStack's public `test` credentials. Those literals are excluded only from the workspace logger's credential set; real provider and repository secrets remain redacted.

The real ONE-4767 run completed implementation, lint, type checks, tests, build, browser acceptance checks and Claude review, then opened internal-chat-ui PR #125 at `73765025ef864eb3732e1725d85d3700eafca770`. Tim explicitly authorized deleting the previous remote branch before reusing `feature/one-4767`. Claude returned no findings on its first review, so this run did not exercise the implementation revision loop. A PostgreSQL regression test verifies that a subsequent timestamp-only Linear update preserves the approved plan, discovery ID and `pr_open` dashboard status.

The main-workflow extension passes the full project checks and four PostgreSQL integration suites. The database fixture exercises merge-without-runs, pending and failed runs, unavailable logs, duplicate observations, stale-response rejection, recovery fencing, a corrective PR with a Claude-requested revision, and completion only after that corrective merge's workflows succeed. A read-only Git/source probe fetched and archived PR #125’s exact merged commit for a corrective workspace. Automatic repair is verified with fixtures; no live deployment failure was manufactured to run the agents.

The sequential coding extension passes a PostgreSQL integration fixture covering per-repository checkpoint handoff, combined-review commit binding, interrupted second publication and retry, all-repository completion, scoped corrective work, and recovery fencing. Live ONE-5190 execution is recorded separately in the ticket’s step history.
