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

test("workspace setup requires a matching current approval and supports only the implemented repo setup", async () => {
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
    /ICU only/,
  );
  const input = await approvedWorkspaceInput(db([row]), "ticket");
  assert.equal(input.version, 3);
  assert.equal(input.snapshot.commit, "a".repeat(40));
});
