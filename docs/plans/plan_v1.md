# Code Assist implementation and deployment — v1

October 19, 2026. Proposed implementation of the [standalone brief](../initial/standalone-brief.md). SvelteKit, Tailscale access, automatic deployment from `main`, and direct pushes during initial development are Tim's explicit requirements. This document records a plan, not an installed application.

## Architecture

- **Web:** SvelteKit with the official Node adapter, serving the accepted Home and ticket timeline. Proposed address: `http://100.91.0.83:3000`. Bind to the Tailscale interface; verify Tim-only access before exposing approval actions.
- **Worker:** a separate supervised TypeScript process advancing the PostgreSQL-backed state machine. Closing the browser, restarting the web process, or updating the app must not lose jobs.
- **State:** native PostgreSQL 18 for work, commands, questions/answers, plan versions, reviews, attempts, approvals, events, PR observations and notification intent. Source commits and immutable evidence live on persistent disk.
- **Execution:** native Codex SDK and Claude Agent SDK, official Playwright MCP, repository-native tooling and OrbStack for test services.
- **Deployment:** a separate local updater watches published `main`. macOS `launchd` supervises the web, worker and updater with explicit executable paths and environments.

Use a supported Node LTS release, pinned with the package manager and dependency lockfile. Verify current SDK requirements before selecting exact versions; the mini's installed Node 25 is not the deployment baseline.

## Durable workflow

Implement transitions and append-only events in short database transactions, with external calls outside transactions:

`Linear intake → repository selection / questions → draft plan → review / revision → Tim approval → implementation → validation / code review → PR publication → waiting on GitHub`

Human waits persist in PostgreSQL without a running agent. Plan approval binds the exact version, requirements and repository, and authorizes implementation, branch creation and publication. Any changed scope requires new approval.

Each attempt records immutable inputs, its source commit, owning process and execution identity. Completion requires saved artifacts and a resulting commit where applicable. Only the current attempt can advance work. Stop, replacement and restart fence stale results and publication.

On restart, reconcile attempt records with actual owned processes before starting replacements. Record interrupted steps and expose Retry from their saved inputs. Verify cancellation of descendants and resource cleanup; a PID alone is insufficient ownership evidence.

Publication checks approval and validated/reviewed commit identity, then reads the existing branch and PR state before writing. An uncertain push or PR creation is reconciled by reading GitHub. Never merge. PR opened is the first delivery milestone; feedback, conflict handling and observed merge → Done remain part of the full brief.

Persist notification intent with each applicable state event and send it separately using the brief's accepted at-least-once behavior.

## Automatic deployment

Use an application-owned installation outside `~/CODE/repos`, whose existing daily sync is for repository maintenance.

Proposed layout under `~/Library/Application Support/CodeAssist/`:

```text
source/                 deployment source checkout
releases/<commit>/      built web and worker for an exact commit
current                 active release reference
data/workspaces/         per-attempt execution directories
data/artifacts/          immutable evidence and saved source references
logs/                   service and deployment diagnostics
```

Keep runtime secrets outside source, build output and agent-readable workspaces. Choose and prove OS-level separation for the trusted controller/publisher and agent processes; changing HOME or removing environment variables alone does not enforce that boundary.

Deployment sequence:

1. Detect a new remote `main` commit using a supervised poll. Poll interval remains to be selected; a local commit must be pushed before the mini can see it.
2. Fetch the exact commit into a new release directory. Install locked dependencies, run repository checks and build. A build failure leaves the current release running and records the failure.
3. Stop starting new attempts while existing steps finish and checkpoint. The old release remains active during this drain; show deployment status rather than silently killing agents.
4. Stop old application processes, run compatible schema migrations, activate the new release and restart web/worker. Persist activation progress so the updater can reconcile its own interruption.
5. Verify web readiness, database connectivity and worker reconciliation. Show the running commit and deployment outcome in diagnostics.

Updates may briefly interrupt the web UI. Preserve the previous release for operator rollback. Database changes must remain compatible with it; code rollback must never imply reversing migrations or restoring an old database over current jobs. Define and test backup/restore before the system holds real work.

The updater's unattended GitHub authentication must be tested from its actual launchd context: interactive `gh` authentication on Mia does not yet prove that context can access the login keychain.

## Build order and evidence

1. **Runtime proof:** Tim selects the first repository. On Mia, restore a known commit and run its unchanged full validation, Docker services and real browser scenarios through both SDKs. Prove two-story isolation, process interruption and credential separation.
2. **Durable core:** migrations, transitions, attempts, artifacts, command handling and notification outbox. Test restart recovery, stale completion rejection and exact-version approval.
3. **Deployment foundation:** package the web/worker, install launchd definitions and updater, establish Tailscale access. Push a small change to `main` and verify the mini reports that exact running commit. Test a failed build and an update during an active attempt.
4. **Planning UI:** port the accepted prototype to SvelteKit with real intake, questions, immutable plan/review history and approval.
5. **First complete ticket:** implement an approved plan, run native validation and browser acceptance checks, alternate reviews, and open one real PR. Simulate interruption around GitHub writes and verify reconciliation avoids duplicate PRs.
6. **Completion lifecycle:** observe PR feedback/checks/head changes, handle authorized rebases and renewed validation, and mark Done only after Tim's merge is observed.

Use the repository's Makefile targets for lint, formatting, type checks and meaningful workflow tests once scaffolding exists. No application tests or deployment have run yet.

## Decisions still needed

- Initial managed repository and a suitable first ticket.
- Linear and deployment polling intervals.
- Label-removal behavior, unresolved medium plan finding acceptance and non-converging review handling.
- Tim-only access enforcement, execution account/credential boundary, backup destination and retention.
- Recovery after a full reboot: existing OrbStack, PostgreSQL and Tailscale settings start at user login; unattended pre-login operation is not proven.

Technical references: [SvelteKit Node deployment](https://svelte.dev/docs/kit/adapter-node), [Node release support](https://github.com/nodejs/Release).

Optional optimizations and controls: none. Deployment draining and attempt fencing implement the required preservation of jobs across updates.
