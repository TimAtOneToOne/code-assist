# Repository Setup

Open **Configuration → Repository Setup** to search synced repositories and edit their runtime profiles. The existing ICU, Workplace Agents, and Elation Companion profiles appear as built-in defaults until saved. Other repositories require their own commands; mapping secrets alone does not configure a repository.

## Automatic Setup During Intake

Confirming repositories on an eligible ticket starts setup gathering before ticket discovery. Each repository with an existing saved or built-in configuration reuses its setup commands, including intentionally blank optional fields. Every new discovery resolves private Git dependency versions from its pinned source before using that configuration. For an unconfigured repository, a read-only Codex session inspects its pinned source snapshot, dependency archives, instructions, manifests, Makefiles, tests, and GitHub workflows and returns structured setup fields with supporting findings. The controller supplies its Ubuntu release and native architecture. It follows that repository's conventions rather than creating a common CI pipeline.

The controller tests the proposed configuration against the same pinned commit in a disposable guest using the existing setup-test implementation. Only a passing proposal is saved for future tickets. The ticket shows Scanning Repository, Testing Setup, and Tested and Saved, with a link to the existing configuration and test history. A configuration saved by the owner during scanning or testing takes precedence. Failed proposals remain in test history and do not become the saved setup; inspect their logs, correct settings if needed, and retry discovery.

Missing essential information appears as setup questions on the ticket. **Save Answers and Continue Setup** starts another discovery attempt with those answers; it does not start planning or approve implementation. Add external credentials through Secrets and repository mappings, never in ticket answers. The scanning agent receives mapped variable names, not values. After setup succeeds, normal ticket discovery and explicit scope confirmation continue.

