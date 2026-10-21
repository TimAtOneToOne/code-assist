# Repository Setup

Open **Configuration → Repository Setup** to search synced repositories and edit their runtime profiles. The existing ICU, Workplace Agents, and Elation Companion profiles appear as built-in defaults until saved. Other repositories require their own commands; mapping secrets alone does not configure a repository.

## Fields

- **Working Directory:** relative to the repository; use `.` for its root.
- **Additional System Dependencies:** optional installation script, run as root inside the isolated OrbStack guest. The shared bootstrap already installs Node, pnpm, Git, Make, a PostgreSQL client, and a private container engine.
- **Pinned Git Dependencies:** a JSON array of synced repository names and full commit hashes, for example `[{"repository":"gitops","commits":["41f4871cc6820b2f33b1c5d2089aae557779b541"]}]`. The controller exports Git bundles from sibling synced clones. Native Git URL rewriting lets tools such as Terraform clone the pinned modules locally without guest GitHub credentials. Bundles include the requested commits and their Git history, not untracked files, host Git configuration, hooks, or credentials. The guest copies are root-owned under `/opt/code-assist/dependencies`; they are dependency sources, not approved coding targets. When multiple selected repositories need the same dependency, its requested commits share one bundle. Missing commits fail setup explicitly; sync the source clone and update the pins when requirements change.
- **Install and Service Setup:** install locked dependencies, start private services, apply local migrations, and prepare synthetic fixtures using repository-owned commands.
- **Validation Commands:** the repository's lint, type, test, and build checks. Required before the profile can be saved.
- **Playwright Package Directory / Browser Install Commands:** optional repository-relative directory for Chromium system dependencies and the command to install the repository's browser. The command runs from Working Directory.
- **App Startup / App Readiness Commands:** optional long-running app command plus a command that waits for it and fails if it cannot become ready. Startup runs in a guest systemd unit. Readiness commands should check the actual local app URL.
- **Browser / Sign-In Smoke Test:** the repository's real local end-to-end test. A successful build or HTTP response does not prove authentication works. This script runs after readiness, or manages its own server if startup is blank.
- **Local Environment Overrides:** JSON string values for private database destinations, local ports, and fixture configuration. Saved secret mappings are loaded first, then these overrides. Store provider credentials in Secrets & Environment.
- **Generate Fresh Values Per Workspace:** variable names that receive independent random 32-byte hex values, such as `BETTER_AUTH_SECRET`.
- **Instructions for Coding Agents:** repository-specific runtime guidance, included alongside the startup/readiness/smoke commands in coding prompts.

Scripts run through Bash with error/unset-variable checking. Commands other than Additional System Dependencies run as the workspace user through the same environment launcher used for coding. All execution happens in the isolated guest, including its private container engine; host repositories are read only to export the pinned Git commit.

## Test Setup

**Save and Test Setup** saves the form and queues a durable pg-boss job. It pins the saved profile and the synced repository's current HEAD, creates a disposable OrbStack machine, runs setup/browser installation and validation, then configured startup/readiness/smoke checks. It does not need a ticket plan approval, modify the host checkout, create a feature branch, run an agent, or publish a PR.

Results show the tested commit, whether the profile matches the current saved setup, each executed check, omitted app/browser checks, failure stage, and a link to central workspace logs. **Refresh Results** fetches progress. The machine is deleted after success or failure; logs, profile snapshots, and result history remain. Guest-local files are removed with the machine. Cleanup failures have a **Retry Cleanup** action.

Tests use the coding workflow's one-hour job expiration and explicit retry approach. Worker interruption marks an active test failed, preserves its result, and cleans up its machine on restart. Run Test Setup again to repeat a test. A passing result means the configured checks passed; it does not certify an omitted authentication flow or feature-specific acceptance tests.

## Coding Integration

Saved profiles live in `CODE_ASSIST_DATA_DIR/repository-setups.json` (mode 0600), keyed by the original synced repository path. New coding workspaces use them even when source is exported from a controller-owned checkpoint repository. The exact profile is retained in the workspace manifest and in the guest's root-owned `/etc/code-assist/profiles.json`. Coding prompts and validation use this pinned profile, so editing settings does not change a running workspace. Existing workspaces created before profiles were saved retain their built-in behavior.

The setup-test records are in `code_assist.repository_setup_test`; the worker consumes `repository-setup-test`. Tests run the same provisioning function as coding, without fabricating a plan approval. Approved coding work still checks the current exact plan before and after provisioning.

## Current Ticket Repositories

Profiles are saved on Mia for the six repositories selected across the current ticket set. Edit them in the UI; the saved configuration and each setup test's frozen copy are the source of truth.

