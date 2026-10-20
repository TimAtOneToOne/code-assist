# Mac mini deployment

The initial application is a SvelteKit shell in `apps/web`, generated with the official Svelte CLI and its Node adapter. It has Home, Configuration and `/health` routes. The durable worker, database integration, Linear intake and agent execution are not implemented yet.

## Development

Use Node 24 LTS and pnpm 10.28.0. The repository is a pnpm workspace; add future applications under `apps/`.

```sh
make install
make dev
make verify
```

`make verify` runs formatting checks, ESLint, Svelte/TypeScript checks and a production build. The root lockfile is used both locally and on Mia.

## Deployment and access

Target URL: **http://100.91.0.83:3000**. The server binds directly to Mia's Tailscale IPv4 address. It does not listen on all interfaces. Anyone whose tailnet permissions permit access to this address and port can view this empty shell; application authentication is not implemented. Establish Tim-only authorization before introducing private ticket content, configuration mutations or approval actions.

Runtime: native Node 24.22.0 at `~/.nvm/versions/node/v24.22.0/bin/node`, with pnpm 10.28.0 installed alongside it. Service definitions contain the absolute Node path and an explicit PATH. PostgreSQL and OrbStack are independent of this web deployment.

The installation is under `~/Library/Application Support/CodeAssist/`:

| Path | Purpose |
| --- | --- |
| `source.git/` | Bare Git repository used to fetch published `main` |
| `releases/<commit>/` | Source, locked dependencies and validated production build for an exact commit |
| `current` | Symlink to the active release |
| `logs/` | Web and updater stdout/stderr |

The installer, `ops/install.ts`, is run once as Mia's logged-in operating user using Node 24. It builds published `main` and registers two user LaunchAgents:

| Service | Behavior |
| --- | --- |
| `com.code-assist.web` | Starts at login; launchd keeps the web server running |
| `com.code-assist.updater` | Runs at login and checks `main` every 60 seconds |

The updater uses Mia's existing SSH GitHub identity. It installs frozen dependencies and runs `make verify` in a separate staging directory while the old web release stays up. Only a successful build becomes a release; activation replaces `current` atomically and restarts the web service. The page header, Configuration page and `/health` report the running commit. On subsequent passes, the updater checks that `/health` matches the active commit.

No public webhook or GitHub Actions runner is needed. A local commit must be pushed to `main` to be picked up. If several commits arrive between polls, the updater builds the head observed by its fetch. Failed builds leave the current release running; a later scheduled pass attempts the current head again. Logs record failures. The update process does not modify PostgreSQL, OrbStack data or any agent workspace.

## Inspection and recovery

On Mia:

```sh
launchctl print "gui/$(id -u)/com.code-assist.web"
launchctl print "gui/$(id -u)/com.code-assist.updater"
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

Older releases are retained. There is no automatic rollback or release cleanup. To roll back operationally, first unload the updater, then atomically point `current` to the chosen existing release and restart the web service. Fix `main` before re-enabling automatic updates. Runtime health failures are logged; successful compilation alone does not prove that a future release is healthy.

These are login services. A full reboot with FileVault and unattended recovery before login remain unverified. No worker exists yet, so this version restarts only the web app. Add the planned worker checkpoint/drain protocol before deploying long-running jobs through this mechanism.

Optional optimizations and controls: none. The requested automatic updater uses a documented 60-second polling interval and validates a release before activation.
