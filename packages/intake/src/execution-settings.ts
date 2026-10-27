import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const executionSettingsFile = "execution.json";
export type ExecutionSettings = { maxParallelDiscoveries: number };
export class ExecutionSettingsError extends Error {}

function validate(value: unknown): ExecutionSettings {
  const count = (value as ExecutionSettings | null)?.maxParallelDiscoveries;
  if (!Number.isSafeInteger(count) || (count ?? 0) < 1)
    throw new ExecutionSettingsError("Enter a whole number of at least 1.");
  return { maxParallelDiscoveries: count! };
}

export function readExecutionSettings(directory: string): ExecutionSettings {
  let text: string;
  try {
    text = readFileSync(join(directory, executionSettingsFile), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { maxParallelDiscoveries: 3 };
    throw error;
  }
  try {
    return validate(JSON.parse(text));
  } catch {
    throw new ExecutionSettingsError(
      "Saved execution configuration is invalid.",
    );
  }
}

export function writeExecutionSettings(
  directory: string,
  input: ExecutionSettings,
) {
  const settings = validate(input);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `execution-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(directory, executionSettingsFile));
  } finally {
    rmSync(temporary, { force: true });
  }
  return settings;
}
