import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { saveSecret } from "@code-assist/secrets";
import { readAwsSettings, writeAwsSettings } from "../src/aws-settings.ts";
import {
  awsEvidenceContext,
  writePlanningAwsProfile,
  removePlanningAwsProfile,
  type PlanningAws,
} from "../src/planning-aws.ts";

test("AWS connection references saved keys and rejects account/profile injection", async () => {
  const base = resolve("../../.tmp/planning-aws/tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "settings-"));
  try {
    assert.equal(readAwsSettings(dir), null);
    const key = saveSecret(dir, {
      name: "SOURCE_KEY",
      value: "synthetic-source",
      description: "",
    });
    const settings = {
      accessKeySecretId: key.id,
      secretAccessKeySecretId: key.id,
      accountId: "123456789012",
      roleArn: "arn:aws:iam::123456789012:role/agents/read-only",
      region: "us-east-2",
      profile: "staging-agent-readonly",
    };
    writeAwsSettings(dir, settings);
    assert.deepEqual(readAwsSettings(dir), settings);
    for (const invalid of [
      { accountId: "987654321012" },
      { profile: "staging\n[production]" },
      { roleArn: settings.roleArn + "\n" },
      { region: "us-east-2\n" },
      { accessKeySecretId: "missing" },
    ])
      assert.throws(() => writeAwsSettings(dir, { ...settings, ...invalid }));
    assert.deepEqual(readAwsSettings(dir), settings);
    assert(
      !(await readFile(join(dir, "aws-staging.json"), "utf8")).includes(
        "synthetic-source",
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("isolated AWS profile contains only temporary credentials; evidence omits keys and cleanup removes files", async () => {
  const base = resolve("../../.tmp/planning-aws/tests");
  await mkdir(base, { recursive: true });
  const home = await mkdtemp(join(base, "profile-"));
  const aws: PlanningAws = {
    accountId: "123456789012",
    roleArn: "arn:aws:iam::123456789012:role/read-only",
    region: "us-east-2",
    profile: "staging-agent-readonly",
    expiresAt: "2026-10-20T20:00:00Z",
    credentials: {
      accessKeyId: "synthetic-temporary-key",
      secretAccessKey: "synthetic-temporary-secret",
      sessionToken: "synthetic-session-token",
    },
  };
  try {
    const env = await writePlanningAwsProfile(home, aws);
    assert.equal(env.AWS_PROFILE, aws.profile);
    assert.equal(env.AWS_REGION, aws.region);
    const contents = await readFile(env.AWS_SHARED_CREDENTIALS_FILE, "utf8");
    assert(contents.includes("aws_session_token = synthetic-session-token"));
    assert.equal(
      (await stat(env.AWS_SHARED_CREDENTIALS_FILE)).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(join(home, ".aws"))).mode & 0o777, 0o700);
    assert(!JSON.stringify(awsEvidenceContext(aws)).includes("synthetic"));
    assert(!JSON.stringify(env).includes("synthetic-temporary"));
    await removePlanningAwsProfile(home);
    await assert.rejects(stat(env.AWS_SHARED_CREDENTIALS_FILE), {
      code: "ENOENT",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
