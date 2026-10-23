import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  collectDeploymentStatus,
  formatDeploymentStatus,
  parseService,
  statusExitCode,
} from "../deployment-status.ts";
import {
  hostActivity,
  guestActivity,
  processRows,
} from "../deployment-processes.ts";
import { statusOptions } from "../deploy-status.ts";

const commit = "a".repeat(40);
const old = "b".repeat(40);
const service = (pid: number | null, exit = 0) =>
  `\tstate = ${pid ? "running" : "not running"}\n${pid ? `\tpid = ${pid}\n` : ""}\tlast exit code = ${exit}\n\t\tstate = active\n`;

function fixture() {
  const base = join(
    import.meta.dirname,
    "../../.tmp/2026-10-23-deploy-status/tests",
  );
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "installation-"));
  mkdirSync(join(root, "releases", commit), { recursive: true });
  symlinkSync(join(root, "releases", commit), join(root, "current"));
  writeFileSync(
    join(root, "runtime.env"),
    'CODE_ASSIST_DATABASE_URL="postgresql://fixture-secret@localhost/db"\n',
  );
  const calls: string[] = [];
  const execute = (command: string, args: string[]) => {
    const call = [command, ...args].join(" ");
    calls.push(call);
    if (command.endsWith("git")) return commit;
    if (command.endsWith("launchctl"))
      return service(
        call.endsWith(".web") ? 10 : call.endsWith(".worker") ? 11 : null,
      );
    if (command.endsWith("lsof"))
      return `p10\nn${root}/releases/${commit}/apps/web\np11\nn${root}/releases/${commit}\np99\nn${root}/releases/${commit}\n`;
    if (command.endsWith("ps"))
      return "10 1 node web\n11 1 node worker\n99 1 node status\n100 99 ps\n";
    if (args[0] === "list")
      return JSON.stringify([
        { name: "ca-fixture", state: "running" },
        { name: "ca-stopped", state: "stopped" },
        { name: "unrelated", state: "running" },
      ]);
    if (args[4] === "systemctl") return "";
    if (args[4] === "ps")
      return "1 0 /sbin/init\n20 1 /usr/bin/postgres\n21 1 node server.js\n";
    throw new Error("Unexpected command: " + call);
  };
  const activity = async () => ({ jobs: [], steps: [] });
  const health = async () => Response.json({ status: "ok", commit });
  return {
    root,
    calls,
    deps: { execute, activity, health, inspectorPid: 99 },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("one report verifies releases, health, idle services and guests without starting stopped guests", async () => {
  const f = fixture();
  try {
    const report = await collectDeploymentStatus(f.root, commit, f.deps);
    assert.equal(report.status, "idle", JSON.stringify(report));
    assert.equal(statusExitCode(report), 0);
    assert(
      report.checks.some(
        (c) => c.name === "Expected Commit" && c.status === "idle",
      ),
    );
    assert(
      !f.calls.some(
        (c) => c.includes("-m ca-stopped") || c.includes("-m unrelated"),
      ),
    );
    assert(!JSON.stringify(report).includes("fixture-secret"));
    assert.match(formatDeploymentStatus(report), /Deployment Status: IDLE/);
    assert(report.checkedAt >= report.startedAt);
  } finally {
    f.dispose();
  }
});

test("queued continuations and active steps block even with no agent process", async () => {
  const f = fixture();
  try {
    for (const state of [
      {
        jobs: [
          {
            id: "job",
            name: "approved-coding",
            state: "retry",
            start_after: new Date(Date.now() + 86400000),
          },
        ],
        steps: [],
      },
      {
        jobs: [],
        steps: [
          { phase: "coding", id: "step", status: "running", worker_pid: 11 },
        ],
      },
    ]) {
      const report = await collectDeploymentStatus(f.root, null, {
        ...f.deps,
        activity: async () => state,
      });
      assert.equal(report.status, "busy");
      assert.equal(statusExitCode(report), 1);
    }
  } finally {
    f.dispose();
  }
});

test("host ownership excludes unrelated agents and the inspector but includes detached work and worker descendants", () => {
  const root = "/Application Support/CodeAssist";
  const rows = processRows(
    "10 1 node worker\n20 10 node runner --secret=never-print\n21 1 codex\n22 1 claude\n99 1 node status\n100 99 orb\n",
  );
  assert.deepEqual(
    hostActivity(
      root,
      rows,
      `p21\nn${root}/data/planning/run\np22\nn/other/project\np99\nn${root}/releases/${commit}\n`,
      [10],
      99,
    ),
    [
      { pid: 20, parent: 10 },
      { pid: 21, parent: 1 },
    ],
  );
  assert.deepEqual(
    guestActivity(
      processRows(
        "30 1 node /opt/code-assist/packages/intake/src/coding-guest.ts --secret=never-print\n31 1 /work/.venv/bin/pytest\n32 1 postgres\n33 1 node server.js\n",
      ),
    ),
    [
      { pid: 30, parent: 1 },
      { pid: 31, parent: 1 },
    ],
  );
  assert.throws(() => processRows("unexpected"));
  assert.throws(() => processRows(""));
  assert.deepEqual(
    guestActivity(
      processRows(
        "40 1 0::/system.slice/ca-setup-app.service node /work/run.mjs bash -euc npm-start\n",
      ),
    ),
    [],
    "The setup preview service is not an agent or validation runner",
  );
});

test("active guest units, orphan agent runners, and the updater each prevent an idle result", async () => {
  const f = fixture();
  try {
    for (const kind of ["unit", "process", "updater"]) {
      const execute = (command: string, args: string[]) => {
        if (
          kind === "updater" &&
          command.endsWith("launchctl") &&
          args.at(-1)?.endsWith(".updater")
        )
          return service(12);
        if (kind === "unit" && args[4] === "systemctl")
          return "ca-step-123.service loaded active running Agent\n";
        if (kind === "process" && args[4] === "ps")
          return "30 1 node /opt/code-assist/packages/intake/src/coding-guest.ts --token=fixture-secret\n";
        return f.deps.execute(command, args);
      };
      const report = await collectDeploymentStatus(f.root, null, {
        ...f.deps,
        execute,
      });
      assert.equal(report.status, "busy", kind);
      assert(!JSON.stringify(report).includes("fixture-secret"));
    }
  } finally {
    f.dispose();
  }
});

test("failed inspections are Unknown with partial evidence retained and no raw errors", async () => {
  const f = fixture();
  try {
    for (const failure of [
      "database",
      "guests",
      "processes",
      "health",
      "worker",
      "updater",
    ]) {
      const execute = (command: string, args: string[]) => {
        if (
          (failure === "guests" && command.endsWith("orb")) ||
          (failure === "processes" && command.endsWith("lsof"))
        )
          throw new Error("credential=fixture-secret");
        if (
          failure === "worker" &&
          command.endsWith("launchctl") &&
          args.at(-1)?.endsWith(".worker")
        )
          return service(null);
        if (
          failure === "updater" &&
          command.endsWith("launchctl") &&
          args.at(-1)?.endsWith(".updater")
        )
          return service(null, 1);
        return f.deps.execute(command, args);
      };
      const report = await collectDeploymentStatus(f.root, null, {
        ...f.deps,
        execute,
        activity: async () => {
          if (failure === "database") throw new Error("fixture-secret");
          return f.deps.activity();
        },
        health: async () =>
          failure === "health"
            ? Response.json({ status: "error" }, { status: 503 })
            : f.deps.health(),
      });
      assert.equal(report.status, "unknown", failure);
      assert.equal(statusExitCode(report), 2);
      assert(
        report.checks.some(
          (c) => c.name === "Selected Release" && c.status === "idle",
        ),
      );
      assert(!JSON.stringify(report).includes("fixture-secret"));
    }
  } finally {
    f.dispose();
  }
});

test("post-deployment verification requires the expected commit in selected release, web and worker", async () => {
  const f = fixture();
  try {
    const pending = await collectDeploymentStatus(f.root, old, f.deps);
    assert.equal(pending.status, "busy");
    const mixed = await collectDeploymentStatus(f.root, commit, {
      ...f.deps,
      execute: (cmd, args) =>
        cmd.endsWith("lsof")
          ? `p10\nn${f.root}/releases/${commit}/apps/web\np11\nn${f.root}/releases/${old}\n`
          : f.deps.execute(cmd, args),
    });
    assert.equal(mixed.status, "busy");
    assert(
      mixed.checks.some(
        (c) => c.name === "Expected Commit" && c.status === "busy",
      ),
    );
    let workerChecks = 0;
    const changed = await collectDeploymentStatus(f.root, null, {
      ...f.deps,
      execute: (cmd, args) => {
        if (cmd.endsWith("launchctl") && args.at(-1)?.endsWith(".worker"))
          return service(++workerChecks > 1 ? 50 : 11);
        return f.deps.execute(cmd, args);
      },
    });
    assert.equal(changed.status, "unknown");
    assert(
      changed.checks.some(
        (c) => c.name === "Snapshot Stability" && c.status === "unknown",
      ),
    );
  } finally {
    f.dispose();
  }
});

test("service parsing ignores nested launchd state and CLI rejects malformed commits", () => {
  assert.deepEqual(parseService(service(null)), {
    state: "not running",
    pid: null,
    lastExitCode: 0,
    runs: null,
  });
  assert.throws(() => parseService("\tstate = running\n"));
  assert.throws(() => statusOptions([], { EXPECTED_COMMIT: "a;command" }));
  assert.throws(() => statusOptions(["--unexpected"], {}));
  assert.deepEqual(
    statusOptions(["--local", "--json"], { EXPECTED_COMMIT: commit }),
    { local: true, json: true, expected: commit },
  );
});
