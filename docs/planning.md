# Adversarial planning

After Tim confirms discovery answers, Code Assist queues Codex to draft a plan from the full ticket, answers and recorded repository snapshots. Claude independently reviews the plan against those same snapshots. A review requesting changes queues another Codex version and another Claude review. There is no application-imposed review-round quota. A review needing a product decision pauses for Tim's direction.

The ticket page shows the current plan, findings, agent activity, previous versions, feedback and approval history. Plans download as `plan_vN.md`; saved versions and reviews are never overwritten. Completed discovery is collapsed while planning is active. The original interactive reference is `docs/initial/index.html`.

## Human approval

Critical/high findings block approval, even if the reviewer incorrectly labels the plan ready. A ready review may retain medium concerns; Tim must explicitly check each one before approving that exact version. The server validates the current version, plan hash, current discovery and repository scope, review disposition and complete set of accepted medium finding IDs. Approval records the authenticated Tailscale owner, input hash, plan hash, version and accepted concerns.

Feedback on a reviewed plan creates the next version and another independent review. A previous approval remains in history but is no longer current. Changes to ticket inputs or repository selection supersede planning with the discovery baseline. Removing Plan hides the ticket and prevents acceptance of pending results or approvals. Existing GitOps-specific approval requirements still apply.

This release ends at plan approval. It does not yet implement plans, create branches, publish PRs or merge them. Approval captures authorization for the subsequent implementation phase; it does not claim that phase has run.

## Durable checkpoints

Queue: `adversarial-planning`, using native pg-boss defaults and the existing explicit-retry pattern. Each draft and review is a separate durable job.

- `planning_run`: confirmed discovery, immutable input hash, current step/version and state.
- `planning_step`: immutable step input, queue job, provider session, execution state and failure.
- `plan_version`: complete Codex plan, change summary and responses to review findings.
- `plan_review`: independent Claude findings and disposition for one version.
- `plan_feedback`: append-only human direction.
- `plan_approval`: exact version/input approval and accepted medium findings.

Completing a job, saving its output, recording history and queuing the next step or notification happen in one PostgreSQL transaction. Agent execution happens outside transactions. Issue-row locking and current-step checks reject duplicate or stale completion. Worker startup also queues previously confirmed discoveries that have not begun planning.

Graceful deployment shutdown interrupts the current step and queues a replacement with the same saved inputs. Completed steps are not repeated. Unexpected worker death or expired jobs become visible failures on reconciliation; Retry repeats only the failed step. Pending attention messages are checked against the current step/version and status before sending.

## Providers and evidence

Codex SDK 0.163.0 drafts/revises; Claude Agent SDK 0.3.304 reviews. Native model and reasoning defaults apply. Credentials are read from saved secrets at each step: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. An optional saved `ANTHROPIC_WORKSPACE_ID` selects the workspace for an unscoped Anthropic key, using the SDK's native `ANTHROPIC_CUSTOM_HEADERS` environment configuration. This is an actual `wrkspc_…` ID, not the literal name `default`; it is validated before constructing the header. No workspace lookup or automatic workspace selection occurs during jobs.

Codex reuses the discovery read-only permission profile. Claude exposes only native Read, Grep and Glob, with a native PreToolUse authorization hook checking canonical paths against the snapshot workspace. Explicit outside paths and symlinked file reads are denied; traversal patterns in Glob are denied. Claude has no Bash, write, web or MCP tools. Each run uses an isolated HOME, provider configuration and minimal environment. These Claude tool authorizations are not an OS filesystem sandbox.

The shared runner uses the previously approved owned-process cleanup on cancellation, worker disconnect and SIGTERM. It terminates only descendants belonging to that runner and verifies process identity; interrupted steps restart separately. A direct SIGKILL of the runner itself cannot execute its cleanup handler.

Full inputs, SDK events, results and failures use the existing redacting log/artifact system with service `planning` and ticket, job, step and provider-session correlation. Provider keys and workspace configuration are not copied into managed repositories. Repository inputs remain the Git archives captured during discovery; source clone updates do not change those inputs. Plans must identify missing history, submodules or live-state evidence honestly.

## Validation and operations

Run `make verify` and `TEST_DATABASE_URL=postgresql://<user>@localhost:5432/postgres make test-intake`. Integration tests use disposable databases to exercise alternating providers, blocking findings, required medium acceptance, exact-version approval, feedback invalidation, atomic rollback, duplicate result rejection, restart/retry, human direction, scope changes, removal and notification relevance. Unit tests cover structured output and native tool authorization decisions.

The schema migration is additive. The normal main-branch updater installs the pinned SDK, validates the release and restarts the worker. Rolling back application code preserves these tables and plans; older workers do not consume the planning queue. Bring the planning worker back to resume queued steps, or use the visible Retry action for failed steps.

Optional optimizations and controls:

- Reuses Tim's approved owned-process cleanup for both planning providers. Evidence: orphaned Codex commands during real cancellation tests; scope: subprocesses owned by the individual runner. Tradeoff: cancellation terminates that in-flight step immediately; saved checkpoints survive. This is the existing approved behavior extended to planning jobs.
- No other optional optimization or control is introduced. Exact approval checks, scope fencing and read-only tool authorization enforce the requested planning workflow and permissions.

References: [Anthropic workspace selection](https://platform.claude.com/docs/en/manage-claude/authentication), [Claude environment variables](https://code.claude.com/docs/en/env-vars), [native permission hooks](https://code.claude.com/docs/en/agent-sdk/permissions), [structured output](https://code.claude.com/docs/en/agent-sdk/structured-outputs).
