import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseEnv } from "node:util";
import { root } from "./settings.ts";
import { ensureStorageDirectory } from "../packages/observability/src/storage.ts";

const directory = join(root, "observability");
const secrets = join(root, "observability.env");
mkdirSync(directory, { recursive: true });
if (!existsSync(secrets)) {
  const password = randomBytes(32).toString("base64url");
  const email = "tim@code-assist.local";
  writeFileSync(
    secrets,
    [
      `ZO_ROOT_USER_EMAIL=${email}`,
      `ZO_ROOT_USER_PASSWORD=${password}`,
      `OPENOBSERVE_AUTHORIZATION=Basic ${Buffer.from(`${email}:${password}`).toString("base64")}`,
      `CODE_ASSIST_OBSERVABILITY_DIR="${join(root, "data/observability")}"`,
      `CODE_ASSIST_LOG_DIR="${join(root, "logs")}"`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}
chmodSync(secrets, 0o600);
const config = parseEnv(readFileSync(secrets, "utf8"));
function required(name: string) {
  const value = config[name];
  if (!value) throw new Error(`Missing observability setting: ${name}`);
  return value;
}
const dataDirectory = required("CODE_ASSIST_OBSERVABILITY_DIR");
const logDirectory = required("CODE_ASSIST_LOG_DIR");
const collectorPath = join(directory, "collector.yaml");
const collectorChanged =
  existsSync(collectorPath) &&
  readFileSync(collectorPath, "utf8") !==
    readFileSync(
      new URL("./observability/collector.yaml", import.meta.url),
      "utf8",
    );
for (const path of [
  join(dataDirectory, "openobserve"),
  join(dataDirectory, "collector"),
  join(logDirectory, "structured"),
])
  ensureStorageDirectory(path);
for (const name of ["compose.yaml", "collector.yaml"]) {
  copyFileSync(
    new URL(`./observability/${name}`, import.meta.url),
    join(directory, name),
  );
}
execFileSync(
  "/usr/local/bin/docker",
  [
    "compose",
    "--env-file",
    secrets,
    "-f",
    join(directory, "compose.yaml"),
    "up",
    "-d",
  ],
  { stdio: "inherit" },
);
if (collectorChanged) {
  execFileSync(
    "/usr/local/bin/docker",
    [
      "compose",
      "--env-file",
      secrets,
      "-f",
      join(directory, "compose.yaml"),
      "restart",
      "collector",
    ],
    { stdio: "inherit" },
  );
}

const base = "http://127.0.0.1:5080";
const deadline = Date.now() + 120_000;
let healthy = false;
while (Date.now() < deadline) {
  healthy = await fetch(`${base}/healthz`)
    .then((r) => r.ok)
    .catch(() => false);
  if (healthy) break;
  await setTimeout(1000);
}
if (!healthy) throw new Error("OpenObserve did not become ready");
const runtime = join(root, "runtime.env");
const content = readFileSync(runtime, "utf8");
const current = parseEnv(content);
const additions: Record<string, string> = {
  CODE_ASSIST_LOG_DIR: logDirectory,
  CODE_ASSIST_ARTIFACT_DIR:
    current.CODE_ASSIST_ARTIFACT_DIR ?? join(root, "data/artifacts"),
  CODE_ASSIST_LOG_SEARCH_URL: `${base}/api/default/_search`,
  CODE_ASSIST_LOG_SEARCH_AUTH: required("OPENOBSERVE_AUTHORIZATION"),
};
ensureStorageDirectory(additions.CODE_ASSIST_ARTIFACT_DIR);
for (const [key, value] of Object.entries(additions)) {
  if (current[key] && current[key] !== value)
    throw new Error(`Existing ${key} differs; review before changing it`);
}
writeFileSync(
  runtime,
  content.trimEnd() +
    "\n" +
    Object.entries(additions)
      .filter(([key]) => !current[key])
      .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`)
      .join(""),
  { mode: 0o600 },
);
console.log(
  "OpenObserve and collector installed. Credentials remain in observability.env.",
);
