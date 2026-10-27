# Current Status

Updated October 25, 2026 against the source tree, including structured acceptance scenarios and current-attempt evidence, approved additional validation commands, automatic repository setup during intake, shared Linux browser provisioning and native MCP readiness, deployment-status inspection, the four-hour Completed display window, and the checked-in workflow/evidence documentation. This is the starting point for a new session. It summarizes implementation and dated evidence, not live ticket or deployment status. Check live state before claiming a deployment, ticket outcome, or acceptance result is current.

## Product and Runtime

October 26 discovery presentation update: setup scans now receive the ticket, and both setup and
feature discovery explain the requested change in plain language and pseudocode
before asking concrete, decision-focused questions. Technical findings and setup
details follow the questions. Existing saved results retain their original wording
until a new attempt runs. Native scans against ONE-5370's recorded source and local
desktop/mobile browser checks verify the new presentation; they do not establish
that repository setup passed. See [Discovery](discovery.md#explanation-and-questions)
and the local evidence under `.tmp/2026-10-26-discovery-clarity/` for generated
results, browser checks, and dated release observations.
Optional optimizations and controls: none.

October 25 live verification: the [ONE-5347 repeat rehearsal](one-5347-rehearsal.md)
reached a published PR with zero operator course corrections after normal scope
and plan approvals, including an automatic review repair and fresh browser
acceptance for the revised commit. Tim merged it; the monitor detected the exact
merge automatically. It then waited for a main workflow that the restored baseline
did not have. Tim subsequently used the owner completion action. The follow-up adds
an explicit per-repository completion rule (observed deployed at `5803812`) and restores minimal CI in the test
repository. [Completion verification](repository-completion.md) separates local
regression evidence, observed GitHub CI, and deployment status.

Code Assist moves Linear tickets through repository confirmation, discovery, adversarial planning, exact-version approval, implementation, validation, scenario acceptance, review, and PR publication. Tim approves plans and merges PRs. The SvelteKit UI, supervised worker, PostgreSQL/pg-boss, SDKs, source snapshots, coding guests, browsers, and evidence live on Mia, reachable over Tailscale at `http://100.91.0.83:3000`.

Discovery and planning use recorded source snapshots and read-only agent access. Planning can use the configured temporary AWS staging read-only role for evidence. Coding uses a separate OrbStack guest per ticket run, with selected repositories together for paired tests. Controller-owned publication keeps GitHub and Windmill publication credentials out of agent guests.

## Implemented Workflow

| Area              | Current Behavior                                                                                                                                                                                                                              | Details                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Intake            | Paginated Linear discovery for Plan without Code; saved multi-repository selection; removal/restoration preserves history; no automatic Linear writes                                                                                         | [Intake](intake.md)                                                                      |
| Discovery         | Codex reads pinned snapshots; findings, questions, answers, explicit scope confirmation, retries, and stale-attempt rejection                                                                                                                 | [Discovery](discovery.md)                                                                |
| Planning          | Codex drafts/revises; Claude reviews; immutable plan versions; feedback, direction, plan comparisons, and exact-version approval with explicit acceptance of remaining medium findings                                                        | [Planning](planning.md)                                                                  |
| Repository Setup  | Intake automatically scans/tests missing profiles with Codex before discovery; saved profiles are reused; setup questions remain on the ticket; editable profiles, secret mappings, pinned Git dependencies and disposable tests              | [Repository Setup](repository-setup.md), [Secrets](secrets.md)                           |
| Coding            | Sequential multi-repository implementation; saved checkpoints and evidence; repository validation; unchanged repeated validation failures pause for direction; combined Claude review; critical/high/medium findings return to implementation | [Coding](coding.md)                                                                      |
| Acceptance        | New plans require scenario outcomes and current native tool evidence for the approved plan, all candidate commits and latest request; browser, command/API and inspection methods; missing proof repairs, unavailable prerequisites pause     | [Acceptance Rehearsal](acceptance-rehearsal.md), [Coding](coding.md#scenario-acceptance) |
| Human Follow-Up   | Replies to coding questions, requested changes to owned open PRs, explicit Bring In Main, fresh evidence for revisions, and Run Browser Checks recovery                                                                                       | [Coding](coding.md)                                                                      |
| Publication       | Exact-commit validation/review checks, durable publication intents, remote-head checks and retry reconciliation, separate PRs for selected repositories; private-tool links and attribution omitted from external templates                   | [Coding](coding.md#external-publication-privacy)                                         |
| Windmill Work     | Controller-owned native production-workspace fork creation, ticket fork branches, exact-commit Git Sync evidence, and native PR adoption; latest addition in `f21c951`                                                                        | [Windmill Publication](coding.md#windmill-production-fork-publication)                   |
| GitHub Completion | Current-head PR-check monitoring and scoped same-PR repair; each repository follows its recorded merge-only or exact-merge main-workflow rule; corrective coding for failed main workflows                                                    | [Coding](coding.md#github-pr-and-main-workflow-tracking)                                 |
| Operations        | Owner-only Tailscale access, Home updates through PostgreSQL notifications/SSE, central logs/artifacts, Teams attention outbox, automatic main deployment, and completed-workspace cleanup after 24 hours with retained evidence              | [Deployment](deployment.md), [Worker](worker.md), [Logging](logging.md)                  |

Exact-version approval authorizes implementation and publication for the confirmed scope, including described GitOps work inside Code Assist. Changed scope requires a revised approved plan. Agents never merge PRs, enable auto-merge, apply Terraform, or initiate managed infrastructure deployment. Windmill test-fork publication is distinct from parent production publication.

Published work also has an explicit **Move to Done State** owner action. It records
completion separately from GitHub/CI evidence and stops ticket automation without
changing external systems. This handles owner-confirmed completion when a repository
has no main workflow, including ONE-5190's reported case. The action requires local
agent work to be settled. See [Owner Completion Override](coding.md#owner-completion-override).

As requested October 23, the source moves Done tickets into Home's **Completed**
section after four hours. Workspace cleanup remains at 24 hours. Check the deployed
release before assuming the display change is live.

The October 23 deployment-status command consolidates pre-push inspection and
post-push commit verification: `make deploy-status`, then
`make deploy-status EXPECTED_COMMIT=<pushed-sha>`. It reports Idle/Busy/Unknown from
durable jobs, workflow steps, host/guest processes, actual service releases, updater
state, and web health. A temporary live collector passed against Mia in 484 ms;
permanent command availability depends on deployment. See [Deployment Status](deployment.md#deployment-status)
and the repository's `AGENTS.md`. Optional optimizations and controls: none.

The October 23 guest-readiness change makes setup tests and coding use one runtime
installer, including Chromium OS libraries and workspace-owned browser binaries.
It verifies native MCP navigation, a click, DOM changes and a screenshot before
readiness, repeats that check with each repository's environment, and checks again
before implementation/review. Synthetic readiness evidence is separate from
feature acceptance. See [Browser Testing](browser-testing.md#guest-provisioning-and-readiness)
and [Repository Setup](repository-setup.md). Before deployment, the candidate passed
`make verify` (79 unit tests), nine PostgreSQL integration tests, and three fresh
OrbStack scenarios on Mia: successful native browser/app checks, deliberate
validation failure, and a missing-browser override rejected before validation.
All three disposable guests were removed. Release `3154114` was observed running in
web/worker/health at 9:54 PM EDT. Live Save and Test Setup
`0aa3de82-92ae-45da-9dad-218682fa5f5d` then passed all six checks on the merged test
repository without its temporary Chromium installer; its guest was removed.
See [the rehearsal follow-up](one-5321-rehearsal.md#shared-runtime-follow-up).

The open-PR CI recovery change extends the existing GitHub monitor and revision
workflow with current-head check/status/workflow evidence, atomic repair requests,
independent validation/review and same-PR updates. Missing evidence or ownership
is visible in PR Checks and attention notifications. All 81 unit tests and nine PostgreSQL integration tests passed. A real deliberately
failing PR was automatically repaired through native coding/browser checks,
validation, independent review and publication; GitHub and the UI then showed
green checks on the new head without an operator diagnosis or change request.
See [the CI recovery rehearsal](pr-ci-recovery-rehearsal.md) for live acceptance
and deployment evidence. Release `e31c0c1` was verified at 11:02 PM EDT on
October 23 across the selected release, web, worker and health endpoint, with
zero queued/active jobs and no unfinished steps. The original ONE-5321 ticket
still displayed its merged PR and successful exact-merge main CI in the deployed
UI. Optional optimizations and controls: none.

Automatic repository onboarding now precedes ticket discovery for repositories
without a saved or built-in profile. Native Codex proposes repository-specific
commands; the existing disposable test runs them before the profile is saved.
Missing information becomes setup questions on the ticket. Existing profiles and
owner edits are preserved, and both planning and coding receive setup context.
The change passed `make verify` (86 unit tests) and ten PostgreSQL integration
tests. The [onboarding rehearsal](repository-onboarding-rehearsal.md) records the
browser-driven acceptance, the discovered noninteractive migration false positive,
and its correction. Repository workflows remain repository-specific; this does
not create GitHub CI or automatically revise an existing workspace's contract.
Optional optimizations and controls: none.

Approved plans now carry repository-scoped additional validation commands. They
are displayed, compared, exported and included in the approval hash; controller
validation runs them after pinned checks without editing saved profiles. The
candidate passed 90 unit tests, ten PostgreSQL integration tests, a fresh Linux
guest regression and a browser/controller rehearsal using the test web app. The
new test failed while existing checks passed, then passed on a corrected commit.
See [the regression record](plan-validation-rehearsal.md) for fixture boundaries,
browser-download verification limits and repeatable tests. Verify the deployed
release with `make deploy-status` before relying on live availability.
Optional optimizations and controls: none.

## Acceptance Evidence Delivery

New plans include scenario coverage and current native evidence before independent review. A local API/configuration/browser rehearsal passed through real Codex implementation, controller validation, Codex acceptance and native Claude review at fixture commit `d0d230e`, stopping before publication. A misleading pass citing a failed inspection command was rejected and corrected automatically without another source change. Both SDKs also correctly recorded deliberate browser errors. Local verification passed 94 unit tests, 11 PostgreSQL integration tests, lint/types and build; the DB target skipped its two optional OrbStack suites. See [the delivery record](acceptance-rehearsal.md) for synthetic setup, operator interventions and evidence limits. Use `make deploy-status` for the current deployed release; the dated activation check is retained under `.tmp/2026-10-24-acceptance/`.

## Code Map

| Location                                                                      | Responsibility                                                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/web/src/routes` and `apps/web/src/lib/components`                       | Home, ticket timeline/actions, configuration, logs, and workflow UI                                         |
| `apps/worker/src/main.ts`                                                     | Registers setup, intake, notification, discovery, planning, coding, GitHub, cleanup, and diagnostic workers |
| `packages/intake/src/store.ts`, `discovery*.ts`, `planning*.ts`, `coding*.ts` | PostgreSQL workflow state, durable jobs, provider execution, approval checks, recovery, and publication     |
| `packages/intake/src/github*.ts`, `windmill-publication.ts`                   | GitHub observations and completion; Windmill fork publication                                               |
| `packages/intake/src/workspace*.ts`, `repository-*.ts`                        | Guest provisioning, repository profiles, environment isolation, and setup tests                             |
| `packages/observability`, `packages/secrets`, `packages/browser-mcp`          | Logs/artifacts, private secret storage, and browser integration package/tests                               |
| `ops`                                                                         | launchd installation, release builds/activation, release cleanup, and runtime probes                        |

## Remaining Gaps and Evidence Boundaries

- The October 23 ONE-5321 rehearsal completed a synthetic single-repository
  feature through planning, approved coding, Playwright acceptance, independent
  review, PR revision, operator-authorized test-repo merge, successful push CI on
  the exact merge commit, and observed Done. Fresh setup and merged-commit browser
  checks also passed. It exposed missing guest Chromium OS dependencies and the
  organization's full-SHA Action policy; the test profile and PR were corrected.
  The later shared-runtime fix above replaces that temporary browser installer.
  See [the rehearsal record](one-5321-rehearsal.md) for scope and evidence limits.
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

## October 26 Agents-Team Exercise

AGENTS-3 exposed an approval-to-coding failure caused by a hard-coded `ONE` ticket
prefix. The source fix accepts valid Linear team identifiers and displays coding
conflicts during approval. Its regression fixture checks approval rollback for
invalid identifiers and the full coding lifecycle for an AGENTS ticket; ONE
coverage remains in the other integration suites. Deployment and live continuation
are recorded under `.tmp/2026-10-26-connect-four/`. The exercise must count this
operator product fix separately from normal scope/plan approval. No game code or
agent direction was changed to resolve it. Optional optimizations and controls: none.
