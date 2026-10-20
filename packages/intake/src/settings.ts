import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { listConfiguration } from "@code-assist/secrets";

export type IntakeSettings = {
  linearSecretId: string;
  linearTokenType: "apiKey" | "accessToken";
  teamsWebhookSecretId: string;
  teamsConversationSecretId: string;
  pollMinutes: number;
};

export function readSettings(directory: string): IntakeSettings | null {
  try {
    const settings = JSON.parse(
      readFileSync(join(directory, "intake.json"), "utf8"),
    );
    validate(settings);
    return settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Intake configuration is invalid.", { cause: error });
  }
}

function validate(settings: IntakeSettings) {
  if (!["apiKey", "accessToken"].includes(settings.linearTokenType))
    throw new Error("Choose the Linear token type.");
  if (
    ![
      settings.linearSecretId,
      settings.teamsWebhookSecretId,
      settings.teamsConversationSecretId,
    ].every((id) => typeof id === "string" && id)
  )
    throw new Error("Choose the Linear credential and both Teams secrets.");
  if (![0, 1, 5].includes(settings.pollMinutes))
    throw new Error(
      "Choose manual checks, every minute or every five minutes.",
    );
}

export function writeSettings(directory: string, settings: IntakeSettings) {
  validate(settings);
  const ids = new Set(
    listConfiguration(directory).secrets.map((secret) => secret.id),
  );
  for (const id of [
    settings.linearSecretId,
    settings.teamsWebhookSecretId,
    settings.teamsConversationSecretId,
  ]) {
    if (!ids.has(id)) throw new Error("A selected secret no longer exists.");
  }
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `intake-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(temporary, join(directory, "intake.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
