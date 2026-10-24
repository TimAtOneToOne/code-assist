# Automatic Repository Onboarding Rehearsal

## Scope

October 23, 2026: exercised automatic setup gathering through the browser against an isolated candidate service on Mia. The fixture used a local Git archive of `web-app-test-repo` at `ac94e3dc5c4f0a282ea2a3508db96420dc8a99ee`, a separate PostgreSQL database, separate settings/secrets/log directories, and disposable OrbStack guests. The real ticket, source repository, and saved runtime profile were unchanged. No plan approval, implementation, GitHub publication, Linear write, or Teams notification was manufactured by the fixture.

The operator created only the isolated service, source copy, and synthetic ticket records. Repository selection was submitted through the actual browser form. The product then ran native Codex, validated its structured proposal, tested the configuration, saved it, and continued normal ticket discovery. The operator did not author setup commands or advance the discovery state to make the happy path pass.

## Verification

`make verify` passed all 86 unit tests, lint/format checks, type checks, and the production build. Ten PostgreSQL integration tests passed. The separately gated general OrbStack regression was not rerun; this rehearsal exercised actual provisioning, native browser readiness, application setup/validation/startup/readiness, and guest cleanup with a real generated profile.

New unit/database cases cover optional blank fields, malformed proposals, missing-information questions, failed tests, superseded inputs, multiple repositories, existing configurations, owner edits during scanning/testing, concurrent owner/background saves, interrupted candidate records, and setup answers returning to intake rather than prematurely starting planning. Planning-input assertions verify the saved commands and hash are present without environment values. Coding prompts expose the workspace's actual pinned validation commands.

## Accepted Run

The corrected setup test `d429b569-8516-4147-8643-e7aa15e88042` passed on local
fixture commit `54db7f70ba55fdf830bc9d4a40f5335fc6bfb250`. Codex selected
`npm ci`, `npm run db:push -- --force`, the existing test/lint/type/build checks,
a loopback development server, and readiness through `/notes`. Logs explicitly
show `drizzle-kit push --force` followed by `Changes applied`; this resolves the
earlier terminal-prompt false positive using the tool's native option.

Shared and repository-environment browser readiness, validation, app startup,
and database-backed readiness passed. The controller removed guest
`5fd9a5f0-1ff7-4ccc-aa62-3a84d58691ab` at 11:46:49 PM EDT. Discovery
`5e5cdcfa-6172-4578-9eff-c41febf759da` then reached ordinary scope confirmation.
The browser showed **Tested and Saved**, and the configuration page received
the generated fields. Second-ticket discovery
`21ecd655-6ff9-4a2a-b6e3-5a518a59f143` showed **Using Existing Setup**; exactly
one setup-test record exists for the two tickets. Both browser pages had no
captured warning/error console messages during acceptance.

## Evidence Boundaries

Passing setup verifies only the configured checks. Shared native browser navigation/click/screenshot proves browser readiness, not full application or authenticated acceptance. The test app has no repository-owned browser suite; the scan leaves its optional smoke-test fields empty rather than inventing one. This rehearsal does not repeat feature implementation, plan approval, code review, or PR publication.

The initial candidate UI was built without its test origin and correctly rejected a cross-origin POST. The fixture was rebuilt with `CODE_ASSIST_ORIGIN=http://100.91.0.83:3011`; no CSRF or owner checks were disabled. A missing root TypeScript configuration in the first fixture upload was corrected before rerunning the build. These were rehearsal provisioning corrections, not interventions in repository onboarding.

The first generated proposal passed, but review found unnecessary custom command aggregation and readiness timeout caps in its suggested scripts. The scan prompt now includes the existing saved global/planning/repository guidance and explicitly favors direct repository commands, existing job deadlines, and loopback service binds.

A second rehearsal exposed a substantive false positive: `drizzle-kit push` printed a TTY error but returned exit code zero, while a static-homepage readiness check passed without exercising SQLite. That run is retained as failed semantic acceptance despite its recorded configured-check pass. The prompt now explicitly requires unattended commands using supported native options for disposable local initialization, and readiness that exercises required dependencies. A fresh final rehearsal verifies schema application and the database-backed Notes route. No tool-error-text filter, custom Drizzle wrapper, dependency upgrade, or silent modification of the failed proposal was added.

Local evidence is retained under `.tmp/2026-10-23-repository-onboarding/`; remote fixture databases and host logs remain available for inspection. Disposable test guests are removed by the product.

Optional optimizations and controls: none. Coordination between owner and background settings writes protects the existing shared settings file; it adds no workflow approval, job concurrency limit, or retry policy.
