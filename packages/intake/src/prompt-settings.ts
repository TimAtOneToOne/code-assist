import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  promptDefinitions,
  repositoryScopes,
  type PromptScope,
  type PromptSettings,
} from "./prompt-defaults.ts";

export class PromptSettingsError extends Error {}

export function isPromptScope(value: string): value is PromptScope {
  return Object.hasOwn(promptDefinitions, value);
}

function validEntries(value: unknown, scopes: readonly string[]) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, text]) => scopes.includes(key) && typeof text === "string",
    )
  );
}

export function readPromptSettings(directory: string): PromptSettings {
  let text: string;
  try {
    text = readFileSync(join(directory, "prompts.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { prompts: {}, repositories: {} };
    throw error;
  }
  const value = JSON.parse(text);
  if (
    !value ||
    !validEntries(value.prompts, Object.keys(promptDefinitions)) ||
    !value.repositories ||
    typeof value.repositories !== "object" ||
    Array.isArray(value.repositories) ||
    Object.entries(value.repositories).some(
      ([path, prompts]) =>
        !isAbsolute(path) || !validEntries(prompts, repositoryScopes),
    )
  )
    throw new PromptSettingsError("Saved prompt configuration is invalid.");
  return value;
}

export function writePromptSetting(
  directory: string,
  scope: PromptScope,
  text: string | null,
  repository?: string,
) {
  if (
    !isPromptScope(scope) ||
    (text !== null && typeof text !== "string") ||
    (repository !== undefined &&
      (!isAbsolute(repository) ||
        !(repositoryScopes as readonly string[]).includes(scope)))
  )
    throw new PromptSettingsError(
      "Choose a valid prompt scope and repository.",
    );
  const settings = readPromptSettings(directory);
  const target = repository
    ? (settings.repositories[repository] ??= {})
    : settings.prompts;
  if (text === null)
    delete (target as Partial<Record<PromptScope, string>>)[scope];
  else (target as Partial<Record<PromptScope, string>>)[scope] = text;
  if (repository && !Object.keys(target).length)
    delete settings.repositories[repository];
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `prompts-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(directory, "prompts.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
