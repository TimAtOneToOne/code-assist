# Adversarial Planning

After Tim confirms discovery answers, Code Assist queues Codex to draft a plan from the full ticket, answers and recorded repository snapshots. Claude independently reviews the plan against those same snapshots. A review requesting changes queues another Codex version and another Claude review. There is no application-imposed review-round quota. A review needing a product decision pauses for Tim's direction.

New discovery baselines also include each repository's saved setup commands and configuration hash, with environment values withheld. Both planning agents receive this context and must reconcile validation with the source and proposed changes, including whether newly added tests will actually run. Missing repository setup is gathered and tested before normal discovery; setup answers resume intake rather than starting planning. Historical plans retain their original inputs.

The ticket page shows the current plan, findings, agent activity, previous versions, feedback and approval history. Plans download as `plan_vN.md`; saved versions and reviews are never overwritten. Completed discovery is collapsed while planning is active. The original interactive reference is `docs/initial/index.html`.

## Human Approval

New plan outputs include an `additionalValidation` array of repository names and
shell scripts for acceptance checks beyond the saved profile. Codex proposes them
and Claude reviews their coverage, feasibility and effects. Use exact confirmed
repository names and an empty array when existing commands cover the work.
Commands for unselected repositories are rejected before saving the plan.

The controller renders these commands in **Additional Controller Validation**,
includes them in version comparisons and Markdown downloads, and hashes them
with the entire plan. Changing commands requires a new reviewed, approved version.
Historical documents without this field retain their content and behavior.

Each script runs after that repository's pinned checks, through the existing
environment launcher in its configured working directory, using `bash -euc`
without stdin. These are acceptance checks, not setup, publication or deployment
commands. Do not embed secret values. Failed checks follow the existing repair
flow; missing command results cannot count as success. Saved profiles and workspace
configuration are not rewritten. See [the regression record](plan-validation-rehearsal.md).

Critical/high findings block approval, even if the reviewer incorrectly labels the plan ready. A ready review may retain medium concerns; Tim must explicitly check each one before approving that exact version. The server validates the current version, plan hash, current discovery and repository scope, review disposition and complete set of accepted medium finding IDs. Approval records the authenticated Tailscale owner, input hash, plan hash, version and accepted concerns.

Feedback on a reviewed plan creates the next version and another independent review. A previous approval remains in history but is no longer current. Changes to ticket inputs or repository selection supersede planning with the discovery baseline. Removing Plan hides the ticket and prevents acceptance of pending results or approvals.

Within Code Assist, Tim's exact-version plan approval also authorizes the described GitOps implementation, branch creation, commits, pushes, and PR publication for confirmed repositories. No separate GitOps approval checkpoint is needed. Plan necessary GitOps work directly rather than creating workarounds to avoid that approval. This exception, clarified October 20, 2026, supersedes generic separate-approval instructions for this workflow only. Discovery/planning stay read-only; work outside approved scope needs a revised plan and approval. Tim reviews and merges PRs, and humans initiate Terraform applies through the established workflow.

Approval queues the [coding workflow](coding.md), which prepares isolated workspaces, implements the plan, validates and reviews the candidate commits, and publishes PRs through the controller. Approval records authorization, not evidence that implementation or publication has succeeded. Tim performs PR merges.

## Durable Checkpoints

Queue: `adversarial-planning`, using native pg-boss defaults and the existing explicit-retry pattern. Each draft and review is a separate durable job.

- `planning_run`: confirmed discovery, immutable input hash, current step/version and state.
- `planning_step`: immutable step input, queue job, provider session, execution state and failure.
- `plan_version`: complete Codex plan, change summary and responses to review findings.
- `plan_review`: independent Claude findings and disposition for one version.
- `plan_feedback`: append-only human direction.
- `plan_approval`: exact version/input approval and accepted medium findings.

Completing a job, saving its output, recording history and queuing the next step or notification happen in one PostgreSQL transaction. Agent execution happens outside transactions. Issue-row locking and current-step checks reject duplicate or stale completion. Worker startup also queues previously confirmed discoveries that have not begun planning.

