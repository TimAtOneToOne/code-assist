import assert from "node:assert/strict";
import { test } from "node:test";
import { icuEnvironment } from "../src/workspace-environment.ts";
import { approvedWorkspaceInput } from "../src/workspace.ts";
import type { Db } from "pg-boss";

test("attempt services replace mapped shared destinations while preserving integration values", () => {
  const mapped = {
    DATABASE_URL: "postgres://shared:secret@host.orb.internal/production",
    TEST_DATABASE_URL: "postgres://shared:secret@host.orb.internal/production",
    OAUTH_TOKEN_TEST_DATABASE_URL:
      "postgres://shared:secret@host.orb.internal/production",
    ORIGIN: "https://shared.example.invalid",
    BETTER_AUTH_SECRET: "shared-session-secret",
    AWS_ACCESS_KEY_ID: "cloud-access",
    AWS_SECRET_ACCESS_KEY: "cloud-secret",
    AWS_SESSION_TOKEN: "cloud-session",
    AWS_ENDPOINT_URL: "https://cloud.example.invalid",
    AWS_ENDPOINT_URL_S3: "https://cloud.example.invalid",
    LITELLM_API_KEY: "key with 'quotes', \"quotes\", $shell and\nnewlines",
  };
  const a = icuEnvironment(mapped),
    b = icuEnvironment(mapped);
  assert.notEqual(a.BETTER_AUTH_SECRET, b.BETTER_AUTH_SECRET);
  assert.equal(a.BETTER_AUTH_SECRET.length, 64);
  assert.equal(a.LITELLM_API_KEY, mapped.LITELLM_API_KEY);
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "OAUTH_TOKEN_TEST_DATABASE_URL",
  ] as const) {
    assert.equal(new URL(a[key]).hostname, "127.0.0.1");
    assert.equal(new URL(a[key]).port, "5435");
  }
  assert.notEqual(a.DATABASE_URL, a.TEST_DATABASE_URL);
  assert.equal(a.AWS_SESSION_TOKEN, "");
  assert.equal(a.AWS_ACCESS_KEY_ID, "test");
  assert.equal(a.AWS_ENDPOINT_URL_S3, "http://127.0.0.1:4566");
  assert.equal(a.ORIGIN, "http://localhost:5173");
  assert.equal(mapped.BETTER_AUTH_SECRET, "shared-session-secret");
  assert.equal("CODE_ASSIST_DATABASE_URL" in a, false);
});

test("workspace approval preserves ordered repositories and rejects duplicate identities", async () => {
  const row = {
    planning_id: "planning",
    current_version: 3,
    plan_hash: "hash",
    input_hash: "inputs",
    snapshots: [
      {
        name: "internal-chat-ui",
        source: "/repos/internal-chat-ui",
        commit: "a".repeat(40),
        directory: "/snapshots/icu",
      },
    ],
  };
  const db = (rows: unknown[]) =>
    ({ executeSql: async () => ({ rows }) }) as Db;
  await assert.rejects(
    approvedWorkspaceInput(db([]), "ticket"),
    /approved plan/,
  );
  await assert.rejects(
    approvedWorkspaceInput(
      db([{ ...row, snapshots: [...row.snapshots, ...row.snapshots] }]),
      "ticket",
    ),
    /unique/,
  );
  const input = await approvedWorkspaceInput(db([row]), "ticket");
  const second = {
    ...row.snapshots[0],
    name: "workplace-agents",
    source: "/repos/workplace-agents",
  };
  const multi = await approvedWorkspaceInput(
    db([{ ...row, snapshots: [...row.snapshots, second] }]),
    "ticket",
  );
  assert.deepEqual(multi.snapshots, [...row.snapshots, second]);
  assert.equal(input.snapshots, undefined);
  assert.equal(input.version, 3);
  assert.equal(input.snapshot.commit, "a".repeat(40));
  assert.equal(
    input.dependencyPins,
    undefined,
    "Legacy inputs retain their identity",
  );
  const pins = [{ repository: "library", commits: ["b".repeat(40)] }];
  const withDependencies = await approvedWorkspaceInput(
    db([
      {
        ...row,
        dependency_snapshots: [
          {
            name: "library",
            commit: "b".repeat(40),
            source: "/repos/library",
            directory: "/snapshots/.dependencies/library",
          },
        ],
        repository_setups: {
          "/repos/internal-chat-ui": {
            configuration: { gitDependencies: pins },
          },
        },
      },
    ]),
    "ticket",
  );
  assert.deepEqual(withDependencies.dependencyPins, {
    "internal-chat-ui": pins,
  });
  assert.equal(withDependencies.snapshot.name, "internal-chat-ui");
  assert.equal(
    withDependencies.snapshots,
    undefined,
    "Dependencies do not become coding/PR repositories",
  );
  assert.equal(
    input.completionRules,
    undefined,
    "Legacy approved inputs retain their identity",
  );
  const recorded = {
    ...row,
    repository_setups: {
      "/repos/internal-chat-ui": { configuration: { completionRule: "merge" } },
    },
  };
  const pinned = await approvedWorkspaceInput(db([recorded]), "ticket");
  assert.deepEqual(pinned.completionRules, { "internal-chat-ui": "merge" });
  recorded.repository_setups[
    "/repos/internal-chat-ui"
  ].configuration.completionRule = "invalid";
  await assert.rejects(
    approvedWorkspaceInput(db([recorded]), "ticket"),
    /completion rule/,
  );
});

test("LocalStack fixture keys do not redact test commands or filenames, while real provider keys remain", async () => {
  const { workspaceLogEnvironment } =
    await import("../src/workspace-environment.ts");
  const source = {
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    OPENAI_API_KEY: "provider-secret",
  };
  const logging = workspaceLogEnvironment(source);
  assert.equal(logging.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(logging.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(logging.OPENAI_API_KEY, "provider-secret");
  assert.equal(source.AWS_SECRET_ACCESS_KEY, "test");
  assert.equal(
    workspaceLogEnvironment({ AWS_SECRET_ACCESS_KEY: "real-aws-secret" })
      .AWS_SECRET_ACCESS_KEY,
    "real-aws-secret",
  );
});

test("repository profiles keep Workplace Agents on its private database and use established root commands", async () => {
  const { repositoryEnvironment, repositoryProfile } =
    await import("../src/repository-profiles.ts");
  const env = repositoryEnvironment("workplace-agents", {
    DATABASE_URL: "postgres://shared/production",
    TEST_DATABASE_URL: "postgres://shared/test",
    TOKEN: "mapped-provider",
  });
  assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(env.DATABASE_URL).port, "65432");
  assert.equal(env.TOKEN, "mapped-provider");
  assert.equal(env.ORIGIN, "http://localhost:6001");
  assert.deepEqual(repositoryProfile("workplace-agents").validation, [
    ["make", "validate"],
  ]);
  assert.deepEqual(repositoryProfile("elation_companion").validation, [
    ["bash", "./build.sh"],
  ]);
  assert.throws(() => repositoryProfile("unknown"), /not configured/);
});
