# Mac mini deployment

The web application is in `apps/web`, generated with the official Svelte CLI and its Node adapter. It has Home, ticket workflows, Configuration, repository setup, prompts/models, AWS planning access, Secrets, Logs and `/health` routes. The separate pg-boss process in `apps/worker` runs intake, attention notifications, discovery, planning, coding, GitHub observation, repository setup tests, completed-workspace cleanup, and the diagnostic confirmation probe against local PostgreSQL. See [Current Status](current-status.md), [worker operation and limits](worker.md), and [central logging](logging.md).

The shell uses shadcn-svelte Button, Card and Badge components installed through its CLI. AI Elements and AG-UI preferences are recorded in `AGENTS.md` for future agent/chat features.

## Live Home Updates

Home subscribes to `/api/dashboard/events` using server-sent events, with the same Tailscale owner check as the page. PostgreSQL triggers notify the web process after dashboard source data commits; the browser reloads page data in place, preserving scroll and Paused Work preferences. No polling job is involved. Each open Home tab owns one database listener, released when the tab closes or navigates away. Native EventSource reconnection fetches the latest state again, including changes missed while disconnected. The existing Actions menu remains available for manual refreshes.

Worker initialization installs the triggers. The integration check is `TEST_DATABASE_URL=postgresql://localhost/postgres node --test packages/intake/tests/dashboard-events.integration.ts`; it creates and removes a disposable database and covers commit/rollback delivery, reconnect initialization and listener cleanup.

## Development

Use Node 24 LTS and pnpm 10.28.0. The repository is a pnpm workspace; add future applications under `apps/`.

```sh
make install
make dev
make verify
```

`make verify` runs formatting checks, ESLint, Svelte/TypeScript checks, configuration persistence/validation tests and a production build. The root lockfile is used both locally and on Mia.

## Deployment and access

Target URL: **http://100.91.0.83:3000**. The server binds directly to Mia's Tailscale IPv4 address. It does not listen on all interfaces. Home now contains private ticket content. Home, ticket pages and settings verify the actual connection's peer using `tailscale whois` and require an untagged device registered to the configured owner. Forwarded identity headers are not used.

Runtime: native Node 24.22.0 at `~/.nvm/versions/node/v24.22.0/bin/node`, with pnpm 10.28.0 installed alongside it. Service definitions contain the absolute Node path and an explicit PATH. PostgreSQL and OrbStack are independent of this web deployment.

The installation is under `~/Library/Application Support/CodeAssist/`:

| Path | Purpose |
| --- | --- |
| `source.git/` | Bare Git repository used to fetch published `main` |
| `releases/<commit>/` | Source, locked dependencies and validated production build for an exact commit |
| `current` | Symlink to the active release |
| `logs/` | Process output and structured events |
| `data/artifacts/` | Complete payloads outside releases |
| `data/observability/` | OpenObserve data and collector state |
| `observability.env` | Container credentials/storage settings; mode 600 |
| `runtime.env` | Operator-managed runtime settings, including `CODE_ASSIST_ADMIN_TAILSCALE_USER` and `CODE_ASSIST_DATABASE_URL`; mode 600, outside Git |
| `data/mac-mini.json` | Saved Mac mini configuration; preserved across releases |
| `data/intake.json` | Linear/attention secret references and polling interval |
| `data/models.json` | Operator-selected Codex and Claude model IDs for new agent steps |
| `data/execution.json` | Maximum parallel discoveries; defaults to 3; changes apply after active discoveries finish |
| `data/discovery/<attempt>/` | Captured repository commits, isolated Codex home and native session files |
| `data/secrets/store.json` | Shared secret values and repository mappings; mode 600 inside a mode 700 directory |
| `data/workspaces/<uuid>/workspace.json` | Preparation state, approved inputs and compiled runtime profiles, including literal environment overrides; excludes mapped secret and generated values |

## Mac mini settings

[Secrets & environment](secrets.md) provides shared secret management and repository-specific environment-variable mappings. Values live outside releases and are revealed only on request to the verified owner. The [repository workspace provisioner](workspaces.md) resolves those mappings into a private environment in each OrbStack machine; no repository `.env` files are rewritten. The [coding worker](coding.md) now prepares these workspaces for approved plans with supported repository profiles and runs implementation through reviewed PR publication.

Open **http://100.91.0.83:3000/configuration/mac-mini** to edit the repository root. The initial value is `/Users/miasocci/CODE/repos/OnetoOneHealth`, the parent of the existing synced clones. Save checks that the supplied absolute path is a readable directory on Mia, then atomically replaces `data/mac-mini.json`. This setting locates source clones; it does not reconfigure the existing sync job, clone repositories, or designate those synced clones as mutable agent workspaces.

