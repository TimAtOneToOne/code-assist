# Repository Setup

Open **Configuration → Repository Setup** to search synced repositories and edit their runtime profiles. The existing ICU, Workplace Agents, and Elation Companion profiles appear as built-in defaults until saved. Other repositories require their own commands; mapping secrets alone does not configure a repository.

## Fields

- **Working Directory:** relative to the repository; use `.` for its root.
- **Additional System Dependencies:** optional installation script, run as root inside the isolated OrbStack guest. The shared bootstrap already installs Node, pnpm, Git, Make, a PostgreSQL client, and a private container engine.
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

## Verification

`make verify` runs normal validation. Database integration coverage lives in `repository-setup.integration.ts`. To exercise real OrbStack provisioning, app startup, validation failure, and machine cleanup on Mia:

```sh
TEST_ORBSTACK=1 TEST_DATABASE_URL=<disposable-database-admin-url> \
  node --test packages/intake/tests/repository-workspace.integration.ts
```

The integration test creates and drops its own database and uses synthetic fixtures under `.tmp/`. Existing single- and multi-repository coding integration suites cover approval/checkpoint behavior alongside the new profile integration.

Optional optimizations and controls: none beyond the requested setup configuration/test lifecycle and existing job expiration and explicit retry behavior.
