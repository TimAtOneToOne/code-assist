# Repository Guidance for Agents

## Project Scope

Code Assist is a standalone application deployed to a Mac mini. Run the UI, controller, Codex SDK, Claude Agent SDK, database, workspaces, test services and browsers locally. Do not introduce AWS infrastructure or dependencies on Workplace Agents services. External integrations are Linear, GitHub, OpenAI, Anthropic and the configured Teams notification endpoint.

Start with `docs/initial/README.md` and `docs/initial/standalone-brief.md`. The interactive prototype in `docs/initial/index.html` is a visual reference with simulated data, not a backend implementation. Keep the first release to one user-selected repository per ticket; Tim approves plans and merges PRs. An observed merge means Done.

## Initial development and deployment

Tim authorized direct commits and pushes to `main` in this repository on October 19, 2026, until the initial application is working. This exception is specific to Code Assist; it does not authorize direct pushes in managed repositories or PR merges.

Build the observability application with SvelteKit and serve it from the Mia Mac mini over Tailscale. Changes published to Code Assist's `main` must be picked up and deployed automatically by the mini. Keep deployment releases separate from durable job state and agent workspaces.

## Temporary testing files

Keep ad hoc test scripts, probes, logs, screenshots, and other temporary testing artifacts in a task-specific directory under the repository's gitignored `.tmp/` folder. Configure temporary tooling to write generated files and caches there as well; do not leave them in the repository root. Keep permanent tests in their established source directories and use the normal Makefile targets for project validation.

## Programming language

TypeScript is the default programming language for new application, service, and automation code in this repository. Any exception that introduces or expands another programming language requires explicit approval from the owners listed in the repository-root `CODEOWNERS` file.

## UI and agent interaction preferences

- Prefer [shadcn-svelte](https://www.shadcn-svelte.com/) components for this SvelteKit application.
- Consider [Svelte AI Elements](https://svelte-ai-elements.vercel.app/components/context), including its Context component, when an actual agent-facing feature needs them.
- If building chat interfaces, prefer the [AG-UI protocol](https://docs.ag-ui.com/introduction) for agent/UI interaction.
- Tim requested these preferences on October 19, 2026. AI Elements and AG-UI are future options, not a requirement to install dependencies or build chat into the initial shell.
