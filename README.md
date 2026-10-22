# Code Assist

Code Assist runs Linear ticket discovery, Codex planning and implementation, Claude review, validation, and guarded PR publication on Mia. Tim approves exact plan versions and merges PRs.

Start with [Current Status](docs/current-status.md) for the implemented workflow, code map, remaining gaps, and verification boundaries. Then read the [product requirements](docs/initial/standalone-brief.md) and the relevant workflow guide below. The original plan and prototype are historical references, not the current implementation checklist.

SvelteKit lives in `apps/web`; deployment tooling lives in `ops`. Use Node 24 LTS and pnpm 10.28.0.

```sh
make install
make dev
```

Run `make verify` before pushing. Mia checks published `main` once a minute, builds a separate release, and restarts the web app after validation succeeds. Activation also sends SIGTERM to the worker so launchd can restart it on the new release. Verify Mia is idle immediately before pushing, including documentation-only changes.

- [Mac mini deployment](docs/deployment.md): installation, updates, service logs and recovery.
- [Central logging](docs/logging.md): attempt timelines, complete payloads, agent retrieval and storage configuration.
- [Browser testing](docs/browser-testing.md): Playwright MCP for coding agents on Mia, client setup and live verification.
- [Repository Setup](docs/repository-setup.md): editable runtime profiles and disposable OrbStack setup tests.
- [Secrets and environments](docs/secrets.md): shared keys, Reveal/Hide and repository-specific environment-variable mappings.
- [Linear intake](docs/intake.md): scheduled Plan-ticket discovery, repository suggestions, human selection and attention notifications.
- [Initial discovery](docs/discovery.md): Codex investigations and confirmed answers.
- [Adversarial planning](docs/planning.md): versioned Codex plans, Claude reviews, feedback and exact-version approval.
- [Product brief](docs/initial/standalone-brief.md): durable ticket-to-PR workflow.
- [Coding workflow](docs/coding.md): isolated implementation, review, recovery, publication, requested changes, Windmill forks, and main-workflow completion.
- [Durable worker](docs/worker.md): queues, transaction boundaries, interruption and recovery.
- [Original implementation and deployment plan](docs/plans/plan_v1.md): preserved build-sequence reference; consult Current Status for delivery status.
- [Mac mini configuration](docs/mac-mini-configuration.md): hardware, local services, development tools, verification results, and remaining setup.
