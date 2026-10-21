import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { domain, origin, webLabel, workerLabel } from "./settings.ts";

const releaseName = /^[a-f0-9]{40}$/;
type Release = { name: string; modified: number };
function inspectProcess(command: string, args: string[]) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Process arguments can contain credentials; never log raw inspection output on failure.
    throw new Error("Process inspection failed; release cleanup skipped.");
  }
}
export function releasesInText(root: string, text: string) {
  const prefix = join(root, "releases") + "/";
  const found = new Set<string>();
  let offset = 0;
  while ((offset = text.indexOf(prefix, offset)) !== -1) {
    offset += prefix.length;
    const name = text.slice(offset, offset + 40);
    const next = text[offset + 40];
    if (releaseName.test(name) && (!next || /[\s/"']/.test(next)))
      found.add(name);
  }
  return found;
}
export function processReleaseReferences(root: string, listing: string) {
  const byPid = new Map<number, Set<string>>();
  let pid = 0;
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && pid) {
      const refs = byPid.get(pid) ?? new Set<string>();
      for (const name of releasesInText(root, line.slice(1))) refs.add(name);
      byPid.set(pid, refs);
    }
  }
  return byPid;
}
export function protectedProcessReleases(
  root: string,
  listing: string,
  commands: string,
  services: { label: string; pid: number }[],
) {
  const byPid = processReleaseReferences(root, listing);
  const running = new Set([...byPid.values()].flatMap((refs) => [...refs]));
  for (const { label, pid } of services) {
    if (!pid || !byPid.get(pid)?.size)
      throw new Error(
        `Cannot identify the running release for ${label}; release cleanup skipped.`,
      );
  }
  for (const name of releasesInText(root, commands)) running.add(name);
  return running;
}
export function runningReleases(root: string) {
  const listing = inspectProcess("/usr/sbin/lsof", [
    "-nP",
    "-u",
    String(process.getuid!()),
    "-Fpn",
  ]);
  const services = [webLabel, workerLabel].map((label) => {
    const state = inspectProcess("/bin/launchctl", [
      "print",
      `${domain}/${label}`,
    ]);
    const pid = Number(state.match(/^\s*pid = (\d+)$/m)?.[1]);
    return { label, pid };
  });
  // Script files may be closed after loading; also preserve explicit release paths in command lines.
  const commands = inspectProcess("/bin/ps", ["-axo", "command="]);
  const running = protectedProcessReleases(root, listing, commands, services);
  for (const name of releasesInText(root, fileURLToPath(import.meta.url)))
    running.add(name);
  return running;
}
export function releaseCleanupPlan(
  releases: Release[],
  current: string,
  running: Set<string>,
) {
  if (!releaseName.test(current) || !releases.some((r) => r.name === current))
    throw new Error(
      "Current release is not a regular release directory; cleanup skipped.",
    );
  const previous = [...releases]
    .filter((r) => r.name !== current)
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
    .slice(0, 2)
    .map((r) => r.name);
  const keep = new Set([current, ...previous, ...running]);
  return {
    keep: [...keep].sort(),
    remove: releases
      .filter((r) => !keep.has(r.name))
      .map((r) => r.name)
      .sort(),
  };
}
export async function cleanupReleases(
  installation: string,
  expected: string,
  inspect = runningReleases,
  health = () => fetch(`${origin}/health`),
) {
  const response = await health();
  const status = await response.json();
  if (!response.ok || status.status !== "ok" || status.commit !== expected)
    throw new Error(
      `Active release ${expected} did not pass its health check; release cleanup skipped.`,
    );
  const root = realpathSync(installation);
  const directory = join(root, "releases");
  function assertCurrent() {
    if (realpathSync(join(root, "current")) !== join(directory, expected))
      throw new Error("Current release changed during cleanup; stopping.");
  }
  assertCurrent();
  const releases = readdirSync(directory, { withFileTypes: true })
    .filter((e) => e.isDirectory() && releaseName.test(e.name))
    .map((e) => ({
      name: e.name,
      modified: lstatSync(join(directory, e.name)).mtimeMs,
    }));
  const plan = releaseCleanupPlan(releases, expected, inspect(root));
  const removed: string[] = [];
  for (const name of plan.remove) {
    assertCurrent();
    const path = join(directory, name);
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
      throw new Error("Release directory changed during cleanup; stopping.");
    rmSync(path, { recursive: true });
    removed.push(name);
    console.log(`${new Date().toISOString()} Removed unused release ${name}`);
  }
  if (removed.length)
    console.log(
      `${new Date().toISOString()} Release cleanup: removed ${removed.length}; retained ${plan.keep.join(", ")}`,
    );
  return { ...plan, removed };
}
