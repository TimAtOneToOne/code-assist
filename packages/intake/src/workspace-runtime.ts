import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

type GuestCommand = (
  args: string[],
  input?: string | Readable,
) => Promise<unknown>;

export async function verifyGuestBrowser(guest: GuestCommand) {
  await guest([
    "node",
    "/opt/code-assist/packages/browser-mcp/src/readiness.ts",
  ]);
}

// Shared by disposable setup tests and coding workspaces, including runtime upgrades.
export async function ensureGuestRuntime(
  temporaryDirectory: string,
  root: GuestCommand,
  guest: GuestCommand,
  signal: AbortSignal,
) {
  const release = process.env.CODE_ASSIST_COMMIT ?? "development";
  const installed = await root([
    "bash",
    "-c",
    "if test -f /opt/code-assist/release; then cat /opt/code-assist/release; fi",
  ]);
  if (String(installed).trim() === release) return false;
  await mkdir(temporaryDirectory, { recursive: true });
  const archive = join(temporaryDirectory, "runtime.tar");
  try {
    await promisify(execFile)(
      "/usr/bin/tar",
      [
        "--exclude=node_modules",
        "--exclude=.tmp",
        "-cf",
        archive,
        "-C",
        fileURLToPath(new URL("../../../", import.meta.url)),
        "packages",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
      ],
      { signal },
    );
    await root(["mkdir", "-p", "/opt/code-assist"]);
    await root(
      ["tar", "-xf", "-", "-C", "/opt/code-assist"],
      createReadStream(archive),
    );
  } finally {
    await rm(archive, { force: true });
  }
  await root([
    "bash",
    "-c",
    "cd /opt/code-assist && pnpm install --frozen-lockfile --filter @code-assist/intake... --filter @code-assist/browser-mcp",
  ]);
  await root([
    "bash",
    "-c",
    "cd /opt/code-assist/packages/browser-mcp && pnpm exec playwright install-deps chromium",
  ]);
  await guest([
    "bash",
    "-c",
    "cd /opt/code-assist/packages/browser-mcp && pnpm exec playwright-mcp install-browser chromium",
  ]);
  await guest(["mkdir", "-p", "/work/evidence", "/work/logs"]);
  await verifyGuestBrowser(guest);
  // A failed install or browser check must not mark the release as ready.
  await root(["bash", "-c", "cat > /opt/code-assist/release"], release);
  return true;
}
