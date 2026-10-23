import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";
import { deploymentActivity } from "../packages/intake/src/deployment-activity.ts";
import { inspectProcess } from "./release-cleanup.ts";
import {
  hostActivity,
  guestActivity,
  processRelease,
  processRows,
} from "./deployment-processes.ts";
import {
  domain,
  origin,
  root,
  webLabel,
  workerLabel,
  updaterLabel,
} from "./settings.ts";

export type Check = {
  name: string;
  status: "idle" | "busy" | "unknown";
  detail: string;
  evidence?: unknown;
};
export type DeploymentStatus = {
  schemaVersion: 1;
  startedAt: string;
  checkedAt: string;
  durationMs: number;
  status: Check["status"];
  expectedCommit: string | null;
  checks: Check[];
};
type Dependencies = {
  execute: typeof inspectProcess;
  activity: typeof deploymentActivity;
  health: () => Promise<Response>;
  inspectorPid: number;
};
export function assess(checks: Check[]): Check["status"] {
  return checks.some((c) => c.status === "unknown")
    ? "unknown"
    : checks.some((c) => c.status === "busy")
      ? "busy"
      : "idle";
}
export function statusExitCode(report: DeploymentStatus) {
  return report.status === "idle" ? 0 : report.status === "busy" ? 1 : 2;
}
export function parseService(text: string) {
  const state = text.match(/^\tstate = (.+)$/m)?.[1];
  if (!state || !["running", "not running", "waiting"].includes(state))
    throw new Error("Unrecognized service state");
  const pid = Number(text.match(/^\tpid = (\d+)$/m)?.[1]) || null;
  const lastExit = text.match(/^\tlast exit code = (-?\d+)$/m)?.[1];
  if ((state === "running") !== (pid !== null))
    throw new Error("Inconsistent service state");
  return {
    state,
    pid,
    lastExitCode: lastExit === undefined ? null : Number(lastExit),
    runs: Number(text.match(/^\truns = (\d+)$/m)?.[1]) || null,
  };
}
export async function collectDeploymentStatus(
  installation = root,
  expectedCommit: string | null = null,
  dependencies: Partial<Dependencies> = {},
): Promise<DeploymentStatus> {
  const started = Date.now();
  const { execute, activity, health, inspectorPid } = {
    execute: inspectProcess,
    activity: deploymentActivity,
    health: () => fetch(`${origin}/health`),
    inspectorPid: process.pid,
    ...dependencies,
  };
  const checks: Check[] = [];
  const check = async <T>(name: string, action: () => T | Promise<T>) => {
    try {
      return await action();
    } catch {
      checks.push({
        name,
        status: "unknown",
        detail: `${name} inspection failed.`,
      });
      return undefined;
    }
  };
  let selected: string | undefined;
  await check("Selected Release", () => {
    const directory = realpathSync(join(installation, "current"));
    selected = basename(directory);
    if (
      !/^[a-f0-9]{40}$/.test(selected) ||
      directory !== join(installation, "releases", selected)
    )
      throw new Error("Invalid release");
    const lastFetchedMain = execute("/usr/bin/git", [
      "--git-dir",
      join(installation, "source.git"),
      "rev-parse",
      "--verify",
      "FETCH_HEAD",
    ]).trim();
    if (!/^[a-f0-9]{40}$/.test(lastFetchedMain))
      throw new Error("Invalid fetched commit");
    checks.push({
      name: "Selected Release",
      status: "idle",
      detail: selected,
      evidence: {
        commit: selected,
        selectedAt: lstatSync(
          join(installation, "current"),
        ).mtime.toISOString(),
        lastFetchedMain,
        stagingDirectories: readdirSync(join(installation, "releases")).filter(
          (name) => name.startsWith(".build-"),
        ),
      },
    });
    checks.push({
      name: "Build Target",
      status: "idle",
      detail: `${lastFetchedMain} (last fetched main, not a new GitHub fetch).`,
    });
  });
  const services = new Map<string, ReturnType<typeof parseService>>();
  for (const label of [webLabel, workerLabel, updaterLabel]) {
    const service = await check(label, () =>
      parseService(execute("/bin/launchctl", ["print", `${domain}/${label}`])),
    );
    if (service) services.set(label, service);
  }
  const updater = services.get(updaterLabel);
  if (updater)
    checks.push({
      name: "Updater",
      status: updater.pid
        ? "busy"
        : updater.lastExitCode === 0
          ? "idle"
          : "unknown",
      detail: updater.pid
        ? "Updater is running."
        : updater.lastExitCode === 0
          ? "Last updater invocation succeeded."
          : "Last updater invocation did not report success.",
      evidence: updater,
    });
  const releases = new Map<string, string>();
  await check("Host Processes", () => {
    const listing = execute("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-u",
      String(process.getuid!()),
      "-d",
      "cwd",
      "-Fpn",
    ]);
    const processes = processRows(
      execute("/bin/ps", ["-axo", "pid=,ppid=,command="]),
    );
    for (const label of [webLabel, workerLabel]) {
      const service = services.get(label);
      if (!service?.pid || !processes.some((p) => p.pid === service.pid)) {
        checks.push({
          name: label,
          status: "unknown",
          detail: "Service is not running or its PID changed.",
        });
        continue;
      }
      const commit = processRelease(installation, listing, service.pid);
      releases.set(label, commit);
      checks.push({
        name: label,
        status: commit === selected ? "idle" : "busy",
        detail: commit,
        evidence: { ...service, commit },
      });
    }
    const active = hostActivity(
      installation,
      processes,
      listing,
      [...services.values()].flatMap((s) => (s.pid ? [s.pid] : [])),
      inspectorPid,
    );
    checks.push({
      name: "Host Processes",
      status: active.length ? "busy" : "idle",
      detail: `${active.length} associated subprocess(es).`,
      evidence: active,
    });
  });
  await check("Guest Inventory", () => {
    const machines: unknown = JSON.parse(
      execute("/usr/local/bin/orb", ["list", "--format", "json"]),
    );
    if (
      !Array.isArray(machines) ||
      machines.some(
        (m) => typeof m?.name !== "string" || typeof m?.state !== "string",
      )
    )
      throw new Error("Invalid guest inventory");
    return machines;
  }).then(async (machines) => {
    if (!machines) return;
    for (const machine of machines.filter((m) => m.name.startsWith("ca-"))) {
      await check(`Guest ${machine.name}`, () => {
        if (machine.state === "stopped") {
          checks.push({
            name: `Guest ${machine.name}`,
            status: "idle",
            detail: "Stopped; left stopped.",
          });
          return;
        }
        if (machine.state !== "running")
          throw new Error("Guest is transitioning");
        const command = (args: string[]) =>
          execute("/usr/local/bin/orb", [
            "-m",
            machine.name,
            "-u",
            "root",
            ...args,
          ]);
        const units = command([
          "systemctl",
          "list-units",
          "--state=active,activating,deactivating",
          "--no-legend",
          "--no-pager",
          "ca-step-*.service",
        ]).trim();
        const processes = guestActivity(
          processRows(command(["ps", "-eo", "pid=,ppid=,cgroup=,args="])),
        );
        checks.push({
          name: `Guest ${machine.name}`,
          status: units || processes.length ? "busy" : "idle",
          detail:
            units || processes.length
              ? "Agent or validation activity found."
              : "No active step units or agent/validation runners.",
          evidence: {
            units: units
              .split("\n")
              .filter(Boolean)
              .map((line) => line.trim().split(/\s+/)[0]),
            processes,
          },
        });
      });
    }
  });
  const healthCommit = await check("Web Health", async () => {
    const response = await health();
    const data = await response.json();
    if (
      !response.ok ||
      data.status !== "ok" ||
      !/^[a-f0-9]{40}$/.test(data.commit)
    )
      throw new Error("Unhealthy web service");
    const commit: string = data.commit;
    checks.push({
      name: "Web Health",
      status:
        commit === selected && commit === releases.get(webLabel)
          ? "idle"
          : "busy",
      detail: commit,
    });
    return commit;
  });
  // Read the queue last so work enqueued during process inspection is visible.
  await check("Workflow Activity", async () => {
    const runtime = parseEnv(
      readFileSync(join(installation, "runtime.env"), "utf8"),
    );
    if (!runtime.CODE_ASSIST_DATABASE_URL)
      throw new Error("Missing database configuration");
    const state = await activity(runtime.CODE_ASSIST_DATABASE_URL);
    checks.push({
      name: "Workflow Activity",
      status: state.jobs.length || state.steps.length ? "busy" : "idle",
      detail: `${state.jobs.length} queued/active job(s), ${state.steps.length} unfinished step(s).`,
      evidence: state,
    });
  });
  await check("Snapshot Stability", () => {
    if (basename(realpathSync(join(installation, "current"))) !== selected)
      throw new Error("Release changed during inspection");
    for (const [label, service] of services) {
      if (
        JSON.stringify(
          parseService(
            execute("/bin/launchctl", ["print", `${domain}/${label}`]),
          ),
        ) !== JSON.stringify(service)
      )
        throw new Error("Service changed during inspection");
    }
  });
  if (expectedCommit) {
    const matches = [
      selected,
      releases.get(webLabel),
      releases.get(workerLabel),
      healthCommit,
    ].every((commit) => commit?.startsWith(expectedCommit));
    checks.push({
      name: "Expected Commit",
      status: matches ? "idle" : "busy",
      detail: matches
        ? `${expectedCommit} is selected and running in web and worker.`
        : `${expectedCommit} is not yet verified across selected release, web, worker, and health.`,
    });
  }
  return {
    schemaVersion: 1,
    startedAt: new Date(started).toISOString(),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    status: assess(checks),
    expectedCommit,
    checks,
  };
}

export function formatDeploymentStatus(report: DeploymentStatus) {
  return [
    `Deployment Status: ${report.status.toUpperCase()}`,
    `Checked: ${report.checkedAt} (${report.durationMs} ms)`,
    ...report.checks.map(
      (c) =>
        `${c.status.toUpperCase()} · ${c.name}: ${c.detail}${c.status !== "idle" && c.evidence ? "\n  " + JSON.stringify(c.evidence) : ""}`,
    ),
    "Fresh observation only; run immediately before pushing. No jobs or services were changed.",
  ].join("\n");
}