The production launcher loads `runtime.env` and sets `CODE_ASSIST_DATA_DIR` to the installation's `data/` directory. The owner ID was obtained from Mia's Tailscale lookup of Tim's connected computer. On a fresh installation, set `CODE_ASSIST_ADMIN_TAILSCALE_USER` to the verified owner's Tailscale user ID in `runtime.env` before accessing settings. Missing owner configuration or a failed identity lookup does not grant access. Keep the server bound directly to Tailscale; adding a proxy requires revisiting trusted peer identity.

Local development permits loopback access and uses the repository's gitignored `.tmp/local-web-data/` directory when `CODE_ASSIST_DATA_DIR` is unset. Production requires an explicit data directory.

## Login services and updates

Before pushing Code Assist `main` or triggering any deployment/restart, inspect live pg-boss jobs, queued continuations, agent steps, and associated processes. Hold the change while work is active or cannot be verified. This applies to documentation-only pushes too. Worker recovery and draining do not replace the operator's immediate pre-deployment idle check; the updater itself does not implement that check.

### Deployment Status

Use the read-only operator command from the local repository:

```sh
make deploy-status
make deploy-status EXPECTED_COMMIT=<full-pushed-sha>
make deploy-status JSON=1
```

The first command is the immediate pre-push inspection. The second verifies the
expected release after publication. Each invocation makes one SSH connection to
Mia, using the existing local `.env` password configuration and strict SSH host-key
verification. Credentials are passed only through the child process environment.
On Mia, use `make deploy-status LOCAL=1` from the active release instead.

The collector reports the selected release, actual web and worker releases from
their launchd PIDs and working directories, web HTTP health, updater PID and last
exit code, and the updater's last fetched main commit. JSON also includes staging
directory names; an old staging directory alone does not establish an active build.
It reads current pg-boss jobs, including future-dated continuations, and current
unfinished discovery/planning/coding/setup steps in a read-only database snapshot.
Human waits are not active steps. Superseded historical steps alone do not establish
activity; their queued jobs and surviving processes are still inspected.

Host inspection checks service descendants and processes associated with the
installation's paths, excluding the collector itself and unrelated applications.
Running `ca-*` guests are inspected for active/starting/stopping `ca-step-*` systemd
units and recognizable agent/validation runners. Stopped guests are not contacted.
Normal guest services and the known setup preview service are not active agent work.
Raw process arguments, provider credentials, job payloads, and runtime configuration
values are omitted from the report. Failed commands retain a named Unknown check
while other evidence remains available.

**Idle** means all required inspections succeeded without observed work, deployment
activity, or release mismatches. **Busy** identifies observed activity or an expected
commit that has not reached every service. **Unknown** takes precedence when a check
fails or a service/release changes during inspection. Hold publication for Busy or
Unknown; the command never cancels work, reconciles state, or gates the updater.

For exact exit codes, run `node ops/deploy-status.ts --json`: `0` Idle, `1` Busy,
`2` Unknown. Supply `EXPECTED_COMMIT` as an environment variable. Make itself returns
`2` for any failed recipe, so automation using Make must inspect the JSON `status`.
The report includes collection start/end times and duration. It is a snapshot, not
a lock: work can start after inspection. Process recognition supplements durable
jobs and owned systemd units; it is not a general detector for arbitrary processes
deliberately detached outside those ownership mechanisms. HTTP health and matching
releases do not replace feature acceptance tests.

October 23, 2026: a temporary copy of the collector inspected Mia's six running
ticket guests and idle workflow in 484 ms, without deployment or service changes.
Fixture tests cover Busy/Unknown outcomes, unrelated processes, future continuations,
mixed releases, and credential-safe reporting. A PostgreSQL integration test proves
inspection preserves queued jobs and respects human waits and superseded history.
Check the deployed release for availability of the permanent command.

Optional optimizations and controls: none. This command implements Tim's requested
aggregation of the existing deployment checks, without a new schedule, retry policy,
cache, workload limit, or automatic deployment gate.

Provision the local `code_assist` database and `runtime.env` before installation. The installer, `ops/install.ts`, is run once as Mia's logged-in operating user using Node 24. It builds published `main` and registers three user LaunchAgents:

| Service | Behavior |
| --- | --- |
| `com.code-assist.web` | Starts at login; launchd keeps the web server running |
| `com.code-assist.worker` | Starts at login; launchd keeps the pg-boss worker running |
| `com.code-assist.updater` | Runs at login and checks `main` every 60 seconds |

