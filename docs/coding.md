# Coding Workflow

Approved single-repository ICU plans enter the `approved-coding` pg-boss queue. The initial implementation supports `internal-chat-ui`; other repository setups and coordinated multi-repository execution still need implementation.

## Lifecycle

Each run is bound to the approved plan version, plan hash, requirements hash and source commit. Each step has a separate ID, job, input commit, result and logs. The stages are workspace preparation, Codex implementation, repository validation, Claude adversarial review and controller-owned GitHub publication. Findings of critical, high or medium severity return to implementation; a material decision pauses for Tim. There is no review-round budget or provider fallback.

The ticket page shows these steps, summaries, findings, validation results and log links. Failed steps have a Retry action and a deliberate Use Branch and Retry form when a fresh branch is needed. A publication already in flight must be reconciled before its branch can change. A changed ticket, removed Plan label, changed repository selection or revised plan prevents obsolete attempts from advancing. A revised approved plan starts a separate run; previously used branches are not silently reused.

Linear's `updatedAt` timestamp alone does not change discovery inputs. PR integrations can update that timestamp without changing the ticket's content. Intake compares saved ticket content and repository selections, including for runs created before this correction; existing approval hashes remain unchanged.

## Execution and Evidence

Each run uses the existing isolated OrbStack ICU workspace with its own Docker Engine, PostgreSQL and LocalStack. Repository commands run through `/work/run.mjs`, which loads only the repository's mapped and attempt-owned environment. The source is restored from the approved commit into an independent Git repository. Synced clones are read-only inputs. Provider credentials arrive through stdin, not command arguments or the controller's environment. GitHub and notification credentials are not copied into the guest.

New steps ensure the guest runtime matches the deployed worker release, including its frozen SDK dependencies. Running steps keep their existing runtime.

Both SDKs use Agent Models settings at the start of each step. Global, coding and repository-specific prompt settings apply to implementation and review. The guest has its own official Playwright MCP server, browser profile and Chromium installation. Its localhost points to its own app. The repository's locked Playwright browser is installed separately for its tests.

SDK events, tool results and validation output enter central Logs under service `coding`, ticket and step ID. A redacted mirror lives in `/work/logs/structured/coding.jsonl`, with full payloads in `/work/logs/artifacts`, allowing agents to inspect their own failures without credentials to other tickets' logs. Application/test screenshots and other evidence live under `/work/evidence`. The host retains evidence archives in `data/coding/<run>/<step>-evidence.tar.gz`. Logs and saved step results are redacted using the provider key and the attempt environment before persistence.

Codex returns an implementation result and browser evidence paths. The controller records a Git commit and saves its objects in `data/coding/<run>/repository.git` before accepting completion. It independently runs `pnpm lint`, `pnpm check`, `pnpm test` and `pnpm build`. Failed checks return to Codex with their detailed logs. Claude reviews the exact validated commit; source changes during validation or review invalidate that step.

## Recovery and Publication

Guest agents and validation run in named systemd units with process-group ownership. Cancellation stops the owned unit, including SDK, shell and browser descendants. A worker interruption leaves a visible failure and completed checkpoints; Retry restores the last completed input commit. Failed/preparing workspaces are retained for diagnosis, with their IDs in the workspace manifests. They are not automatically deleted. The queue currently inherits pg-boss's default 15-minute step expiration; an expired step becomes a visible failure rather than silently retrying. Longer execution policy remains to be decided if a real step exceeds it.

Publication runs from Mia's login-session worker, where the operator's GitHub keychain identity is available. SSH sessions cannot necessarily access that keychain. The controller requires passing validation and code review for the exact commit, inspects all existing PR states and the remote branch, checks compatibility with the current default branch, and records publication intent before writing. A new branch is pushed with an expected-absent ref lease. On an uncertain retry, an existing branch/PR must match the saved intent and exact commit. Unexpected changes, closed/merged branches and merge conflicts require attention. Agents never merge, enable auto-merge or deploy the managed application.

## GitHub PR Tracking

The `github-pr-refresh` pg-boss queue checks published, unmerged PRs every five minutes, independently of Linear intake. The worker uses the same login-session GitHub CLI credentials as publication. Home's **Refresh GitHub** queues a check of tracked unmerged PRs; the ticket's button checks that specific PR, including completed work. Use **Refresh** to reload the observed result. No inbound webhook or new token is needed.

GitHub `MERGED` marks the coding run **Done** and stores the merge commit and merge time. `CLOSED` shows **Closed Without Merge** in yellow; a reopened PR returns to **Pull Request Open**. Done is green, as are active workflow states; its label distinguishes completion from work in progress. State changes are recorded in ticket history and central Logs (`service=github`); merge and closure transitions use the existing Teams notification flow. Repeated observations do not create duplicate transition notifications.

Failed GitHub reads preserve the previous state and show a check error on the ticket. A later scheduled check or manual refresh tries again. Observations are ordered by check start time, so a delayed response cannot overwrite a newer result. Existing exact-version approvals and coding evidence are unchanged. The observer also checks published PRs whose original planning scope is no longer current; observation never reauthorizes coding or changes Linear state.

**Done means merged, not successfully deployed.** Deployment workflow tracking, PR feedback handling and automated rebase/revalidation are not implemented. Workspaces and evidence remain on disk after PR publication; operators can use the workspace CLI for deliberate cleanup.

GitHub fields use the supported [`gh pr view --json` interface](https://cli.github.com/manual/gh_pr_view).

Optional optimizations and controls: none. Approval fencing, commit-bound validation/review, process ownership and expected-head publication are required workflow integrity checks.

## Verified on Mia — October 20, 2026

The full project verification and four PostgreSQL integration suites pass. Both actual selected SDK models completed a guest-local Playwright MCP interaction and screenshot, then read the workspace log mirror through native tools. The deployed ticket page rendered without browser errors. Initial execution exposed and fixed missing Codex home setup and over-redaction of LocalStack's public `test` credentials. Those literals are excluded only from the workspace logger's credential set; real provider and repository secrets remain redacted.

The real ONE-4767 run completed implementation, lint, type checks, tests, build, browser acceptance checks and Claude review, then opened internal-chat-ui PR #125 at `73765025ef864eb3732e1725d85d3700eafca770`. Tim explicitly authorized deleting the previous remote branch before reusing `feature/one-4767`. Claude returned no findings on its first review, so this run did not exercise the implementation revision loop. A PostgreSQL regression test verifies that a subsequent timestamp-only Linear update preserves the approved plan, discovery ID and `pr_open` dashboard status.
