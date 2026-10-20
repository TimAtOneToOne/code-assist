import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { claudeModel, codexModel } from "./agent-models.ts";

export type ModelSettings = { codex: string; claude: string };
export class ModelSettingsError extends Error {}

function validate(value: unknown): ModelSettings {
  const settings = value as ModelSettings | null;
  if (
    !settings ||
    ![settings.codex, settings.claude].every(
      (model) =>
        typeof model === "string" &&
        model.trim().length > 0 &&
        !/[\s\0]/u.test(model.trim()),
    )
  )
    throw new ModelSettingsError(
      "Enter a model ID for both providers, without spaces.",
    );
  return { codex: settings.codex.trim(), claude: settings.claude.trim() };
}

export function readModelSettings(directory: string): ModelSettings {
  let text: string;
  try {
    text = readFileSync(join(directory, "models.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { codex: codexModel, claude: claudeModel };
    throw error;
  }
  try {
    return validate(JSON.parse(text));
  } catch {
    throw new ModelSettingsError("Saved model configuration is invalid.");
  }
}

export function writeModelSettings(
  directory: string,
  input: ModelSettings,
): ModelSettings {
  const settings = validate(input);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `models-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(directory, "models.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
  return settings;
}
