import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { freezeEvidence, verifyEvidence } from "../src/coding-evidence.ts";
import { readReceipt, writeReceipt } from "../src/coding-receipt.ts";
import { executeCoding } from "../src/coding-runtime.ts";
import { createLogger } from "@code-assist/observability";

function fixture() {
  const base = resolve("../../.tmp/coding-recovery/tests");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "attempt-"));
}

test("evidence replay uses a complete frozen snapshot and accepts real directories", () => {
  const work = fixture(),
    origin = randomUUID();
  try {
    mkdirSync(join(work, "evidence", "browser"), { recursive: true });
    mkdirSync(join(work, "logs"));
    writeFileSync(join(work, "evidence", "browser", "screen.png"), "original");
    writeFileSync(
      join(work, "logs", "coding.jsonl"),
      "complete agent events\n",
    );
    // Simulate a process crash during the first copy.
    mkdirSync(join(work, "receipts", origin + ".tmp"), { recursive: true });
    writeFileSync(
      join(work, "receipts", origin + ".tmp", "partial"),
      "partial",
    );
    const saved = freezeEvidence(work, origin);
    writeFileSync(
      join(work, "evidence", "browser", "screen.png"),
      "later activity",
    );
    writeFileSync(join(work, "logs", "coding.jsonl"), "later log events\n");
    assert.equal(freezeEvidence(work, origin), saved);
    assert.equal(
      readFileSync(join(saved, "evidence", "browser", "screen.png"), "utf8"),
      "original",
    );
    assert.equal(
      readFileSync(join(saved, "logs", "coding.jsonl"), "utf8"),
      "complete agent events\n",
    );
    verifyEvidence(work, origin, [
      "/work/evidence/browser/",
      "/work/evidence/browser/screen.png",
    ]);
    assert.throws(() =>
      verifyEvidence(work, origin, ["/work/evidence/missing"]),
    );
    assert.throws(() =>
      verifyEvidence(work, origin, ["/work/evidence/../logs"]),
    );
    symlinkSync(work, join(saved, "evidence", "escape"));
    assert.throws(
      () => verifyEvidence(work, origin, ["/work/evidence/escape"]),
      /escapes/,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("interrupted receipt writes cannot replace the last complete agent result", () => {
  const work = fixture();
  try {
    const path = join(work, "result.json");
    assert.equal(readReceipt(path), null);
    const receipt = {
      result: { summary: "Implemented" },
      browserCalls: ["browser_navigate"],
    };
    writeReceipt(path, receipt);
    writeFileSync(path + ".tmp", '{"partial":');
    assert.deepEqual(readReceipt(path), receipt);
    writeFileSync(path, '{"partial":');
    assert.throws(() => readReceipt(path));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("failed commands retain exit code, arguments and full redacted stderr", async () => {
  const work = fixture();
  try {
    const log = createLogger("coding", {
      logDirectory: work,
      artifactDirectory: join(work, "artifacts"),
      environment: { API_KEY: "fixture-secret-value" },
    });
    await assert.rejects(
      executeCoding(
        process.execPath,
        [
          "-e",
          "process.stderr.write('failure fixture-secret-value'); process.exit(7)",
        ],
        new AbortController().signal,
        log,
      ),
      /exited 7/,
    );
    const { readdirSync } = await import("node:fs");
    const payloads = readdirSync(join(work, "artifacts")).map((f) =>
      readFileSync(join(work, "artifacts", f), "utf8"),
    );
    const failure = payloads
      .map((s) => JSON.parse(s))
      .find((p) => p.exitCode === 7);
    assert(failure);
    assert.equal(failure.executable, process.execPath);
    assert.equal(failure.stderr, "failure [REDACTED]");
    assert(!payloads.join("").includes("fixture-secret-value"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
