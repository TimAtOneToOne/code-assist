import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  readModelSettings,
  writeModelSettings,
} from "../src/model-settings.ts";

test("model changes persist, new reads see them, and rejected writes preserve saved selections", async () => {
  const base = resolve("../../.tmp/model-settings/tests");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "settings-"));
  try {
    const initial = readModelSettings(dir);
    assert.deepEqual(initial, {
      codex: "gpt-6.1-sol",
      claude: "claude-opus-5-5",
    });
    writeModelSettings(dir, {
      codex: " gpt-6-luna ",
      claude: "claude-sonnet-5-5",
    });
    assert.deepEqual(readModelSettings(dir), {
      codex: "gpt-6-luna",
      claude: "claude-sonnet-5-5",
    });
    assert.equal(initial.codex, "gpt-6.1-sol");
    const file = join(dir, "models.json");
    const before = await readFile(file, "utf8");
    for (const model of ["", " ", "not a model", "model\0id"]) {
      assert.throws(() =>
        writeModelSettings(dir, { codex: model, claude: "claude-opus-5-5" }),
      );
      assert.equal(await readFile(file, "utf8"), before);
    }
    writeModelSettings(dir, {
      codex: "future-model-id",
      claude: "claude-opus-5-5[1m]",
    });
    assert.equal(readModelSettings(dir).codex, "future-model-id");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await writeFile(file, "invalid-json");
    assert.throws(
      () => readModelSettings(dir),
      /Saved model configuration is invalid/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
