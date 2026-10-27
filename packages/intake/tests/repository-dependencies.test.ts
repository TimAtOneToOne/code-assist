import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import {
  materializeDependencies,
  inspectRepositoryDependencies,
  dependencyPins,
} from "../src/repository-dependencies.ts";
import { bundleGitDependency } from "../src/workspace-git-dependencies.ts";

const git = (source: string, ...args: string[]) =>
  execFileSync("/usr/bin/git", ["-C", source, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function fixture() {
  const root = join(import.meta.dirname, "../../../.tmp/dependency-tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "sources-"));
  const repos = ["library", "nested"].map((name) => {
    const path = join(directory, name);
    mkdirSync(path);
    git(path, "init", "-b", "main");
    git(path, "config", "user.name", "Fixture");
    git(path, "config", "user.email", "fixture@example.invalid");
    git(
      path,
      "remote",
      "add",
      "origin",
      `https://github.com/Fixture/${name}.git`,
    );
    writeFileSync(join(path, "source.txt"), name);
    git(path, "add", "source.txt");
    git(path, "commit", "-m", "fixture");
    return { name, path, github: `Fixture/${name}` };
  });
  const nested = git(repos[1].path, "rev-parse", "HEAD");
  writeFileSync(
    join(repos[0].path, ".gitmodules"),
    '[submodule "included"]\npath = priv/included\nurl = ../nested.git\n',
  );
  git(repos[0].path, "add", ".gitmodules");
  git(
    repos[0].path,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${nested},priv/included`,
  );
  git(repos[0].path, "commit", "-m", "include nested library");
  const parent = git(repos[0].path, "rev-parse", "HEAD");
  writeFileSync(join(repos[0].path, ".env"), "PRIVATE_VALUE=not-exported");
  return {
    directory,
    repos,
    parent,
    nested,
    root: join(directory, "workspace", ".dependencies"),
  };
}

test("dependency inspection supplies exact parent and relative submodule sources without widening change scope", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  try {
    let calls = 0;
    const result = await inspectRepositoryDependencies(
      f.repos,
      f.root,
      signal,
      async (sources) => {
        calls++;
        if (calls === 1) assert.equal(sources.length, 0);
        else
          assert.deepEqual(
            sources.map((s) => s.commit),
            [f.parent, f.nested],
          );
        return {
          dependencies: [{ repository: "library", revision: f.parent }],
          questions: [],
        };
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.sources.length, 2);
    assert.deepEqual(result.pins, [
      { repository: "library", commits: [f.parent] },
      { repository: "nested", commits: [f.nested] },
    ]);
    for (const source of result.sources) {
      assert(!existsSync(join(source.directory, ".git")));
      assert(!existsSync(join(source.directory, ".env")));
      assert.equal(
        readFileSync(join(source.directory, "source.txt"), "utf8"),
        source.name,
      );
    }
    assert.equal(git(f.repos[0].path, "rev-parse", "HEAD"), f.parent);
    assert.equal(
      git(f.repos[0].path, "status", "--porcelain").includes("?? .env"),
      true,
    );

    // Exercise the same native local-copy Git path that Mix uses for submodules.
    const config = join(f.directory, "gitconfig");
    for (const source of result.sources) {
      const bundle = join(f.directory, `${source.name}.bundle`);
      const origin = await bundleGitDependency(
        source.source,
        [source.commit],
        bundle,
        f.directory,
        signal,
      );
      const target = join(f.directory, `${source.name}.git`);
      git(f.directory, "clone", "--bare", bundle, target);
      git(
        f.directory,
        "config",
        "--file",
        config,
        `url.file://${target}.insteadOf`,
        origin,
      );
    }
    git(
      f.directory,
      "config",
      "--file",
      config,
      "protocol.file.allow",
      "always",
    );
    const clone = join(f.directory, "installed");
    execFileSync(
      "/usr/bin/git",
      [
        "clone",
        "--recurse-submodules",
        "https://github.com/Fixture/library.git",
        clone,
      ],
      {
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: config,
          GIT_CONFIG_NOSYSTEM: "1",
        },
        stdio: "pipe",
      },
    );
    assert.equal(git(clone, "rev-parse", "HEAD"), f.parent);
    assert.equal(
      git(join(clone, "priv/included"), "rev-parse", "HEAD"),
      f.nested,
    );
    assert(!existsSync(join(clone, ".env")));
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("missing sources fail explicitly and later tickets resolve their own dependency versions", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  try {
    await assert.rejects(
      materializeDependencies(
        [{ repository: "../outside", revision: f.parent }],
        f.repos,
        f.root,
        signal,
      ),
      /not available/,
    );
    await assert.rejects(
      materializeDependencies(
        [{ repository: "library", revision: "--upload-pack=bad" }],
        f.repos,
        f.root,
        signal,
      ),
      /not a Git/,
    );
    await assert.rejects(
      materializeDependencies(
        [{ repository: "library", revision: f.parent }],
        [f.repos[0]],
        f.root,
        signal,
      ),
      /nested.*not in/,
    );
    const before = await materializeDependencies(
      [{ repository: "nested", revision: f.nested }],
      f.repos,
      f.root,
      signal,
    );
    writeFileSync(join(f.repos[1].path, "source.txt"), "new library version");
    git(f.repos[1].path, "commit", "-am", "new version");
    const next = git(f.repos[1].path, "rev-parse", "HEAD");
    const after = await materializeDependencies(
      [{ repository: "nested", revision: next }],
      f.repos,
      f.root,
      signal,
    );
    assert.deepEqual(dependencyPins(before), [
      { repository: "nested", commits: [f.nested] },
    ]);
    assert.deepEqual(dependencyPins(after), [
      { repository: "nested", commits: [next] },
    ]);
    assert.equal(
      readFileSync(join(before[0].directory, "source.txt"), "utf8"),
      "nested",
    );
    assert.equal(
      readFileSync(join(after[0].directory, "source.txt"), "utf8"),
      "new library version",
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test("missing commits and moving refs are fetched without switching the synced checkout", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  try {
    const source = f.repos[1];
    const remote = join(f.directory, "remote");
    git(f.directory, "clone", source.path, remote);
    git(remote, "config", "user.name", "Fixture");
    git(remote, "config", "user.email", "fixture@example.invalid");
    writeFileSync(join(remote, "source.txt"), "remote version");
    git(remote, "commit", "-am", "remote version");
    const commit = git(remote, "rev-parse", "HEAD");
    git(source.path, "remote", "set-url", "origin", remote);
    const resolved = await materializeDependencies(
      [{ repository: source.name, revision: commit }],
      f.repos,
      f.root,
      signal,
    );
    assert.equal(resolved[0].commit, commit);
    writeFileSync(join(remote, "source.txt"), "next remote version");
    git(remote, "commit", "-am", "next version");
    const next = git(remote, "rev-parse", "HEAD");
    const byBranch = await materializeDependencies(
      [{ repository: source.name, revision: "main" }],
      f.repos,
      f.root,
      signal,
    );
    assert.equal(byBranch[0].commit, next);
    assert.equal(git(source.path, "rev-parse", "HEAD"), f.nested);
    assert.equal(git(source.path, "status", "--porcelain"), "");
    assert.equal(
      git(source.path, "for-each-ref", "refs/code-assist/dependencies"),
      "",
    );
    await assert.rejects(
      materializeDependencies(
        [{ repository: source.name, revision: "missing-ref" }],
        f.repos,
        f.root,
        signal,
      ),
      /Mia could not retrieve nested/,
    );
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});
