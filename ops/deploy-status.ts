import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { host } from "./settings.ts";
import {
  collectDeploymentStatus,
  formatDeploymentStatus,
  statusExitCode,
  type DeploymentStatus,
} from "./deployment-status.ts";

export function statusOptions(args: string[], environment = process.env) {
  if (args.some((arg) => !["--local", "--json"].includes(arg)))
    throw new Error(
      "Usage: make deploy-status [EXPECTED_COMMIT=<sha>] [JSON=1] [LOCAL=1]",
    );
  const expected = environment.EXPECTED_COMMIT || null;
  if (expected && !/^[a-f0-9]{7,40}$/.test(expected))
    throw new Error(
      "EXPECTED_COMMIT must be a 7–40 character lowercase Git commit hash.",
    );
  return {
    local: args.includes("--local"),
    json: args.includes("--json"),
    expected,
  };
}
export async function remoteStatus(
  expected: string | null,
): Promise<DeploymentStatus> {
  const config = parseEnv(
    readFileSync(new URL("../.env", import.meta.url), "utf8"),
  );
  if (
    !config.MAC_MINI_USER ||
    !config.MAC_MINI_PSWD ||
    !/^[a-zA-Z0-9_-]+$/.test(config.MAC_MINI_USER)
  )
    throw new Error("Mia SSH configuration is missing or invalid.");
  const command = [
    'node_path=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:0" "$HOME/Library/LaunchAgents/com.code-assist.worker.plist") || exit 2',
    `EXPECTED_COMMIT=${expected ?? ""} "$node_path" "$HOME/Library/Application Support/CodeAssist/current/ops/deploy-status.ts" --local --json`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/opt/homebrew/bin/sshpass",
      [
        "-e",
        "ssh",
        "-o",
        "PreferredAuthentications=password",
        "-o",
        "PubkeyAuthentication=no",
        "-o",
        "NumberOfPasswordPrompts=1",
        "-o",
        "StrictHostKeyChecking=yes",
        `${config.MAC_MINI_USER}@${host}`,
        command,
      ],
      {
        env: { ...process.env, SSHPASS: config.MAC_MINI_PSWD },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", () =>
      reject(new Error("Could not run Mia deployment inspection.")),
    );
    child.on("close", (code) => {
      try {
        const report = JSON.parse(output) as DeploymentStatus;
        if (
          report.schemaVersion !== 1 ||
          !["idle", "busy", "unknown"].includes(report.status) ||
          !Array.isArray(report.checks) ||
          code !== statusExitCode(report)
        )
          throw new Error("Invalid response");
        resolve(report);
      } catch {
        reject(
          new Error(
            "Mia deployment inspection failed or returned an invalid report. Verify SSH access and the installed status command.",
          ),
        );
      }
    });
  });
}
export async function main(args = process.argv.slice(2)) {
  try {
    const options = statusOptions(args);
    const report = options.local
      ? await collectDeploymentStatus(undefined, options.expected)
      : await remoteStatus(options.expected);
    console.log(
      options.json ? JSON.stringify(report) : formatDeploymentStatus(report),
    );
    process.exitCode = statusExitCode(report);
  } catch {
    const report: DeploymentStatus = {
      schemaVersion: 1,
      startedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
      durationMs: 0,
      status: "unknown",
      expectedCommit: null,
      checks: [
        {
          name: "Inspection",
          status: "unknown",
          detail:
            "Could not complete deployment inspection. Check arguments, local .env SSH configuration, connectivity, and the installed command. Raw errors are withheld because they may contain credentials.",
        },
      ],
    };
    console.log(
      args.includes("--json")
        ? JSON.stringify(report)
        : formatDeploymentStatus(report),
    );
    process.exitCode = 2;
  }
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
