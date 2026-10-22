# Coding Workspaces

Repository workspace provisioning is implemented as a callable TypeScript module and an
operator CLI. The [coding worker](coding.md) uses this module to prepare an isolated
environment before implementation, validation and adversarial code review.

## Preparing a Workspace

Run from the deployed release on Mia with the service's operator-managed runtime
environment loaded, including `CODE_ASSIST_DATABASE_URL`, `CODE_ASSIST_DATA_DIR`,
`CODE_ASSIST_LOG_DIR`, and `CODE_ASSIST_ARTIFACT_DIR`:

```sh
pnpm --filter @code-assist/worker workspace prepare <issue-uuid>
pnpm --filter @code-assist/worker workspace status <workspace-uuid>
pnpm --filter @code-assist/worker workspace destroy <workspace-uuid>
```

Preparation requires the ticket's current, eligible, approved plan. It verifies
that the approval matches the current plan version, plan hash and input hash.
Saved [Repository Setup](repository-setup.md) profiles support additional repositories;
ICU, Companion, and Workplace Agents have built-in defaults. Each new workspace
pins its selected profile. All selected
repositories share a ticket-local guest for paired tests, while separate tickets
retain separate guests. Unknown repository profiles fail visibly.

Each invocation creates a new `ca-<workspace-uuid>` OrbStack Ubuntu 24.04 machine
with `--isolated --isolate-network`, a private Docker Engine from Docker's official
Ubuntu repository, and localhost publishing defaults. Docker Desktop is not used.
The native defaults are documented in [Docker's port publishing documentation](https://docs.docker.com/engine/network/port-publishing/).
These are defaults against accidental collisions, not a hostile-code boundary;
an explicit all-interface publish can override them, as accepted by Tim.

The provisioner archives the exact Git commit recorded during approved planning.
It leaves Mia's synced repository unchanged and installs the archive at
`/work/<repository>`. Source is initially an archive, not a branch or Git
worktree. Branch creation and change publication belong to the next coding stage.
Node 24.22.0 and pnpm 10.28.0 are installed in each machine. The repository's locked
dependencies and Playwright Chromium are installed using its own tooling.

## Environment and Services

The provisioner resolves each repository’s own saved [repository mappings](secrets.md#icu-coding-environment). ICU uses the settings below.
It then supplies the following attempt-owned settings, replacing any mappings for
these names so a shared database or storage destination cannot accidentally win:

| Settings | Attempt Value |
| --- | --- |
| `DATABASE_URL` | Guest loopback port 5435, database `local` |
| `TEST_DATABASE_URL`, `OAUTH_TOKEN_TEST_DATABASE_URL` | Guest loopback port 5435, separate database `icu_test` |
| `ORIGIN` | `http://localhost:5173` |
| `BETTER_AUTH_SECRET` | Fresh random 32-byte secret for this attempt |
| `AWS_REGION` | `us-east-1`, matching ICU's LocalStack setup |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | LocalStack `test` credentials |
| `AWS_SESSION_TOKEN` | Empty; no cloud session inherited |
| `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3` | Guest loopback port 4566 |
| `ICU_CHAT_ATTACHMENTS_BUCKET` | `icu-chat-attachments-local` in this attempt's LocalStack |

The database username/password match the repository's checked-in local Compose
configuration. Every attempt can use those same credentials, database names and
ports because it has its own machine and container engine.

The unchanged Compose file starts PostgreSQL and LocalStack. Preparation creates
the test database and runs ICU's migrations against the local application database.
LocalStack's repository-owned initialization creates the attachments bucket.

Workplace Agents uses its checked-in Compose PostgreSQL on loopback port 65432,
portal origin `http://localhost:6001`, and a fresh local Better Auth secret. Setup
uses root Makefile install/database/browser targets. Companion requires no
application services; its package build uses the guest’s zip utility. No Workplace
Agents cloud/provider credentials are imported automatically.

Values are delivered over stdin into `/work/environments/<repository>.json`, mode `0600`, in
the guest's private `/work` directory. No `.env` is added to the source tree, and
mapped secret values and generated values are not placed in the workspace manifest.
The manifest does retain compiled profiles, including literal Local Environment
Overrides. Those profiles are also written to the guest's root-owned, world-readable
`/etc/code-assist/profiles.json` (mode `0644`). Use secret mappings for credentials,
not Local Environment Overrides. `/work/run.mjs` loads the private environment JSON and
launches a command with the mapped/generated environment and explicit guest
PATH/HOME. It does not inherit the Code Assist controller's environment. For example:

```sh
orb -m ca-<workspace-uuid> -u workspace node /work/run.mjs --repo internal-chat-ui pnpm test
orb -m ca-<workspace-uuid> -u workspace node /work/run.mjs pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

Mapped values remain fixed for the lifetime of that workspace; subsequent secret
rotations are resolved when preparing another workspace. OAuth callbacks, external
provider calls, and SendGrid delivery have not been validated here. Local Medusa
URLs still require a separate Medusa service on guest port 8000.

## State, Logs, and Cleanup

`data/workspaces/<uuid>/workspace.json` records the machine, approved inputs,
variable names, compiled profiles and last preparation stage. State is `preparing`, `ready`, `failed`,
or `destroyed`. Stage and command-output logs use service `workspace` with the
workspace UUID as `attempt_id`. The approved inputs are checked again before the
workspace becomes ready.

The direct operator CLI runs provisioning outside pg-boss and has no automatic
restart or retry. Normal ticket preparation runs through the durable coding
worker; disposable setup tests use their own queue. After an interrupted CLI
operation, a record may remain `preparing`; inspect its machine, logs, ownership
and associated work before deciding how to recover. Failed coding workspaces
remain available for diagnosis; use the ticket's recovery actions for worker-owned
runs. Eligible Done runs have [automatic guest cleanup](coding.md#completed-workspace-cleanup)
after 24 hours, preserving host checkpoints and archived evidence.
The destroy command removes the exact recorded machine, including its environment,
containers and volumes, while retaining the manifest (including profile overrides) and logs. It does
not remove other machines or change the host's container configuration.

## Verification

The implementation is exercised against the approved ICU plan v3 and its recorded
commit `a2a7b9bdcb847f98ffbd57c9764b272bf01ed36f`. Two independent preparations on Mia
verified all fifteen mapped values without printing them, private environment-file
permissions, no inherited controller database URL, distinct session secrets and
PostgreSQL cluster identities, localhost container bindings, refused peer database
connections over IPv4 and IPv6, and separate LocalStack object contents. All 517
tracked source files matched the approved commit after preparation.

Both workspaces passed ICU's `lint`, `check`, `test`, and `build` commands with
the generated environment: 446 tests passed and three external OAuth smoke tests
were skipped in each. Chromium signed into a seeded synthetic account, opened its
own conversation, and verified a fresh browser context had no session or local
storage from the first context. Both reported zero page errors. Screenshots and
machine-readable results are kept locally under `.tmp/workspace-environment/`.
Both test machines were destroyed afterward using the provisioner's cleanup path.
Code Assist's `make verify` also passed.

Optional optimizations and controls: Tim requested and approved localhost container
publishing defaults to prevent accidental cross-attempt service access. They apply
only to these machines; direct access to published services from other machines
requires an explicit routing/binding decision. The initial provisioning proof did
not add automatic cleanup or retries. The subsequent coding workflow includes
requested [completed-workspace cleanup](coding.md#completed-workspace-cleanup) and
approved [checkpoint/evidence-collection retries](coding.md#recovery-and-publication).
No new controls are introduced by this documentation correction.
