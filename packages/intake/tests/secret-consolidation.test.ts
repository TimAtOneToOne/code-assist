import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  consolidateSecrets,
  revealSecret,
  saveSecret,
} from "@code-assist/secrets";
import { readSettings, writeSettings } from "../src/settings.ts";
import { readAwsSettings, writeAwsSettings } from "../src/aws-settings.ts";

test("saved intake and AWS references survive consolidation without cross-file rewrites", (t) => {
  const root = resolve("../../.tmp/secrets/intake-tests");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "settings-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = saveSecret(directory, {
    name: "Shared",
    description: "",
    value: "synthetic-key",
  });
  const second = saveSecret(directory, {
    name: "Duplicate",
    description: "",
    value: "synthetic-key",
  });
  const settings = {
    linearSecretId: second.id,
    linearTokenType: "apiKey" as const,
    teamsWebhookSecretId: second.id,
    teamsConversationSecretId: second.id,
    pollMinutes: 5,
  };
  const aws = {
    accessKeySecretId: second.id,
    secretAccessKeySecretId: second.id,
    accountId: "123456789012",
    roleArn: "arn:aws:iam::123456789012:role/test",
    region: "us-east-2",
    profile: "test",
  };
  writeSettings(directory, settings);
  writeAwsSettings(directory, aws);
  const original = readFileSync(join(directory, "intake.json"), "utf8");
  consolidateSecrets(directory);
  assert.equal(readFileSync(join(directory, "intake.json"), "utf8"), original);
  const updated = readSettings(directory)!;
  const updatedAws = readAwsSettings(directory)!;
  assert.deepEqual(updated, {
    ...settings,
    linearSecretId: first.id,
    teamsWebhookSecretId: first.id,
    teamsConversationSecretId: first.id,
  });
  assert.deepEqual(updatedAws, {
    ...aws,
    accessKeySecretId: first.id,
    secretAccessKeySecretId: first.id,
  });
  assert.equal(
    revealSecret(directory, settings.linearSecretId),
    "synthetic-key",
  );
  writeSettings(directory, updated);
  writeAwsSettings(directory, updatedAws);
  assert.deepEqual(readSettings(directory), updated);
  assert.deepEqual(readAwsSettings(directory), updatedAws);
});
