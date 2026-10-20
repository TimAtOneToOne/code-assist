# code-assist

SvelteKit lives in `apps/web`; deployment tooling lives in `ops`. Use Node 24 LTS and pnpm 10.28.0.

```sh
make install
make dev
```

Run `make verify` before pushing. Mia checks published `main` once a minute, builds a separate release, and restarts the web app after validation succeeds.

- [Mac mini deployment](docs/deployment.md): installation, updates, service logs and recovery.
- [Central logging](docs/logging.md): attempt timelines, complete payloads, agent retrieval and storage configuration.
- [Browser testing](docs/browser-testing.md): Playwright MCP for coding agents on Mia, client setup and live verification.
- [Product brief](docs/initial/standalone-brief.md): durable ticket-to-PR workflow.
- [Implementation and deployment plan](docs/plans/plan_v1.md): SvelteKit, PostgreSQL worker, Tailscale access and automatic deployment from `main`.
- [Mac mini configuration](docs/mac-mini-configuration.md): hardware, local services, development tools, verification results, and remaining setup.
