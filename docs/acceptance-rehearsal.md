# Acceptance Evidence Rehearsal

## Contract

New plans define repository-specific acceptance scenarios, including method,
procedure, expected outcome and scope. After controller command validation,
a separate native Codex attempt records outcomes and supporting tool IDs.
The controller checks completeness and freshness before independent Claude review
and publication. Browser, command/API and source/configuration inspection share
this record; no application, package manager or CI convention is assumed.
Historical plans retain their existing behavior.

## Repeatable Regression

Run `make verify`. The intake regressions cover:

- Repository scopes, duplicate IDs, non-UI methods and historical plan rendering.
- Omitted, failed, blocked, malformed and unapproved scenario results.
- Unknown tool IDs, failed supporting calls and navigation-only browser evidence.
- Artifacts from another attempt, missing saved files and path escapes.
- Plan hashes, all candidate commits, current requests/replies, newer attempts and
  validation, and independent review ordering.
- Native Codex and Claude tool completion and receipt recovery.

Run `make test-intake` with an isolated PostgreSQL admin URL in
`TEST_DATABASE_URL`. `acceptance.integration.ts` exercises actual queue and database
transitions: validation queues acceptance; missing proof returns to implementation;
collection retry and process restart preserve the original attempt and tool IDs;
blocked prerequisites pause for direction; complete current evidence queues review.
The deployment activity reader also recognizes active acceptance work.

## Native Rehearsal

The October 24, 2026 rehearsal uses an isolated database, local copy of the test
web app and disposable OrbStack guest. Fixture discovery, plan review and approval
are explicitly synthetic. The real coding worker callback performs native
implementation, validation, acceptance and review. The harness stops before
publication; it does not open or merge a PR, modify a production application,
or replace the existing ONE-5321 ticket.

The feature is a local API response change plus a regression test. The approved
scenarios exercise the API contract, inspect configuration scope, and navigate
existing application routes through native Playwright MCP. This tests more than
the game's behavior without claiming a production-repository acceptance run.

The initial implementation cited screenshots in repository `.tmp` rather than
`/work/evidence`. The rehearsal exposed repeated collection of invalid paths.
Structured-plan collection now records the invalid evidence and returns to
implementation with the saved commit; the agent can correct evidence without
inventing source changes. Acceptance artifacts remain scoped to their own attempt.

An SSH-only GitHub HTTP 401 was initially misdiagnosed as expired authentication.
Tim's desktop terminal authenticated through the keyring. A temporary LaunchAgent
in `gui/501` independently authenticated as `ms-mia-socci`; the resumed rehearsal
uses that desktop session without replacing credentials. A process-local login
from the operator Mac was used for the initial isolated attempt only. Production
already runs in its login-session worker.

Local evidence and scripts: `.tmp/2026-10-24-acceptance/`. Native run:
`54f2384f-468e-43dc-bdfa-f1873a2c90de`; isolated ticket:
`a09ed680-76fc-415b-9138-e8488f26c4b1`.

## Observed Results

- `make verify` passed lint/format checks, all type checks, 94 unit tests and the production build. Focused checks were rerun after final changes.
- PostgreSQL integration: 11 passed; two optional OrbStack suites were skipped by that target. The separate native rehearsal provisioned and exercised an actual guest.
- The first acceptance attempt claimed all scenarios passed but cited a failed inspection command. The controller rejected the report and automatically returned to implementation. The next implementation preserved commit `d0d230e09619ade283a7d4fc9c2c0c63a74b9054` and reran checks; fresh acceptance `e4188597-fe57-4b5f-828d-a54b055b507c` passed all three scenarios.
- Native Claude review `cde67931-c1f9-4e6f-b033-7ba751a8c676` independently reran all 20 application tests, the local API assertion and browser navigation with screenshots. It found no unresolved issues and verified the diff contained only the endpoint, regression test and test command. Publication readiness was true; the harness did not execute publication.
- Separate real SDK probes navigated successfully and deliberately threw a browser automation error. Both Codex and Claude recorded navigation as successful and the throwing call as failed. These diagnostics were separate from feature acceptance and did not change source.

- Browser UI verification confirmed the approved scenario definitions, current and historical result tables, the rejected inspection row labeled **Evidence Incomplete**, tested commits and artifact paths. The evidence link selected the correct attempt in Logs. The isolated fixture log directory was not ingested into production OpenObserve, so that UI search had no indexed rows; native event JSON and frozen evidence archives were inspected separately. Screenshot: `.tmp/2026-10-24-acceptance/acceptance-passed.jpg`.

The disposable guest, fixture web process and temporary LaunchAgent were removed after verification. Copied provider secrets were removed from isolated data. The fixture publication job was canceled and its run retired; saved results, database and host evidence remain. Production credentials and the real ONE-5321 run were unchanged.

## Interpretation

Native tool completion and file existence establish execution and retained
artifacts. They do not independently prove business semantics or defeat a hostile
agent copying old content. Claude reviews assertions, observations and candidate
identity. Local fixtures and source inspection do not establish deployed behavior.
Unavailable services or credentials are blocked evidence, not authorization to
change production systems.

Optional optimizations and controls: none. Completeness and freshness checks are
the requested acceptance contract; existing preservation retry policy is unchanged.
