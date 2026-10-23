# Current Status

Updated October 22, 2026 against the source tree, including the repeated-validation pause added after `ff4a8d4`, and the checked-in workflow/evidence documentation. This is the starting point for a new session. It summarizes implementation and dated evidence, not live ticket or deployment status. Check live state before claiming a deployment, ticket outcome, or acceptance result is current.

## Product and Runtime

Code Assist moves Linear tickets through repository confirmation, discovery, adversarial planning, exact-version approval, implementation, validation, review, and PR publication. Tim approves plans and merges PRs. The SvelteKit UI, supervised worker, PostgreSQL/pg-boss, SDKs, source snapshots, coding guests, browsers, and evidence live on Mia, reachable over Tailscale at `http://100.91.0.83:3000`.

Discovery and planning use recorded source snapshots and read-only agent access. Planning can use the configured temporary AWS staging read-only role for evidence. Coding uses a separate OrbStack guest per ticket run, with selected repositories together for paired tests. Controller-owned publication keeps GitHub and Windmill publication credentials out of agent guests.

## Implemented Workflow

| Area | Current Behavior | Details |
| --- | --- | --- |
| Intake | Paginated Linear discovery for Plan without Code; saved multi-repository selection; removal/restoration preserves history; no automatic Linear writes | [Intake](intake.md) |
| Discovery | Codex reads pinned snapshots; findings, questions, answers, explicit scope confirmation, retries, and stale-attempt rejection | [Discovery](discovery.md) |
| Planning | Codex drafts/revises; Claude reviews; immutable plan versions; feedback, direction, plan comparisons, and exact-version approval with explicit acceptance of remaining medium findings | [Planning](planning.md) |
| Repository Setup | Editable runtime profiles, secret mappings, pinned local Git dependencies, and disposable setup/validation/browser tests; three built-in defaults plus saved profiles | [Repository Setup](repository-setup.md), [Secrets](secrets.md) |
| Coding | Sequential multi-repository implementation; saved checkpoints and evidence; repository validation; unchanged repeated validation failures pause for direction; combined Claude review; critical/high/medium findings return to implementation | [Coding](coding.md) |
| Human Follow-Up | Replies to coding questions, requested changes to owned open PRs, explicit Bring In Main, fresh evidence for revisions, and Run Browser Checks recovery | [Coding](coding.md) |
| Publication | Exact-commit validation/review checks, durable publication intents, remote-head checks and retry reconciliation, separate PRs for selected repositories; private-tool links and attribution omitted from external templates | [Coding](coding.md#external-publication-privacy) |
| Windmill Work | Controller-owned native production-workspace fork creation, ticket fork branches, exact-commit Git Sync evidence, and native PR adoption; latest addition in `f21c951` | [Windmill Publication](coding.md#windmill-production-fork-publication) |
| GitHub Completion | PR/merge monitoring; every repository needs observed successful push-to-main workflows for its exact merge commit; scoped corrective coding for failed main workflows | [Coding](coding.md#github-pr-and-main-workflow-tracking) |
| Operations | Owner-only Tailscale access, Home updates through PostgreSQL notifications/SSE, central logs/artifacts, Teams attention outbox, automatic main deployment, and completed-workspace cleanup after 24 hours with retained evidence | [Deployment](deployment.md), [Worker](worker.md), [Logging](logging.md) |

Exact-version approval authorizes implementation and publication for the confirmed scope, including described GitOps work inside Code Assist. Changed scope requires a revised approved plan. Agents never merge PRs, enable auto-merge, apply Terraform, or initiate managed infrastructure deployment. Windmill test-fork publication is distinct from parent production publication.

Published work also has an explicit **Move to Done State** owner action. It records
completion separately from GitHub/CI evidence and stops ticket automation without
changing external systems. This handles owner-confirmed completion when a repository
has no main workflow, including ONE-5190's reported case. The action requires local
agent work to be settled. See [Owner Completion Override](coding.md#owner-completion-override).

As requested October 23, the source moves Done tickets into Home's **Completed**
section after four hours. Workspace cleanup remains at 24 hours. Check the deployed
release before assuming the display change is live.

## Code Map

| Location | Responsibility |
| --- | --- |
| `apps/web/src/routes` and `apps/web/src/lib/components` | Home, ticket timeline/actions, configuration, logs, and workflow UI |
| `apps/worker/src/main.ts` | Registers setup, intake, notification, discovery, planning, coding, GitHub, cleanup, and diagnostic workers |
| `packages/intake/src/store.ts`, `discovery*.ts`, `planning*.ts`, `coding*.ts` | PostgreSQL workflow state, durable jobs, provider execution, approval checks, recovery, and publication |
| `packages/intake/src/github*.ts`, `windmill-publication.ts` | GitHub observations and completion; Windmill fork publication |
| `packages/intake/src/workspace*.ts`, `repository-*.ts` | Guest provisioning, repository profiles, environment isolation, and setup tests |
| `packages/observability`, `packages/secrets`, `packages/browser-mcp` | Logs/artifacts, private secret storage, and browser integration package/tests |
| `ops` | launchd installation, release builds/activation, release cleanup, and runtime probes |

## Remaining Gaps and Evidence Boundaries

- Automatic ingestion of GitHub review comments and automatic rebase/revalidation are not implemented. Request Code Changes and Bring In Main are explicit user actions.
- The latest native Windmill fork publisher has local Git tests with synthetic service responses and documented live read-only configuration inspection. Its first real approved controller-driven fork publication remains unverified in the checked-in record. Git Sync success proves source synchronization, not feature acceptance or provisioning of excluded resources, triggers, variables, or datatables.
- ONE-5239's manual fork recovery and successful small-file hosted upload are historical evidence, not proof that the new controller path ran. See [the run findings](one-5239-run-findings.md); the deferred 25 MB test and full non-admin acceptance are separate limitations.
- Corrective coding after failed main workflows has fixture-based coverage; the documentation does not claim a deliberately induced live deployment failure tested the full repair path.
- Repository setup results are dated evidence. Saved profiles on Mia and each run's pinned profile are authoritative. Browser sign-in-page checks do not prove an authenticated Microsoft session or full application acceptance. The recorded Medusa baseline includes two failing credential tests; inspect a fresh result before treating that as current.
- On October 22, ONE-5005 completed 58 failed validations of unchanged commit `39607d7`; every failure returned to implementation without reaching review. The run was stopped with its workspace intact. Saved logs show the Linear `test_near_expiry_triggers_remint` failure on the candidate and in a focused approved-base run, while a baseline full-suite run passed. Treat that as evidence of an intermittent baseline failure, not passing candidate validation. The controller now has an approved pause for unchanged repeated command failures; see [Coding](coding.md#repeated-validation-failures). Check live state for the incident's current disposition.
- The pause fix `63aecb8` was observed running in Mia's web app and worker on October 22 at 7:39 PM EDT. Retrying only ONE-5005's stopped validation preserved candidate `39607d7` and reached `needs_direction` with `passed: false` and no queued/active coding jobs for that run, verified at 7:41 PM EDT. The browser showed the question and **Reply and Continue**. This verifies the stop on the real incident; it does not resolve the underlying Medusa test failure or complete ONE-5005.
- Full-machine/FileVault reboot recovery, backup/restore, and external-drive migration remain unproven in the operational record. OpenObserve native MCP and application trace instrumentation are separate from the implemented SDK event/artifact logging.
- Per-ticket guests isolate working files and services, but native loopback publishing defaults are not an enforced hostile-code network boundary: explicit all-interface binds can override them. Read the [follow-up isolation proof](loopback-isolation-proof.md) alongside the original concurrent test.

## Working and Verifying

Use Node 24 and pnpm 10.28.0. `make verify` runs lint/format checks, type checks, unit tests, and the production build. PostgreSQL integration targets are separate: `make test-worker` and `make test-intake` with `TEST_DATABASE_URL`. Browser and OrbStack checks have additional prerequisites documented in [Browser Testing](browser-testing.md) and [Repository Setup](repository-setup.md). Report which checks actually ran; historical passes are not fresh verification.

Publishing Code Assist `main` triggers Mia's updater even for documentation-only changes. Immediately before pushing or restarting, inspect live pg-boss jobs, queued continuations, agent steps, and associated processes. Hold deployment while work is active or cannot be verified. Durable state, workspaces, and evidence live outside replaceable releases.

Keep this page and the affected workflow guide current when behavior changes. Date live evidence and name its commit/run; preserve original plans and historical findings rather than rewriting their outcomes. The [initial brief](initial/standalone-brief.md) records product requirements; the [original plan](plans/plan_v1.md) and [prototype](initial/index.html) are historical design references.

On October 22, Tim requested that managed GitHub and Linear content not identify
Code Assist. The source now omits the old public links and attribution, uses neutral
ownership markers and the publisher's configured Git identity for new commits,
and keeps private revision requests inside the application. The matching instruction
was added to Mia's saved Global prompt and the default prompt. Existing commits are
not rewritten, and existing PR descriptions are cleaned only when next updated by
the normal publisher. Check the deployed release before assuming template changes
are live; see [Coding](coding.md#external-publication-privacy).

Optional optimizations and controls: Tim approved the repeated-validation pause on October 22, 2026. It applies to all coding runs and requires a reply when another implementation attempt leaves the same candidates and failing command outcomes; validation and review remain required. See [Coding](coding.md#repeated-validation-failures) for its comparison scope and transient-failure tradeoff.
