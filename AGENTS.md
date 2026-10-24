# Repository Guidance for Agents

## Project Scope

Code Assist is a standalone application deployed to a Mac mini. Run the UI, controller, Codex SDK, Claude Agent SDK, database, workspaces, test services and browsers locally. Do not introduce AWS infrastructure or dependencies on Workplace Agents services. External integrations are Linear, GitHub, OpenAI, Anthropic, the configured Teams notification endpoint, Windmill test-fork publication, and Tim’s read-only AWS staging role for planning evidence. This AWS inspection capability does not move any Code Assist runtime or infrastructure into AWS.

Start with `docs/current-status.md`, then `docs/initial/README.md` and `docs/initial/standalone-brief.md`. Current Status maps implemented features, source files, and remaining verification gaps; use the relevant workflow guide for details. Update it and affected guides when behavior or verified delivery status changes, distinguishing source implementation from observed deployment and live acceptance. Preserve historical plans and dated run evidence. The interactive prototype in `docs/initial/index.html` is a visual reference with simulated data, not a backend implementation. Tim expanded intake on October 20, 2026 to multiple user-confirmed repositories per ticket. Prefill the searchable multi-select with suggestions; preserve saved choices. Tim approves plans and merges PRs. Done requires an observed merge into `main` and successful GitHub Actions push-to-main workflows for that exact merge commit. Separate production promotions are not part of this completion rule.

## Initial development and deployment

Tim authorized direct commits and pushes to `main` in this repository on October 19, 2026, until the initial application is working. This exception is specific to Code Assist; it does not authorize direct pushes in managed repositories or PR merges.

Build the observability application with SvelteKit and serve it from the Mia Mac mini over Tailscale. Changes published to Code Assist's `main` must be picked up and deployed automatically by the mini. Keep deployment releases separate from durable job state and agent workspaces.

## Check Mia Is Idle Before Deployment

- Before pushing to `main` or triggering a deployment/restart on Mia, check live pg-boss jobs, discovery/planning/coding steps, and any associated agent or validation processes for active work. Pushing to `main` triggers automatic deployment, including documentation-only changes.
- If work is active, keep changes local and wait until it finishes or reaches a stable state awaiting human input. A brief gap between steps with a queued continuation is not an idle workflow. Recheck immediately before pushing or deploying; an earlier check is not sufficient.
- Do not stop, cancel, or interrupt work to make room for a deployment. Do not assume worker draining or durable recovery makes deploying during active work acceptable. If activity cannot be verified, hold the push and explain the blocker to Tim.
- The worker service itself normally stays running; check whether it is executing work, not merely whether its process exists. This is an agent pre-deployment rule, not an automatic deployment lock implemented by the updater.

### Deployment Status Command

- Run `make deploy-status` from this repository immediately before each push or restart. It makes one SSH call to Mia using the entire local `.env` configuration (`MAC_MINI_USER` / `MAC_MINI_PSWD`) and preserves host-key verification. Do not recreate the checks with ad hoc SSH scripts.
- Require an **Idle** report. **Busy** includes running/queued jobs, continuations, current unfinished workflow steps, associated host/guest processes, an active updater, or releases that have not converged. **Unknown** means inspection was incomplete or changed during collection. Keep the change local for either result and inspect the reported reasons; never stop work to obtain Idle.
- After pushing, run `make deploy-status EXPECTED_COMMIT=<full-pushed-sha>` to verify the selected release, actual web and worker releases, and HTTP health all match. Use `JSON=1` for the complete structured report and evidence. The build target is the updater's last fetched main commit, not a fresh GitHub query.
- For machine-readable exit codes, call `EXPECTED_COMMIT=<sha> node ops/deploy-status.ts --json`: `0` = Idle, `1` = Busy / expected deployment pending, `2` = Unknown. GNU Make reports any failed recipe as exit `2`, so consumers of `make ... JSON=1` must read the JSON `status` field.
- On Mia itself use `make deploy-status LOCAL=1` from the active release, or run its `ops/deploy-status.ts --local` with the installed Node executable. The collector is read-only: it does not reconcile jobs, fetch Git, change configuration, or restart services. It inspects running `ca-*` guests and leaves stopped guests alone.
- The report records start/end times and is a fresh observation, not a deployment lock. Re-run it if anything intervenes before the push. The existing pre-deployment idle rule still applies. See `docs/deployment.md` for coverage and verification limits.

## GitOps Approval in Code Assist

Tim clarified on October 20, 2026 that Code Assist's exact-version plan approval
also satisfies prior review and approval for GitOps work described in that plan.
For the confirmed repositories and approved scope, it authorizes implementation,
branch creation, commits, pushes, and PR publication. Do not add a separate GitOps
approval checkpoint or create workarounds/technical debt solely to avoid GitOps
changes. This exception overrides generic separate-approval instructions only
inside the Code Assist workflow; other projects retain their existing rules.

Discovery and planning remain read-only. Scope changes require a revised plan
and approval, as with any repository. Tim reviews and merges PRs; agents never
merge, enable auto-merge, run Terraform apply, or initiate infrastructure deployment.
Human-initiated applies use the established deployment workflow.

## Guest Browser Readiness

- Setup tests and coding use the shared runtime installer in `packages/intake/src/workspace-runtime.ts`. It supplies the agent's Chromium system libraries, browser binary, and native MCP readiness probe; repositories do not need a special system installer for the agent's browser.
- **Save and Test Setup** verifies real MCP navigation/click/screenshot as the workspace user, including each repository's configured environment. Repository-owned browser suites and authenticated application acceptance remain separate. Readiness files under `/work/runtime-readiness` are not feature acceptance evidence.
- For provisioning changes, the fresh-guest success/missing-browser/validation-failure regression is documented in `docs/repository-setup.md`; normal `make verify` does not run OrbStack guests. See `docs/browser-testing.md` for runtime ownership and diagnostics.

## Temporary testing files

Keep ad hoc test scripts, probes, logs, screenshots, and other temporary testing artifacts in a task-specific directory under the repository's gitignored `.tmp/` folder. Configure temporary tooling to write generated files and caches there as well; do not leave them in the repository root. Keep permanent tests in their established source directories and use the normal Makefile targets for project validation.

## Programming language

TypeScript is the default programming language for new application, service, and automation code in this repository. Any exception that introduces or expands another programming language requires explicit approval from the owners listed in the repository-root `CODEOWNERS` file.

## UI and agent interaction preferences

- Prefer [shadcn-svelte](https://www.shadcn-svelte.com/) components for this SvelteKit application.
- Consider [Svelte AI Elements](https://svelte-ai-elements.vercel.app/components/context), including its Context component, when an actual agent-facing feature needs them.
- If building chat interfaces, prefer the [AG-UI protocol](https://docs.ag-ui.com/introduction) for agent/UI interaction.
- Tim requested these preferences on October 19, 2026. AI Elements and AG-UI are future options, not a requirement to install dependencies or build chat into the initial shell.

- Use Title Case for document titles, section headings, and UI titles (for example, “Adversarial Planning” and “Status and Evidence”). Keep ordinary prose in sentence case; preserve code identifiers and quoted/external titles.
