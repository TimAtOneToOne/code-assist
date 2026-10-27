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

test("discovery parallelism defaults to three, persists changes and rejects invalid settings", () => {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/execution-settings-tests",
  );
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "settings-"));
  try {
    assert.deepEqual(readExecutionSettings(directory), {
      maxParallelDiscoveries: 3,
    });
    writeExecutionSettings(directory, { maxParallelDiscoveries: 2 });
    assert.equal(readExecutionSettings(directory).maxParallelDiscoveries, 2);
    const file = join(directory, "execution.json");
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
