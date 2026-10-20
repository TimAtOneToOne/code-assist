import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createLogger } from "../src/logger.ts";
import { artifactPath } from "../src/artifacts.ts";
import { ensureStorageDirectory } from "../src/storage.ts";

const temporary = fileURLToPath(
  new URL("../../../.tmp/observability-tests/", import.meta.url),
);
mkdirSync(temporary, { recursive: true });

test("correlated events and full multi-megabyte payload survive with credentials removed", (t) => {
  const root = mkdtempSync(join(temporary, "evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logger = createLogger("test", {
    logDirectory: root,
    artifactDirectory: join(root, "artifacts"),
    release: "test-sha",
    environment: {
      OPENAI_API_KEY: 'secret-"quoted"\nvalue',
      CODE_ASSIST_DATABASE_URL:
        "postgresql://user:privatePassword@localhost/db",
    },
  }).child({ attempt_id: "attempt-123", job_id: "job-456" });
  const full =
    "BEGIN" + "a".repeat(1_100_000) + "MIDDLE" + "z".repeat(1_100_000) + "END";
  const reference = logger.payload("sdk.event", "Native SDK event", {
    text: full,
    nested: {
      apiKey: "another-secret",
      output: 'secret-"quoted"\nvalue',
      database_error: "password was privatePassword",
    },
    error: new Error("synthetic failure"),
  });
  const stored = readFileSync(
    artifactPath(join(root, "artifacts"), reference.artifact_id),
  );
  const payload = JSON.parse(stored.toString());
  assert.equal(payload.text, full);
  assert.equal(payload.nested.apiKey, "[REDACTED]");
  assert.equal(payload.nested.output, "[REDACTED]");
  assert.equal(payload.nested.database_error, "password was [REDACTED]");
  assert.match(payload.error.stack, /synthetic failure/);
  assert.equal(stored.byteLength, reference.artifact_bytes);
  assert.equal(
    createHash("sha256").update(stored).digest("hex"),
    reference.artifact_sha256,
  );
  const event = JSON.parse(
    readFileSync(join(root, "structured/test.jsonl"), "utf8"),
  );
  assert.equal(event.attempt_id, "attempt-123");
  assert.equal(event.job_id, "job-456");
  assert.equal(event.release, "test-sha");
  assert.equal(event.artifact_redacted, true);
  assert.equal(event.artifact_id, reference.artifact_id);
  assert.ok(!JSON.stringify(event).includes(full));
});

test("reject traversal and report unavailable evidence storage instead of claiming a saved artifact", (t) => {
  const root = mkdtempSync(join(temporary, "invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => artifactPath(root, "../../runtime.env"),
    /Invalid artifact/,
  );
  const logger = createLogger("test", { logDirectory: root, environment: {} });
  assert.throws(
    () => logger.payload("sdk.event", "No storage", {}),
    /ARTIFACT_DIR/,
  );
  assert.throws(() => createLogger("../../test"), /Invalid log service/);
  assert.throws(
    () => ensureStorageDirectory("./relative-data"),
    /absolute normalized/,
  );
  assert.throws(() =>
    ensureStorageDirectory("/Volumes/code-assist-nonexistent-test-volume/data"),
  );
});

test("AWS session credentials are redacted from structured fields and embedded tool output", (t) => {
  const root = mkdtempSync(join(temporary, "aws-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logger = createLogger("test", {
    logDirectory: root,
    artifactDirectory: join(root, "artifacts"),
    environment: {
      AWS_ACCESS_KEY_ID: "synthetic-aws-id",
      AWS_SECRET_ACCESS_KEY: "synthetic-aws-secret",
      AWS_SESSION_TOKEN: "synthetic-aws-token",
    },
  });
  const result = logger.payload("aws.event", "AWS tool output", {
    output: "synthetic-aws-id synthetic-aws-secret synthetic-aws-token",
    credentials: {
      AccessKeyId: "another-id",
      SecretAccessKey: "another-secret",
      SessionToken: "another-token",
    },
  });
  const payload = JSON.parse(
    readFileSync(
      artifactPath(join(root, "artifacts"), result.artifact_id),
      "utf8",
    ),
  );
  assert.equal(payload.output, "[REDACTED] [REDACTED] [REDACTED]");
  assert.deepEqual(payload.credentials, {
    AccessKeyId: "[REDACTED]",
    SecretAccessKey: "[REDACTED]",
    SessionToken: "[REDACTED]",
  });
});