| Repository | Runtime and Local Services | Validation |
| --- | --- | --- |
| `internal-chat-ui` | SvelteKit in `sveltekit`; PostgreSQL 5435, LocalStack 4566, app 5173 | Lint, Svelte checks, unit/component tests, build, startup and a real browser password-sign-in with a synthetic local account |
| `workplace-agents` | Root Makefile; portal 6001, PostgreSQL 65432 | `make validate`, startup and Microsoft sign-in-page rendering |
| `elation_companion` | Unpacked Chrome extension | `bash ./build.sh`; paired browser acceptance belongs to the approved feature's tests |
| `windmill-work` | Elation Router 4178 and Windmill Catalog 4182; both apps and Chromium installed | Root lint/flow tests, `make app-check`, `make catalog-check` including browser/generated-bundle tests; app startup |
| `windmill` | Terraform 1.16.3, Python 3.12, uv, Ruff 0.14.0, actionlint 1.7.12, ShellCheck | `make lint`, `make test`, backend-disabled Terraform validation and mocked tests; pinned GitOps dependencies |
| `medusa-api` | Python 3.12/uv; private PostgreSQL 5433 and Valkey 6380; API 8000 | Non-mutating Ruff checks, mypy, `make test-all`; health/Swagger/OpenAPI checks |

Medusa's development database is `fastapi`; tests must unset `OLIVE_DB_PASSWORD` and the explicit reader/writer URL overrides so `ENVIRONMENT=test` selects `fastapi_test`. Python dependencies live outside the source checkout. Mypy diagnostics remain informational, matching Medusa's Makefile; Ruff and pytest failures fail validation. Olive integration destinations are local; a full Olive schema and synthetic fixtures are separate from Medusa's own migrations.

ICU seeds `code-assist@example.invalid` in its private development database with a fresh `LOCAL_TEST_PASSWORD` per workspace. The browser uses the existing password sign-in form and verifies the resulting session; no session cookie is fabricated, and no verification email is sent. This local account has no Microsoft delegated permissions.

Microsoft credentials configure OAuth but do not provide a signed-in user. Sign-in-page checks do **not** establish authenticated UI readiness. Workplace Agents requires an interactive Microsoft session/test identity for that acceptance. Windmill Work's local browser suites use synthetic responses; hosted Windmill fork/Git Sync acceptance remains distinct and follows the approved feature's scope.

### Windmill Validation — October 20, 2026

The saved profile initializes Git metadata inside the disposable checkout so actionlint can discover workflows from the exported source archive. On synced commit `fb82b52baf51bd1668262e578b79c371e433ce9f`, lint, 24 Python tests, bootstrap/staging/production Terraform validation, and 21 mocked Terraform tests pass. Native Terraform module downloads resolve through the controller-fetched GitOps snapshots without guest GitHub credentials. No infrastructure was applied. See [the passing setup-test logs](http://100.91.0.83:3000/logs?attempt=81547254-a375-4f26-9903-cab824408e35).

### Medusa Baseline Findings — October 20, 2026

On synced commit `eb8b6fbe5906b837dca8a6d303121423c640019d`, the isolated setup completes installation and migrations, and Ruff formatting/lint plus mypy pass. The full suite has **1,623 passing tests and two failing Linear credential tests**: `test_scope_mismatch_triggers_remint` and `test_near_expiry_triggers_remint` in `tests/app/api/v2/linear/test_credentials_db.py`. Both expect a second token mint but observe only one. These failures remain visible; the profile does not skip them. See [the final setup-test logs](http://100.91.0.83:3000/logs?attempt=83cf3a10-668a-4b73-b87a-58562b368f63).

A separate disposable [runtime probe](http://100.91.0.83:3000/logs?attempt=5499937a-c4d8-4a72-afda-4d55ddc8aacd) verifies startup plus `/health`, `/docs`, and `/openapi.json`. This proves basic runtime readiness, not authenticated Entra or full Olive integration. Both probe machines were removed afterward.

## Verification

`make verify` runs normal validation. Database integration coverage lives in `repository-setup.integration.ts`. To exercise real OrbStack provisioning, app startup, validation failure, and machine cleanup on Mia:

```sh
TEST_ORBSTACK=1 TEST_DATABASE_URL=<disposable-database-admin-url> \
  node --test packages/intake/tests/repository-workspace.integration.ts
```

The integration test creates and drops its own database and uses synthetic fixtures under `.tmp/`. Existing single- and multi-repository coding integration suites cover approval/checkpoint behavior alongside the new profile integration.

Optional optimizations and controls: none beyond the requested setup configuration/test lifecycle and existing job expiration and explicit retry behavior.