Graceful deployment shutdown interrupts the current step and queues a replacement with the same saved inputs. Completed steps are not repeated. Unexpected worker death or expired jobs become visible failures on reconciliation; Retry repeats only the failed step. Pending attention messages are checked against the current step/version and status before sending.

## Providers and Evidence

Codex SDK 0.163.0 drafts/revises; Claude Agent SDK 0.3.304 reviews. Models are editable in [Agent Models](models.md), initially `gpt-6.1-sol` for Codex and `claude-opus-5-5` for Claude. Each planning step reads the saved selection at startup. Native reasoning defaults still apply. Tim selected these initial models on October 20, 2026; coding implementation and review also read the saved model settings at each step. Credentials are read from saved secrets at each step: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. An optional saved `ANTHROPIC_WORKSPACE_ID` selects the workspace for an unscoped Anthropic key, using the SDK's native `ANTHROPIC_CUSTOM_HEADERS` environment configuration. This is an actual `wrkspc_…` ID, not the literal name `default`; it is validated before constructing the header. No workspace lookup or automatic workspace selection occurs during jobs.

Codex retains the discovery read-only filesystem boundary, adding AWS CLI reads and AWS network access when the staging connection is configured. Claude exposes native Read, Grep and Glob, with a native PreToolUse authorization hook checking canonical paths against the snapshot workspace. Configured AWS access also enables native sandboxed Bash as described below. Explicit outside paths and symlinked file reads are denied; traversal patterns in Glob are denied. Claude has no write, web or MCP tools; without an AWS connection, Bash is unavailable too. Each run uses an isolated HOME, provider configuration and minimal environment. These Claude tool authorizations are not an OS filesystem sandbox.

The shared runner uses the previously approved owned-process cleanup on cancellation, worker disconnect and SIGTERM. It terminates only descendants belonging to that runner and verifies process identity; interrupted steps restart separately. A direct SIGKILL of the runner itself cannot execute its cleanup handler.

Full inputs, SDK events, results and failures use the existing redacting log/artifact system with service `planning` and ticket, job, step and provider-session correlation. Provider keys and workspace configuration are not copied into managed repositories. Repository inputs remain the Git archives captured during discovery; source clone updates do not change those inputs. Plans must identify missing history, submodules or live-state evidence honestly.

## Validation and Operations

Run `make verify` and `TEST_DATABASE_URL=postgresql://<user>@localhost:5432/postgres make test-intake`. Integration tests use disposable databases to exercise alternating providers, blocking findings, required medium acceptance, exact-version approval, feedback invalidation, atomic rollback, duplicate result rejection, restart/retry, human direction, scope changes, removal and notification relevance. Unit tests cover structured output and native tool authorization decisions.

The schema migration is additive. The normal main-branch updater installs the pinned SDK, validates the release and restarts the worker. Rolling back application code preserves these tables and plans; older workers do not consume the planning queue. Bring the planning worker back to resume queued steps, or use the visible Retry action for failed steps.

Optional optimizations and controls:

- Reuses Tim's approved owned-process cleanup for both planning providers. Evidence: orphaned Codex commands during real cancellation tests; scope: subprocesses owned by the individual runner. Tradeoff: cancellation terminates that in-flight step immediately; saved checkpoints survive. This is the existing approved behavior extended to planning jobs.
- No other optional optimization or control is introduced. Exact approval checks, scope fencing and read-only tool authorization enforce the requested planning workflow and permissions.

