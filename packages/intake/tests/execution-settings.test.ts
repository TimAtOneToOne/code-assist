import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  readExecutionSettings,
  writeExecutionSettings,
} from "../src/execution-settings.ts";

test("execution limits default to three, preserve legacy discovery settings and validate both fields", () => {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/execution-settings-tests",
  );
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "settings-"));
  try {
    assert.deepEqual(readExecutionSettings(directory), {
      maxParallelDiscoveries: 3,
      maxParallelCodingSessions: 3,
    });
    writeExecutionSettings(directory, {
      maxParallelDiscoveries: 2,
      maxParallelCodingSessions: 3,
    });
    assert.equal(readExecutionSettings(directory).maxParallelDiscoveries, 2);
    const file = join(directory, "execution.json");
    writeFileSync(file, JSON.stringify({ maxParallelDiscoveries: 2 }));
    assert.deepEqual(readExecutionSettings(directory), {
      maxParallelDiscoveries: 2,
      maxParallelCodingSessions: 3,
    });
    writeExecutionSettings(directory, {
      maxParallelDiscoveries: 4,
      maxParallelCodingSessions: 2,
    });
    assert.deepEqual(readExecutionSettings(directory), {
      maxParallelDiscoveries: 4,
      maxParallelCodingSessions: 2,
    });
    const before = readFileSync(file, "utf8");
    for (const value of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "3",
      null,
    ]) {
      assert.throws(
        () =>
          writeExecutionSettings(directory, {
            maxParallelDiscoveries: value as number,
            maxParallelCodingSessions: 3,
          }),
        /whole number/,
      );
      assert.throws(
        () =>
          writeExecutionSettings(directory, {
            maxParallelDiscoveries: 3,
            maxParallelCodingSessions: value as number,
          }),
        /whole number/,
      );
      assert.equal(readFileSync(file, "utf8"), before);
    }
    assert.equal(statSync(file).mode & 0o777, 0o600);
    writeFileSync(file, "invalid");
    assert.throws(
      () => readExecutionSettings(directory),
      /Saved execution configuration is invalid/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
