import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { canonicalSecretId, listConfiguration } from "@code-assist/secrets";

export type AwsSettings = {
  accessKeySecretId: string;
  secretAccessKeySecretId: string;
  accountId: string;
  roleArn: string;
  region: string;
  profile: string;
};
export class AwsSettingsError extends Error {}

function validate(settings: AwsSettings) {
  if (
    !settings ||
    Object.values(settings).some(
      (value) => typeof value !== "string" || /[\r\n]/.test(value),
    ) ||
    !/^\d{12}$/.test(settings.accountId) ||
    !/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(settings.roleArn) ||
    settings.roleArn.split(":")[4] !== settings.accountId ||
    !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(settings.region) ||
    !/^[a-zA-Z0-9_-]+$/.test(settings.profile) ||
    ![settings.accessKeySecretId, settings.secretAccessKeySecretId].every(
      (id) => typeof id === "string" && id,
    )
  )
    throw new AwsSettingsError(
      "Choose both saved keys and enter a matching AWS account/role, region and profile name.",
    );
}
export function readAwsSettings(directory: string): AwsSettings | null {
  let text: string;
  try {
    text = readFileSync(join(directory, "aws-staging.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const settings = JSON.parse(text);
    validate(settings);
    return {
      ...settings,
      accessKeySecretId: canonicalSecretId(
        directory,
        settings.accessKeySecretId,
      ),
      secretAccessKeySecretId: canonicalSecretId(
        directory,
        settings.secretAccessKeySecretId,
      ),
    };
  } catch {
    throw new AwsSettingsError(
      "AWS staging configuration is invalid. Save it again in Configuration.",
    );
  }
}
export function writeAwsSettings(directory: string, settings: AwsSettings) {
  validate(settings);
  const ids = new Set(listConfiguration(directory).secrets.map((s) => s.id));
  if (
    !ids.has(settings.accessKeySecretId) ||
    !ids.has(settings.secretAccessKeySecretId)
  )
    throw new AwsSettingsError("Choose existing saved keys.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `aws-staging-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(directory, "aws-staging.json"));
  } finally {
    rmSync(temporary, { force: true });
  }
}
