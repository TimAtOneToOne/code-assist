# Browser testing on Mia

Coding agents running as `miasocci` use the official [Microsoft Playwright MCP server](https://github.com/microsoft/playwright-mcp), registered as **`playwright`** in Codex CLI and Claude Code. It launches native headless Chromium on Mia, which can reach local applications and Tailscale URLs, including `http://100.91.0.83:3000`.

Each client starts its own server over stdio when needed. There is no listening MCP port or separate login service. `--isolated` gives each server a fresh browser profile; cookies and local storage disappear when the browser closes. This isolates browser state, not operating-system access or the applications being tested.

## Versions and deployment

`packages/browser-mcp/package.json` pins `@playwright/mcp` to **0.0.83**. Its upstream dependency pins Playwright to **1.64.0-alpha-1790635538000**, using Chromium revision **1247**. The root pnpm lockfile fixes the dependency graph.

Before release activation, `ops/install-browser.ts` runs the native `install-browser chromium --no-remove` command. Browser binaries live in `~/Library/Caches/ms-playwright`; installed revisions are reused. Older revisions remain available because managed repositories may require their own locked Playwright versions. This consumes additional disk space; no automatic browser cleanup is configured. Do not upgrade a managed repository's test tooling to match this MCP package.

## Client registration

Run on Mia as `miasocci`. The stable active-release path gives new sessions the deployed version:

```sh
NODE="$HOME/.nvm/versions/node/v24.22.0/bin/node"
MCP="$HOME/Library/Application Support/CodeAssist/current/packages/browser-mcp/node_modules/@playwright/mcp/cli.js"

"$HOME/.local/bin/codex" mcp add playwright -- \
  "$NODE" "$MCP" --headless --isolated --browser chromium \
  --output-dir .tmp/playwright-mcp

"$HOME/.local/bin/claude" mcp add --scope user --transport stdio playwright -- \
  "$NODE" "$MCP" --headless --isolated --browser chromium \
  --output-dir .tmp/playwright-mcp
```

[Codex](https://developers.openai.com/codex/mcp) stores its registration in `~/.codex/config.toml`; [Claude Code's user scope](https://code.claude.com/docs/en/mcp) lives in `~/.claude.json`. Unrelated MCP registrations remain intact. Start a new agent session after registration. Client permission policies still apply.

Inspect with `~/.local/bin/codex mcp get playwright --json` and `~/.local/bin/claude mcp get playwright`.

The future Code Assist SDK runner must explicitly supply this stdio server to both SDKs, particularly with an isolated HOME. Use the attempt's workspace as cwd and a distinct attempt output directory; do not share a server between attempts. SDK execution, interruption/recovery and browser evidence integration with central logs are not implemented yet.

## Agent usage

Start the target application's normal development/test server and give the agent its URL and workflow. Use `browser_navigate`, then `browser_snapshot` to inspect elements before clicking or typing. In this version, automatic snapshots from actions are file links; explicit `browser_snapshot` returns the snapshot inline. Element actions use the tool schema's `target` argument.

Use `browser_take_screenshot`, `browser_console_messages` and `browser_network_requests` for evidence and diagnostics. Finish with `browser_close`.

Automatically named evidence goes in `.tmp/playwright-mcp` relative to the server's cwd. Explicit filenames resolve against the workspace root, so supply paths under `.tmp/` too. Manual sessions in the same directory share that output directory, but not browser profiles. Evidence is gitignored in Code Assist; check each managed repository's ignore rules. Never commit browser authentication state.

## Verification

On Mia:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
cd "$HOME/Library/Application Support/CodeAssist/current"
make test-browser
```

The test uses native MCP calls to navigate Home → Logs, enter the service filter, capture a screenshot, read console/network diagnostics, and verify that two simultaneous clients do not share local storage. It closes both browsers and MCP clients. Evidence is in `.tmp/browser-mcp/integration-*`. `BROWSER_TEST_ORIGIN` can select another deployment of the same application.

`make verify` includes this package's lint and type checks. The live browser test is separate because it requires an installed browser and running application. This does not prove either model/SDK's complete managed-repository workflow or recovery from process interruption.

Optional optimizations and controls: none. Isolated profiles and retaining repository-compatible browser revisions implement the standalone brief; headless mode supports unattended execution on Mia.
