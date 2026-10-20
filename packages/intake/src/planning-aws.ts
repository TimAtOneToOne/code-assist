import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  STSClient,
} from "@aws-sdk/client-sts";
import { revealSecret } from "@code-assist/secrets";
import { readAwsSettings, type AwsSettings } from "./aws-settings.ts";

export type PlanningAws = {
  accountId: string;
  roleArn: string;
  region: string;
  profile: string;
  expiresAt: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
  };
};
export async function assumePlanningRole(
  directory: string,
  sessionName: string,
  signal: AbortSignal,
  settings = readAwsSettings(directory),
): Promise<PlanningAws | undefined> {
  if (!settings) return undefined;
  const client = new STSClient({
    region: settings.region,
    credentials: {
      accessKeyId: revealSecret(directory, settings.accessKeySecretId),
      secretAccessKey: revealSecret(
        directory,
        settings.secretAccessKeySecretId,
      ),
    },
  });
  try {
    const { Credentials: credentials } = await client.send(
      new AssumeRoleCommand({
        RoleArn: settings.roleArn,
        RoleSessionName: sessionName,
      }),
      { abortSignal: signal },
    );
    if (
      !credentials?.AccessKeyId ||
      !credentials.SecretAccessKey ||
      !credentials.SessionToken ||
      !credentials.Expiration
    )
      throw new Error("AWS did not return a complete role session.");
    return {
      accountId: settings.accountId,
      roleArn: settings.roleArn,
      region: settings.region,
      profile: settings.profile,
      expiresAt: credentials.Expiration.toISOString(),
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken,
      },
    };
  } finally {
    client.destroy();
  }
}
export async function verifyPlanningIdentity(
  aws: PlanningAws,
  signal: AbortSignal,
) {
  const client = new STSClient({
    region: aws.region,
    credentials: aws.credentials,
  });
  try {
    const identity = await client.send(new GetCallerIdentityCommand({}), {
      abortSignal: signal,
    });
    const expected = `arn:aws:sts::${aws.accountId}:assumed-role/${aws.roleArn.split("/").at(-1)}/`;
    if (
      identity.Account !== aws.accountId ||
      !identity.Arn?.startsWith(expected)
    )
      throw new Error(
        "AWS identity does not match the configured staging role.",
      );
    return {
      accountId: identity.Account,
      arn: identity.Arn,
      region: aws.region,
      expiresAt: aws.expiresAt,
    };
  } finally {
    client.destroy();
  }
}
export function awsEvidenceContext(aws: PlanningAws) {
  return {
    accountId: aws.accountId,
    roleArn: aws.roleArn,
    region: aws.region,
    profile: aws.profile,
    expiresAt: aws.expiresAt,
  };
}
export async function writePlanningAwsProfile(home: string, aws: PlanningAws) {
  const directory = join(home, ".aws");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory, "credentials"),
    `[${aws.profile}]\naws_access_key_id = ${aws.credentials.accessKeyId}\naws_secret_access_key = ${aws.credentials.secretAccessKey}\naws_session_token = ${aws.credentials.sessionToken}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "config"),
    `[profile ${aws.profile}]\nregion = ${aws.region}\noutput = json\n`,
    { mode: 0o600 },
  );
  return {
    AWS_CONFIG_FILE: join(directory, "config"),
    AWS_SHARED_CREDENTIALS_FILE: join(directory, "credentials"),
    AWS_PROFILE: aws.profile,
    AWS_REGION: aws.region,
    AWS_DEFAULT_REGION: aws.region,
    AWS_PAGER: "",
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_EC2_METADATA_DISABLED: "true",
  };
}
export async function removePlanningAwsProfile(home: string) {
  await rm(join(home, ".aws"), { recursive: true, force: true });
}
export async function testAwsSettings(
  directory: string,
  settings: AwsSettings,
  signal: AbortSignal,
) {
  const aws = await assumePlanningRole(
    directory,
    "code-assist-connection-test",
    signal,
    settings,
  );
  return verifyPlanningIdentity(aws!, signal);
}
