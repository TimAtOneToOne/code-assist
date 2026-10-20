import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  domain,
  origin,
  pnpm,
  repository,
  root,
  webLabel,
  workerLabel,
} from "./settings.ts";

function run(command: string, args: string[], cwd = root) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CODE_ASSIST_ORIGIN: origin },
  });
}

function git(args: string[]) {
  return execFileSync(
    "/usr/bin/git",
    ["--git-dir", join(root, "source.git"), ...args],
    {
      encoding: "utf8",
    },
  ).trim();
}

export async function deploy(restart = true) {
  mkdirSync(join(root, "releases"), { recursive: true });
  mkdirSync(join(root, "logs"), { recursive: true });
  if (!existsSync(join(root, "source.git"))) {
    run("/usr/bin/git", ["init", "--bare", join(root, "source.git")]);
  }
  git(["fetch", repository, "refs/heads/main"]);
  const commit = git(["rev-parse", "FETCH_HEAD"]);
  const current = join(root, "current");
  const active = existsSync(current)
    ? basename(readlinkSync(current))
    : undefined;

  if (active === commit) {
    if (restart) {
      const response = await fetch(`${origin}/health`);
      const health = await response.json();
      if (!response.ok || health.status !== "ok" || health.commit !== commit) {
        throw new Error(
          `Active release ${commit} did not pass its health check`,
        );
      }
    }
    return;
  }

  const release = join(root, "releases", commit);
  if (!existsSync(release)) {
    const staging = mkdtempSync(join(root, "releases", ".build-"));
    try {
      const archive = join(staging, "source.tar");
      git(["archive", "--format=tar", `--output=${archive}`, commit]);
      run("/usr/bin/tar", ["-xf", archive, "-C", staging]);
      rmSync(archive);
      run(pnpm, ["install", "--frozen-lockfile"], staging);
      run("/usr/bin/make", ["verify"], staging);
      // Only a fully built release receives its permanent commit directory.
      renameSync(staging, release);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }

  run(
    process.execPath,
    [join(release, "ops/install-observability.ts")],
    release,
  );
  const next = join(root, "current.next");
  rmSync(next, { force: true });
  symlinkSync(release, next);
  renameSync(next, current);
  if (restart) {
    run("/bin/launchctl", ["kickstart", "-k", `${domain}/${webLabel}`]);
    // The worker drains its current step; launchd then starts the new release.
    run("/bin/launchctl", ["kill", "SIGTERM", `${domain}/${workerLabel}`]);
  }
  console.log(`${new Date().toISOString()} Activated ${commit}`);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await deploy();
}
