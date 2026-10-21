import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  cleanupReleases,
  protectedProcessReleases,
  releaseCleanupPlan,
} from "../release-cleanup.ts";

const names = [1, 2, 3, 4, 5, 6].map((n) => String(n).repeat(40));
function fixture() {
  const base = join(import.meta.dirname, "../../.tmp/release-cleanup/tests");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "case-"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "history"), "preserved");
  for (const [index, name] of names.entries()) {
    const path = join(root, "releases", name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "app"), name);
    utimesSync(path, new Date(1000 * index), new Date(1000 * index));
  }
  symlinkSync(join(root, "releases", names[5]), join(root, "current"));
  mkdirSync(join(root, "releases", ".build-unfinished"));
  symlinkSync(join(root, "data"), join(root, "releases", "a".repeat(40)));
  return root;
}
const healthy = async () => Response.json({ status: "ok", commit: names[5] });

test("retains current plus two prior releases and any older running versions", () => {
  const releases = names.map((name, modified) => ({ name, modified }));
  const plan = releaseCleanupPlan(releases, names[5], new Set([names[0]]));
  assert.deepEqual(plan.keep, [names[0], names[3], names[4], names[5]]);
  assert.deepEqual(plan.remove, [names[1], names[2]]);
  assert.deepEqual(
    releaseCleanupPlan(releases.slice(0, 2), names[1], new Set()).remove,
    [],
  );
  assert.throws(
    () => releaseCleanupPlan(releases, "unknown", new Set()),
    /Current release/,
  );
});
test("identifies separate web/worker releases, open agent files and explicit script paths", () => {
  const root = "/Application Support/CodeAssist";
  const listing = `p10\nn${root}/releases/${names[5]}/apps/web\np11\nn${root}/releases/${names[0]}\np12\nn${root}/releases/${names[1]}/bin/codex\n`;
  const commands = `node ${root}/releases/${names[2]}/ops/probe.ts`;
  const services = [
    { label: "web", pid: 10 },
    { label: "worker", pid: 11 },
  ];
  assert.deepEqual(
    [...protectedProcessReleases(root, listing, commands, services)].sort(),
    [names[0], names[1], names[2], names[5]],
  );
  assert.throws(
    () =>
      protectedProcessReleases(root, listing, commands, [
        { label: "worker", pid: 99 },
      ]),
    /cleanup skipped/,
  );
  assert.throws(
    () =>
      protectedProcessReleases(root, listing, commands, [
        { label: "worker", pid: 0 },
      ]),
    /cleanup skipped/,
  );
});
test("only deletes unused commit directories; data, staged builds, symlinks and repeat runs are safe", async () => {
  const root = fixture();
  try {
    const result = await cleanupReleases(
      root,
      names[5],
      () => new Set([names[0]]),
      healthy,
    );
    assert.deepEqual(result.removed, [names[1], names[2]]);
    assert.equal(readFileSync(join(root, "data/history"), "utf8"), "preserved");
    assert(readdirSync(join(root, "releases")).includes(".build-unfinished"));
    assert(readdirSync(join(root, "releases")).includes("a".repeat(40)));
    assert.deepEqual(
      (
        await cleanupReleases(
          root,
          names[5],
          () => new Set([names[0]]),
          healthy,
        )
      ).removed,
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("failed health, unknown process identity and a changed current release prevent deletion", async () => {
  const root = fixture();
  const before = readdirSync(join(root, "releases"));
  try {
    for (const response of [
      Response.json({ status: "error", commit: names[5] }, { status: 500 }),
      Response.json({ status: "ok", commit: names[4] }),
    ])
      await assert.rejects(
        cleanupReleases(
          root,
          names[5],
          () => new Set(),
          async () => response,
        ),
        /health check/,
      );
    await assert.rejects(
      cleanupReleases(
        root,
        names[5],
        () => {
          throw Error("process inspection unavailable");
        },
        healthy,
      ),
      /inspection/,
    );
    await assert.rejects(
      cleanupReleases(
        root,
        names[5],
        () => {
          unlinkSync(join(root, "current"));
          symlinkSync(join(root, "releases", names[4]), join(root, "current"));
          return new Set();
        },
        healthy,
      ),
      /Current release changed/,
    );
    assert.deepEqual(readdirSync(join(root, "releases")), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test(
  "macOS process inspection protects an actual process running from an older release",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = fixture();
    const child = spawn(
      process.execPath,
      ["-e", 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
      {
        cwd: join(root, "releases", names[0]),
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    try {
      await once(child.stdout!, "data");
      const listing = execFileSync(
        "/usr/sbin/lsof",
        ["-nP", "-p", String(child.pid), "-Fpn"],
        { encoding: "utf8" },
      );
      const running = protectedProcessReleases(root, listing, "", [
        { label: "fixture-worker", pid: child.pid! },
      ]);
      const result = await cleanupReleases(
        root,
        names[5],
        () => running,
        healthy,
      );
      assert(result.keep.includes(names[0]));
      assert.equal(
        readFileSync(join(root, "releases", names[0], "app"), "utf8"),
        names[0],
      );
    } finally {
      const exited = once(child, "exit");
      child.kill();
      await exited;
      rmSync(root, { recursive: true, force: true });
    }
  },
);