References: [Anthropic workspace selection](https://platform.claude.com/docs/en/manage-claude/authentication), [Claude environment variables](https://code.claude.com/docs/en/env-vars), [native permission hooks](https://code.claude.com/docs/en/agent-sdk/permissions), [structured output](https://code.claude.com/docs/en/agent-sdk/structured-outputs).

## Comparing Plan Versions

For v2 and later, **Show changes since vN** is enabled by default and compares the selected version with its immediate predecessor in the same planning run. Only added or changed words and phrases are yellow, including within headings, list items, code and tables. A small edit no longer colors its entire paragraph. Inline formatting is preserved, and unchanged wording keeps its normal appearance. Turning the toggle off shows the clean plan.

**Removed text** contains previous wording removed or replaced by that revision, including the old text of rewritten sections. Moved sections can appear as a removal and addition. This is a literal word comparison, not an AI judgment about significance. Formatting and whitespace alone do not paint words yellow; replaced blocks remain available in the removed-text disclosure for context. Broad rewrites can still highlight substantial text. V1 has no comparison, and identical rendered revisions show “No content changes.” Downloads remain the original saved Markdown.

Comparison runs on the server using the same sanitized Markdown renderer. Only generated display markers are added to its output; saved plans, hashes, reviews and approvals are unchanged. The ordered-list start attribute is retained so numbered steps render accurately in both the plan and removed text.

Optional optimizations and controls for comparison: Tim requested and approved the display toggle and removed-text disclosure. They affect only presentation: turning highlighting off hides comparison annotations, while the saved version remains visible. No caching, truncation, semantic filtering or workflow controls were added.

## AWS Staging Evidence

[Configuration → AWS staging](http://100.91.0.83:3000/configuration/aws) configures the shared planning connection. Select the source access-key ID and secret access key from saved secrets, then set the expected account, read-only role ARN, region and profile. **Test saved connection** assumes the role and verifies its caller identity; it does not validate every IAM permission. Configuration is stored in `data/aws-staging.json` with secret references, never credential values. Referenced keys cannot be deleted until the connection selects replacements. Key rotation is picked up at the next planning step.

Before each Codex draft/revision or Claude review, the worker uses the native AWS SDK STS `AssumeRole` operation with explicit source credentials, then verifies the assumed identity. Only temporary session credentials reach the agent process, in a mode-0600 AWS profile under its isolated HOME. Source credentials stay in the worker. The profile is removed when the step finishes or fails. A forced worker termination can leave an expired profile on disk; STS expiration still applies. No refresh daemon or automatic identity fallback is introduced. An expired session or denied operation is reported as an evidence gap; operators replace expired/revoked source credentials in Secrets when necessary.

Agents use the installed AWS CLI with the supplied `--profile` and `--region`. Codex retains its read-only filesystem profile and uses its native network proxy for AWS endpoints. Claude adds native Bash with the SDK's required sandbox: snapshots are non-writable, user home directories and mounted volumes are unreadable except the supplied snapshots and temporary AWS profile, and outbound requests are limited to AWS endpoints. The Claude API key is removed from sandboxed commands. Native Read/Grep/Glob retain their existing canonical-path authorization. The AWS role's IAM policies enforce permitted cloud operations; shell instructions are not an IAM boundary. These runners target the Mia macOS deployment and require AWS CLI in `/opt/homebrew/bin` or `/usr/local/bin`.

The role verified on October 20, 2026 is `arn:aws:iam::657570828600:role/agents/mac-mini-agent-readonly-staging`, using `us-east-2` and profile `staging-agent-readonly`. Its existing policy permits infrastructure/application reads and log queries, and explicitly denies secret-value retrieval and role assumption. No IAM or infrastructure changes were made. The connection is global to planning, independent of repository application environment mappings. Initial discovery remains unchanged.

Prompts identify the connection, session expiration and staging-only scope. Live findings must name the service/command, resource, account, region and observation time; staging does not prove production behavior. Connection identity and SDK tool events use the existing correlated logs. AWS access-key IDs, secret keys and session tokens are redacted from those logs. Saved plans and approvals are not regenerated when connection settings change; the next planning step uses the new settings.

Optional optimizations and controls: Tim requested explicit model selection on October 20, 2026. The initial defaults are `gpt-6.1-sol` for Codex and `claude-opus-5-5` for Claude; each new planning step uses the saved Agent Models selection. Runs no longer follow SDK default-model changes, so selecting a new model requires an explicit settings change. Provider revisions behind those IDs can still change. The previously requested temporary read-only staging access and existing planning boundaries remain. No caching, extra retries, command-result limits, or new workflow gates were added. STS session duration and SDK retry behavior use AWS defaults.

References: [AWS temporary role credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp_request.html), [Codex filesystem and network permissions](https://learn.chatgpt.com/docs/permissions), [Claude native Bash sandbox](https://code.claude.com/docs/en/sandboxing).

## Prompt Configuration

Global, planning, task, and repository instructions are editable in
[Prompt Management](prompts.md). Both discovery and planning workers load them
at the start of each execution. Saved plan versions retain their original content.