Setup scans also receive the full ticket so **What I Understand** can explain the
requested change in plain language and pseudocode before asking for help. This is
explicitly a preliminary understanding. A blocker explains what cannot run, what
is missing, and the concrete action needed. Questions avoid internal setup jargon;
exact dependency versions, commands and source references remain in **Supporting
Findings**. See [Explanation and Questions](discovery.md#explanation-and-questions).

Discovery records the effective configuration and its hash, withholding local environment values. Planning receives that recorded context and must reconcile the commands with the source, GitHub workflows, and proposed tests. Coding receives its workspace's actual pinned setup and validation commands. Later settings edits affect new workspaces, not existing ones; recorded planning context remains historical evidence, not a claim that a later configuration or candidate passed.

Automatic candidate tests run within the existing durable discovery job, with `discovery_id` on their test records; manual **Save and Test Setup** keeps its separate job. Worker restart marks interrupted candidate tests failed and cleans up their guests. Current-attempt checks prevent superseded discovery from accepting a proposal. There is no additional approval page, automatic workflow creation, or automatic retry loop for failed setup tests.

## Fields

- **Completion Rule:** Merged into Main completes after observing the PR merge into `main`; Successful Main Workflows also requires successful GitHub Actions push runs for that exact merge commit. Existing profiles default to Successful Main Workflows. Automatic setup discovery chooses from repository instructions and actual workflow triggers, asking when ambiguous. Discovery records the choice for planning and the approved coding run; change it before new discovery, not during an approved run. Both choices retain all implementation validation and acceptance requirements.

- **Working Directory:** relative to the repository; use `.` for its root.
- **Additional System Dependencies:** optional installation script, run as root inside the isolated OrbStack guest. The shared bootstrap already installs Node, pnpm, Git, Make, a PostgreSQL client, a private container engine, and the agent MCP browser with its Chromium system libraries.
- **Pinned Git Dependencies:** a JSON array of synced repository names and full commit hashes, for example `[{"repository":"gitops","commits":["41f4871cc6820b2f33b1c5d2089aae557779b541"]}]`. Automatic discovery resolves these from each ticket's manifests, lockfiles and build configuration, including recursive Git submodules. Missing versions are fetched through the configured host clone's existing Git access; tags and branches are resolved to exact commits. Missing catalog repositories or inaccessible versions produce explicit blockers. The controller exports Git bundles from synced clones. Native Git URL rewriting lets tools such as Mix and Terraform clone the pinned modules locally without guest GitHub credentials. Native file transport is enabled in dependency-equipped guests so Git can initialize local submodules. Bundles include the requested commits and their Git history, not untracked files, host Git configuration, hooks, or credentials. The guest copies are root-owned under `/opt/code-assist/dependencies`; they are dependency sources, not approved coding targets. When multiple selected repositories need the same dependency, its requested commits share one bundle. Each discovery records its resolved pins; coding uses those pins even if a saved setup still records an older library version. Legacy approvals retain their original setup behavior. Manually requested setup tests use the explicitly saved/proposed configuration.
- **Install and Service Setup:** install locked dependencies, start private services, apply local migrations, and prepare synthetic fixtures using repository-owned commands.
- **Validation Commands:** the repository's lint, type, test, and build checks. Required before the profile can be saved.
- **Playwright Package Directory / Browser Install Commands:** optional repository-relative directory for Chromium system dependencies and the command to install the repository's browser. The command runs from Working Directory.
- **App Startup / App Readiness Commands:** optional long-running app command plus a command that waits for it and fails if it cannot become ready. Startup runs in a guest systemd unit. Readiness commands should check the actual local app URL.
- **Browser / Sign-In Smoke Test:** the repository's real local end-to-end test. A successful build or HTTP response does not prove authentication works. This script runs after readiness, or manages its own server if startup is blank.
- **Local Environment Overrides:** JSON string values for private database destinations, local ports, and fixture configuration. Saved secret mappings are loaded first, then these overrides. Store provider credentials in Secrets & Environment.
- **Generate Fresh Values Per Workspace:** variable names that receive independent random 32-byte hex values, such as `BETTER_AUTH_SECRET`.
- **Instructions for Coding Agents:** repository-specific runtime guidance, included alongside the startup/readiness/smoke commands in coding prompts.

Scripts run through Bash with error/unset-variable checking. Additional System Dependencies and the provisioner's `playwright install-deps chromium` OS dependency step run as root inside the guest. Repository setup, browser binary installation, validation and app/smoke commands run as the workspace user through the same environment launcher used for coding. All execution happens in the isolated guest, including its private container engine; host repositories are read only to export the pinned Git commit.

## Test Setup

**Save and Test Setup** saves the form and queues a durable pg-boss job. It pins the saved profile and the synced repository's current HEAD, creates a disposable OrbStack machine, runs repository setup and the shared coding-runtime/browser installation, verifies real MCP navigation/click/screenshot as the workspace user (also with each repository’s environment), runs validation, then configured startup/readiness/smoke checks. It does not need a ticket plan approval, modify the host checkout, create a feature branch, run an agent, or publish a PR.

Results show the tested commit, whether the profile matches the current saved setup, each executed check (including shared and repository-environment browser readiness), omitted app/browser checks, failure stage, and a link to central workspace logs. **Refresh Results** fetches progress. The machine is deleted after success or failure; logs, profile snapshots, and result history remain. Guest-local files are removed with the machine. Cleanup failures have a **Retry Cleanup** action.

Tests use the coding workflow's one-hour job expiration and explicit retry approach. Worker interruption marks an active test failed, preserves its result, and cleans up its machine on restart. Select **Save and Test Setup** again to repeat a test using the saved form values. A passing result means the configured checks passed; it does not certify an omitted authentication flow or feature-specific acceptance tests.

## Coding Integration

Saved profiles live in `CODE_ASSIST_DATA_DIR/repository-setups.json` (mode 0600), keyed by the original synced repository path. New coding workspaces use them even when source is exported from a controller-owned checkpoint repository. The exact profile, including Local Environment Overrides, is retained in the workspace manifest and in the guest's root-owned, world-readable `/etc/code-assist/profiles.json` (mode 0644). Mapped secrets and generated environment values are stored separately in private environment files. Coding prompts and validation use this pinned profile, so editing settings does not change a running workspace. Existing workspaces created before profiles were saved retain their built-in behavior.

The setup-test records are in `code_assist.repository_setup_test`; the worker consumes `repository-setup-test`. Tests run the same provisioning function as coding, without fabricating a plan approval. Approved coding work still checks the current exact plan before and after provisioning.

## Current Ticket Repositories

The October 20 setup record covers saved profiles on Mia for these six repositories. This table is a dated configuration summary, not a fresh live inventory. Edit profiles in the UI; the saved configuration and each setup test's frozen copy are the source of truth.

| Repository          | Runtime and Local Services                                                      | Validation                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `internal-chat-ui`  | SvelteKit in `sveltekit`; PostgreSQL 5435, LocalStack 4566, app 5173            | Lint, Svelte checks, unit/component tests, build, startup and a real browser password-sign-in with a synthetic local account |
| `workplace-agents`  | Root Makefile; portal 6001, PostgreSQL 65432                                    | `make validate`, startup and Microsoft sign-in-page rendering                                                                |
| `elation_companion` | Unpacked Chrome extension                                                       | `bash ./build.sh`; paired browser acceptance belongs to the approved feature's tests                                         |
| `windmill-work`     | Elation Router 4178 and Windmill Catalog 4182; both apps and Chromium installed | Root lint/flow tests, `make app-check`, `make catalog-check` including browser/generated-bundle tests; app startup           |
| `windmill`          | Terraform 1.16.3, Python 3.12, uv, Ruff 0.14.0, actionlint 1.7.12, ShellCheck   | `make lint`, `make test`, backend-disabled Terraform validation and mocked tests; pinned GitOps dependencies                 |
| `medusa-api`        | Python 3.12/uv; private PostgreSQL 5433 and Valkey 6380; API 8000               | Non-mutating Ruff checks, mypy, `make test-all`; health/Swagger/OpenAPI checks                                               |

Medusa's development database is `fastapi`; tests must unset `OLIVE_DB_PASSWORD` and the explicit reader/writer URL overrides so `ENVIRONMENT=test` selects `fastapi_test`. Python dependencies live outside the source checkout. Mypy diagnostics remain informational, matching Medusa's Makefile; Ruff and pytest failures fail validation. Olive integration destinations are local; a full Olive schema and synthetic fixtures are separate from Medusa's own migrations.

ICU seeds `code-assist@example.invalid` in its private development database with a fresh `LOCAL_TEST_PASSWORD` per workspace. The browser uses the existing password sign-in form and verifies the resulting session; no session cookie is fabricated, and no verification email is sent. This local account has no Microsoft delegated permissions.

Microsoft credentials configure OAuth but do not provide a signed-in user. Sign-in-page checks do **not** establish authenticated UI readiness. Workplace Agents requires an interactive Microsoft session/test identity for that acceptance. Windmill Work's local browser suites use synthetic responses; hosted Windmill fork/Git Sync acceptance remains distinct and follows the approved feature's scope.

### Windmill Validation — October 20, 2026

The saved profile initializes Git metadata inside the disposable checkout so actionlint can discover workflows from the exported source archive. On synced commit `fb82b52baf51bd1668262e578b79c371e433ce9f`, lint, 24 Python tests, bootstrap/staging/production Terraform validation, and 21 mocked Terraform tests pass. Native Terraform module downloads resolve through the controller-fetched GitOps snapshots without guest GitHub credentials. No infrastructure was applied. See [the passing setup-test logs](http://100.91.0.83:3000/logs?attempt=81547254-a375-4f26-9903-cab824408e35).

Coding validation runs `TF_CLI_ARGS_init=-lockfile=readonly make validate`. Default Terraform initialization adds Linux ARM provider checksums to tracked lockfiles, which changes the candidate source during validation. Terraform's native read-only lockfile mode preserves checksum verification and keeps the candidate unchanged. This setting applies only to the validation command; intentional dependency updates during implementation remain possible.

The committed lockfiles must also contain the Linux ARM unpacked-provider checksums for subsequent `terraform validate` calls. Read-only initialization alone does not supply them. If they are missing, update them during implementation with native `terraform providers lock -platform=linux_arm64`, review/checkpoint the resulting lockfile changes, then validate the new candidate.

### Medusa Baseline Findings — October 20, 2026

On synced commit `eb8b6fbe5906b837dca8a6d303121423c640019d`, the isolated setup completes installation and migrations, and Ruff formatting/lint plus mypy pass. The full suite has **1,623 passing tests and two failing Linear credential tests**: `test_scope_mismatch_triggers_remint` and `test_near_expiry_triggers_remint` in `tests/app/api/v2/linear/test_credentials_db.py`. Both expect a second token mint but observe only one. These failures remain visible; the profile does not skip them. See [the final setup-test logs](http://100.91.0.83:3000/logs?attempt=83cf3a10-668a-4b73-b87a-58562b368f63).

A separate disposable [runtime probe](http://100.91.0.83:3000/logs?attempt=5499937a-c4d8-4a72-afda-4d55ddc8aacd) verifies startup plus `/health`, `/docs`, and `/openapi.json`. This proves basic runtime readiness, not authenticated Entra or full Olive integration. Both probe machines were removed afterward.

### Connect Setup — October 27, 2026

The first two dependency-equipped discovery attempts reached separate setup failures:
ONE-5370 proposed `workingDirectory: "connect"`, which incorrectly resolved to
`/work/connect/connect`; ONE-5371 reached 1,979 tests but failed 20 SAML tests because
Ubuntu 24.04 supplied xmlsec1 1.2.39 without the `--lax-key-search` option used by
Connect. Private Git dependencies and their submodules downloaded successfully.

The corrected shared profile uses `.` for the repository root and builds upstream
xmlsec1 1.3.12 with its required development libraries, verifying the release archive's
SHA-256 and checking the required CLI option. It retains Connect's full validation
commands. These are isolated environment settings, not changes to Connect's source
or permissions to modify dependency repositories.

The corrected profile passed on source `d79aa980a182d91166a53f94ccb958622fc1f02a`
in setup test `13c7ffc4-0d99-429d-bc1f-39844353c8c1`: 14 properties and 1,979 tests
with zero failures, compile/format/Credo/Dialyzer/unused-code checks, native MCP
browser readiness, application startup, and database-backed MDM health. The guest
was removed and the exact tested profile was saved on Mia. See the
[passing setup logs](http://100.91.0.83:3000/logs?attempt=b6916250-8835-4b38-a791-cc8f15754210).
This proves isolated setup readiness, not completion of either ticket or live
provider integration. The failed attempts remain in history.

## Verification

`make verify` runs normal validation. Database integration coverage lives in `repository-setup.integration.ts`. To exercise fresh OrbStack provisioning without a repository-specific browser installer, real MCP interaction, app startup, validation failure, a missing-browser failure caused by an environment override, and machine cleanup on Mia:

```sh
TEST_ORBSTACK=1 TEST_DATABASE_URL=<disposable-database-admin-url> \
  node --test packages/intake/tests/repository-workspace.integration.ts
```

The integration test creates and drops its own database and uses synthetic fixtures under `.tmp/`. Existing single- and multi-repository coding integration suites cover approval/checkpoint behavior alongside the new profile integration.

Optional optimizations and controls: none beyond the requested setup configuration/test lifecycle and existing job expiration and explicit retry behavior.