The updater uses Mia's existing SSH GitHub identity. It installs frozen dependencies and runs `make verify` in a separate staging directory while the old web release stays up. Before activation, the browser installer ensures the pinned [Playwright MCP browser](browser-testing.md) is available, and the observability installer applies container configuration. Only a successful build becomes a release; activation replaces `current` atomically and restarts the web service. It signals the worker to drain its current step, exit and restart under launchd using the new release. The page header, Configuration page and `/health` report the web commit; worker startup/checkpoint logs report the worker commit. On subsequent passes, the updater checks that `/health` matches the active commit.

No public webhook or GitHub Actions runner is needed. A local commit must be pushed to `main` to be picked up. If several commits arrive between polls, the updater builds the head observed by its fetch. Failed builds leave the current release running; a later scheduled pass attempts the current head again. Logs record failures. Releases preserve database content, OrbStack data and workspace directories. Worker startup installs pg-boss’s schema and the diagnostic tables. Web startup also initializes the intake schema before serving requests, so additive intake migrations are ready for the new UI. Future dependency/schema upgrades require compatibility validation before publication.

## Inspection and recovery

On Mia:

```sh
launchctl print "gui/$(id -u)/com.code-assist.web"
launchctl print "gui/$(id -u)/com.code-assist.updater"
launchctl print "gui/$(id -u)/com.code-assist.worker"
curl --fail http://100.91.0.83:3000/health
tail -n 60 "$HOME/Library/Application Support/CodeAssist/logs/com.code-assist.updater.error.log"
```

To request an immediate deployment check, use launchd so it cannot overlap an already running updater:

```sh
launchctl kickstart "gui/$(id -u)/com.code-assist.updater"
```

To restart the web process:

```sh
launchctl kickstart -k "gui/$(id -u)/com.code-assist.web"
```

Release cleanup runs on the next scheduled updater pass after activation, once the web health check reports the expected commit. It keeps the current release, the two newest other built releases as rollback candidates, and every release referenced by a running process. The worker and updater use their exact release directories as their working directories so an older running version remains identifiable after `current` changes. Cleanup checks open files and process command lines, and skips deletion if it cannot identify the running web/worker releases. It only removes real, commit-named directories under `releases/`; unfinished builds, durable `data/`, logs, configuration, source clones and OrbStack machines are untouched. There is no automatic rollback. To roll back operationally, first unload the updater, then atomically point `current` to a compatible existing release, restart the web service and signal the worker with `launchctl kill SIGTERM "gui/$(id -u)/com.code-assist.worker"`. Fix `main` before re-enabling automatic updates. Do not roll the worker back to a release without worker code, or reverse database state during code rollback. Runtime health failures are logged; successful compilation alone does not prove that a future release is healthy.

These are login services. A full reboot with FileVault and unattended recovery before login remain unverified. Worker shutdown signals active agent/setup/cleanup handlers and unregisters all queue workers before closing pg-boss. Discovery and planning clean up owned subprocesses and checkpoint replacement work on graceful shutdown; coding uses guest unit ownership and saved stage results/checkpoints. Read [worker operation](worker.md), [discovery recovery](discovery.md#recovery-and-subprocess-ownership), and [coding recovery](coding.md#recovery-and-publication) before changing the process lifecycle. These recovery paths do not authorize deployment during active work.

## Initial verification — October 19, 2026

- `make verify` passed locally and during the first production build on Mia.
- Home → Configuration navigation worked in Chrome on Tim's computer over Tailscale, with no browser warnings or errors observed.
- `/health` reported the exact deployed Git commit, and the process listened only on `100.91.0.83:3000`.
- After terminating the web process, launchd started a new process serving the same healthy release.
- The scheduled updater authenticated to GitHub and completed a check successfully from its own launchd context.
- An isolated deployment probe activated a successful fixture commit, then verified that a deliberately failing build left that active release unchanged. The probe used disposable local repositories and did not alter production.

Logging configuration choices are listed in [central logging](logging.md#configuration-review--october-20-2026). Original web deployment optional optimizations and controls: none. The requested automatic updater uses a documented 60-second polling interval and validates a release before activation.

## Release Retention — October 21, 2026

Optional optimizations and controls: Tim requested automatic removal of unused deployment releases while retaining running versions and two prior releases. This reduces local rollback choices to those retained builds; older source commits remain in Git. Unknown process identity or a failed health check leaves releases intact. No ticket-data, log, workspace, or cache retention policy is changed.
