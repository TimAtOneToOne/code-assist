import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL(
    "../packages/browser-mcp/node_modules/@playwright/mcp/cli.js",
    import.meta.url,
  ),
);

// Managed repositories can require older Playwright browser revisions.
execFileSync(
  process.execPath,
  [cli, "install-browser", "chromium", "--no-remove"],
  { stdio: "inherit" },
);
