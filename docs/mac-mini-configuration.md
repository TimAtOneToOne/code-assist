# Mac mini configuration

Verified October 19, 2026. The Mia Mac mini is the intended local execution host for Code Assist. OrbStack and a fresh PostgreSQL 18 installation are running; the application runtime and repository validation still need to be built and proven. Product requirements remain in [the standalone brief](initial/standalone-brief.md).

This reference contains machine specifications and operational settings only. Login credentials, provider keys, tokens, and database connection secrets are excluded. Versions and disk availability are a dated snapshot.

## Hardware and access

| Item | Configuration |
| --- | --- |
| Processor | Apple M4, 10 logical CPUs |
| Architecture | ARM64 / Apple Silicon |
| Memory | 32 GiB |
| macOS | 26.6.2, build 25G83 |
| Internal SSD | APPLE SSD AP0256Z, 251.0 GB physical capacity |
| Main APFS container | Approximately 228 GiB |
| Data volume usage | Approximately 97 GiB used |
| Available storage | Approximately 108 GiB in the shared APFS pool |
| Remote access | Tailscale address `100.91.0.83`; SSH connectivity verified |

On AC power, system sleep and display sleep are disabled. Automatic restart after power failure is enabled. These settings do not establish that all services recover after a reboot; a full restart test remains outstanding.

## Startup at login

The following critical services are configured to start when the operating macOS user logs in:

| Service | Login startup | Verification |
| --- | --- | --- |
| OrbStack | Enabled through `app.start_at_login=true` | OrbStack reports `true`; macOS records its login item as enabled and allowed for the operating user |
| PostgreSQL 18 | Enabled through Homebrew's user LaunchAgent | `RunAtLoad=true`; `sh.brew.postgresql@18` is loaded and running |
| Tailscale | Enabled through its login helper | macOS records `io.tailscale.ipn.macsys.login-item-helper` as enabled and allowed; Tailscale reports `Running` |

OrbStack login startup was enabled at Tim's request on October 19, 2026. PostgreSQL and Tailscale already had their login startup registered. All three services were running after verification. These are login-start settings; unattended recovery before login and an actual logout/login or reboot cycle have not been tested.

To restore the OrbStack and PostgreSQL registrations if they are later disabled, run these commands as the operating macOS user:

```sh
/opt/homebrew/bin/orb config set app.start_at_login true
/opt/homebrew/bin/brew services start postgresql@18
```

## Container runtime

| Item | Configuration |
| --- | --- |
| Runtime | OrbStack 2.2.4 |
| State | Running |
| Active Docker context | `orbstack` |
| Docker client and server | 29.8.2 |
| Docker Compose | 5.5.0 |
| Docker Buildx | 0.37.2 |
| Engine name | `orbstack` |
| Engine resources reported | 10 CPUs and approximately 15.7 GiB memory; this is not measured consumption |
| Containers after testing | None |
| Start at login | Enabled; macOS login item registration verified |
| Docker socket | `~/.orbstack/run/docker.sock` |
| Compatibility socket | `/var/run/docker.sock` points to the OrbStack socket |
| Docker CLI | `/usr/local/bin/docker`, supplied by OrbStack |

Docker Desktop, its privileged helpers, and its local container data were removed. No Docker Desktop workloads or volumes were migrated. The `docker` command remains available through OrbStack. Compose and Buildx plugins point to OrbStack's bundled tools.

The Docker smoke test passed image building, Compose startup and health checks, HTTP access through a localhost port, a read-only host bind mount, container-to-container networking and service DNS, and named-volume persistence after container replacement. OrbStack's diagnostic check also passed. Test containers, the network, volume, generated image, and remote scratch files were removed.

## PostgreSQL

| Item | Configuration |
| --- | --- |
| Version | PostgreSQL 18.6, Homebrew package `postgresql@18` 18.6_1 |
| Installation | Native macOS service, separate from OrbStack |
| Service | Running; start at user login verified through `RunAtLoad=true` |
| Service definition | `~/Library/LaunchAgents/sh.brew.postgresql@18.plist` |
| Listener | `127.0.0.1:5432` and `[::1]:5432`; localhost only |
| Data directory | `/opt/homebrew/var/postgresql@18` |
| Executables | `/opt/homebrew/opt/postgresql@18/bin` |
| Locale and encoding | `en_US.UTF-8`, UTF-8 |
| Data checksums | Enabled |
| Authentication | Fresh `initdb` defaults: local connections use `trust` |
| Databases | `postgres`, `template0`, `template1` only |

PostgreSQL 16 was uninstalled. At Tim's direction, PostgreSQL 18 was then reinitialized from scratch: both former Hint Lite databases, migrated roles, old PostgreSQL 16 data, and the upgrade backup were deleted. There is no retained backup of those old databases. Only the local installation administrator and PostgreSQL's built-in roles remain.

The fresh instance passed a localhost connection check and a transactional create/insert/read test that was rolled back. The shell's PostgreSQL path now points to version 18.

## Development tools

| Tool | Observed installation |
| --- | --- |
| Homebrew | `/opt/homebrew/bin/brew` |
| Node.js | 25.1.0, through NVM at `~/.nvm/versions/node/v25.1.0/bin` |
| npm | 11.6.2 |
| pnpm | 10.20.0 |
| Codex CLI | Present at `~/.local/bin/codex` |
| Claude CLI | Present at `~/.local/bin/claude` |

Node and the agent CLIs are available in the interactive login shell. SSH commands and supervised services must use deliberate executable paths or an explicitly configured environment. CLI availability does not establish that either agent SDK can yet run a complete repository workflow.

## Routine inspection

Run these read-only checks on the mini. Some commands require the login-shell environment described above.

```sh
/opt/homebrew/bin/orb status
/opt/homebrew/bin/orb config get app.start_at_login
/opt/homebrew/bin/orb doctor --quiet </dev/null
/usr/local/bin/docker context show
/usr/local/bin/docker info
/usr/local/bin/docker compose version
/opt/homebrew/bin/brew services list
/opt/homebrew/opt/postgresql@18/bin/pg_isready -h 127.0.0.1 -p 5432
df -h /System/Volumes/Data
```

## Remaining setup and validation

- Test the configured login startup and recovery after logout, reboot, and power interruption, including whether manual login is needed before services become available.
- Select the first supported repository and prove its unchanged full validation, Docker services, and browser workflows through both SDKs.
- Prove isolation between two simultaneous workspaces, including databases, container resources, ports, and browser profiles.
- Choose supervision, persistent storage locations, and backup/restore for Code Assist. No ongoing database backup schedule was configured during this setup.
- Implement the application's access boundary. Tailscale and SSH access alone do not define authentication for the future web UI.

Optional optimizations and controls introduced by this documentation: none.
