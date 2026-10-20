import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import {
  deleteMapping,
  deleteSecret,
  listConfiguration,
  revealSecret,
  resolveRepositoryEnvironment,
  saveMapping,
  saveSecret,
} from "../src/store.ts";

function fixture(t: TestContext) {
  const root = fileURLToPath(
    new URL("../../../.tmp/secrets/tests/", import.meta.url),
  );
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(join(root, "store-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test("metadata omits values; reveal and rotation preserve exact multiline credentials", (t) => {
  const directory = fixture(t);
  const value = "  synthetic-$()'\"\\secret\nline two\n";
  const secret = saveSecret(directory, {
    name: "Shared AI",
    description: "Test",
    value,
  });
  assert(!JSON.stringify(listConfiguration(directory)).includes("synthetic"));
  assert.equal(revealSecret(directory, secret.id), value);
  assert.equal(statSync(join(directory, "secrets")).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(directory, "secrets/store.json")).mode & 0o777,
    0o600,
  );
  const updated = saveSecret(directory, {
    ...secret,
    description: "Updated notes",
    value: "",
  });
  assert.equal(updated.id, secret.id);
  assert.equal(revealSecret(directory, secret.id), value);
  assert.throws(() => revealSecret(directory, "missing"), /not found/);
});

test("repository mappings resolve only selected keys and follow rotation, replacement and removal", (t) => {
  const directory = fixture(t);
  const a = saveSecret(directory, {
    name: "A",
    description: "",
    value: "synthetic-a",
  });
  const b = saveSecret(directory, {
    name: "B",
    description: "",
    value: "synthetic-b",
  });
  const first = join(directory, "repo-one"),
    second = join(directory, "repo-two");
  saveMapping(directory, {
    repository: first,
    variable: "PROVIDER_TOKEN",
    secretId: a.id,
  });
  saveMapping(directory, {
    repository: second,
    variable: "OPENAI_API_KEY",
    secretId: a.id,
  });
  assert.deepEqual(resolveRepositoryEnvironment(directory, first), {
    PROVIDER_TOKEN: "synthetic-a",
  });
  assert.deepEqual(
    resolveRepositoryEnvironment(directory, join(directory, "unmapped")),
    {},
  );
  saveSecret(directory, { ...a, value: "rotated" });
  assert.deepEqual(resolveRepositoryEnvironment(directory, second), {
    OPENAI_API_KEY: "rotated",
  });
  saveMapping(directory, {
    repository: first,
    variable: "PROVIDER_TOKEN",
    secretId: b.id,
  });
  assert.equal(listConfiguration(directory).mappings.length, 2);
  const output = execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(process.env.PROVIDER_TOKEN)"],
    {
      env: resolveRepositoryEnvironment(directory, first),
      encoding: "utf8",
    },
  );
  assert.equal(output, "synthetic-b");
  assert.throws(() => deleteSecret(directory, a.id), /Remove.*mappings/);
  deleteMapping(directory, second, "OPENAI_API_KEY");
  deleteSecret(directory, a.id);
  assert.deepEqual(resolveRepositoryEnvironment(directory, second), {});
  assert.equal(listConfiguration(directory).secrets.length, 1);
});

test("invalid changes do not overwrite saved configuration or reveal credentials in errors", (t) => {
  const directory = fixture(t);
  const secret = saveSecret(directory, {
    name: "Existing",
    description: "",
    value: "synthetic-secret",
  });
  const file = join(directory, "secrets/store.json");
  const before = readFileSync(file, "utf8");
  assert.throws(
    () =>
      saveSecret(directory, {
        name: "Existing",
        description: "",
        value: "another",
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      saveSecret(directory, {
        name: "Invalid",
        description: "",
        value: "private\0value",
      }),
    /null characters/,
  );
  for (const variable of ["1INVALID", "BAD=KEY", "BAD-KEY"]) {
    assert.throws(
      () =>
        saveMapping(directory, {
          repository: directory,
          variable,
          secretId: secret.id,
        }),
      /valid environment/,
    );
  }
  assert.throws(
    () =>
      saveMapping(directory, {
        repository: directory,
        variable: "TOKEN",
        secretId: "missing",
      }),
    /saved secret/,
  );
  assert.equal(readFileSync(file, "utf8"), before);
  writeFileSync(file, '{"private-synthetic-secret": invalid}');
  assert.throws(
    () => listConfiguration(directory),
    (error) => {
      assert(error instanceof Error);
      assert(!error.message.includes("private-synthetic-secret"));
      return true;
    },
  );
  assert.throws(() =>
    saveSecret(directory, { name: "New", description: "", value: "x" }),
  );
  assert.equal(
    readFileSync(file, "utf8"),
    '{"private-synthetic-secret": invalid}',
  );
});
