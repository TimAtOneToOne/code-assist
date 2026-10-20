# Mac mini deployment

The web application is in `apps/web`, generated with the official Svelte CLI and its Node adapter. It has Home, Configuration, Mac mini settings, Logs and `/health` routes. The separate pg-boss process in `apps/worker` runs a durable confirmation probe against local PostgreSQL. See [worker operation and limits](worker.md) and [central logging](logging.md). Linear intake and agent execution are not implemented yet.

The shell uses shadcn-svelte Button, Card and Badge components installed through its CLI. AI Elements and AG-UI preferences are recorded in `AGENTS.md` for future agent/chat features.

## Development

Use Node 24 LTS and pnpm 10.28.0. The repository is a pnpm workspace; add future applications under `apps/`.

```sh
make install
make dev
make verify
```

`make verify` runs formatting checks, ESLint, Svelte/TypeScript checks, configuration persistence/validation tests and a production build. The root lockfile is used both locally and on Mia.

## Deployment and access

Target URL: **http://100.91.0.83:3000**. The server binds directly to Mia's Tailscale IPv4 address. It does not listen on all interfaces. The Home and application overview pages contain no private ticket content and remain visible to devices allowed to reach that address. The editable Mac mini settings page verifies the actual connection's peer using `tailscale whois` and requires an untagged device registered to the configured owner. Forwarded identity headers are not used.

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

## Mac mini settings

Open **http://100.91.0.83:3000/configuration/mac-mini** to edit the repository root. The initial value is `/Users/miasocci/CODE/repos/OnetoOneHealth`, the parent of the existing synced clones. Save checks that the supplied absolute path is a readable directory on Mia, then atomically replaces `data/mac-mini.json`. This setting locates source clones; it does not reconfigure the existing sync job, clone repositories, or designate those synced clones as mutable agent workspaces.

The production launcher loads `runtime.env` and sets `CODE_ASSIST_DATA_DIR` to the installation's `data/` directory. The owner ID was obtained from Mia's Tailscale lookup of Tim's connected computer. On a fresh installation, set `CODE_ASSIST_ADMIN_TAILSCALE_USER` to the verified owner's Tailscale user ID in `runtime.env` before accessing settings. Missing owner configuration or a failed identity lookup does not grant access. Keep the server bound directly to Tailscale; adding a proxy requires revisiting trusted peer identity.

Local development permits loopback access and uses the repository's gitignored `.tmp/local-web-data/` directory when `CODE_ASSIST_DATA_DIR` is unset. Production requires an explicit data directory.

## Login services and updates

Provision the local `code_assist` database and `runtime.env` before installation. The installer, `ops/install.ts`, is run once as Mia's logged-in operating user using Node 24. It builds published `main` and registers three user LaunchAgents:

| Service | Behavior |
| --- | --- |
| `com.code-assist.web` | Starts at login; launchd keeps the web server running |
| `com.code-assist.worker` | Starts at login; launchd keeps the pg-boss worker running |
| `com.code-assist.updater` | Runs at login and checks `main` every 60 seconds |

The updater uses Mia's existing SSH GitHub identity. It installs frozen dependencies and runs `make verify` in a separate staging directory while the old web release stays up. The checked-in observability installer applies container configuration before activation. Only a successful build becomes a release; activation replaces `current` atomically and restarts the web service. It signals the worker to drain its current step, exit and restart under launchd using the new release. The page header, Configuration page and `/health` report the web commit; worker startup/checkpoint logs report the worker commit. On subsequent passes, the updater checks that `/health` matches the active commit.

No public webhook or GitHub Actions runner is needed. A local commit must be pushed to `main` to be picked up. If several commits arrive between polls, the updater builds the head observed by its fetch. Failed builds leave the current release running; a later scheduled pass attempts the current head again. Logs record failures. Releases preserve database content, OrbStack data and workspace directories. Worker startup installs pg-boss's schema and the diagnostic tables; future dependency/schema upgrades require compatibility validation before publication.

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

Older releases are retained. There is no automatic rollback or release cleanup. To roll back operationally, first unload the updater, then atomically point `current` to a compatible existing release, restart the web service and signal the worker with `launchctl kill SIGTERM "gui/$(id -u)/com.code-assist.worker"`. Fix `main` before re-enabling automatic updates. Do not roll the worker back to a release without worker code, or reverse database state during code rollback. Runtime health failures are logged; successful compilation alone does not prove that a future release is healthy.

These are login services. A full reboot with FileVault and unattended recovery before login remain unverified. Worker draining currently covers the short SQL-only diagnostic workflow. Add and prove agent-process interruption, ownership and checkpoint recovery before deploying long-running agent work.

## Initial verification — October 19, 2026

- `make verify` passed locally and during the first production build on Mia.
- Home → Configuration navigation worked in Chrome on Tim's computer over Tailscale, with no browser warnings or errors observed.
- `/health` reported the exact deployed Git commit, and the process listened only on `100.91.0.83:3000`.
- After terminating the web process, launchd started a new process serving the same healthy release.
- The scheduled updater authenticated to GitHub and completed a check successfully from its own launchd context.
- An isolated deployment probe activated a successful fixture commit, then verified that a deliberately failing build left that active release unchanged. The probe used disposable local repositories and did not alter production.

Logging configuration choices are listed in [central logging](logging.md#configuration-review--october-20-2026). Original web deployment optional optimizations and controls: none. The requested automatic updater uses a documented 60-second polling interval and validates a release before activation.
