import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  compileRepositoryProfile,
  defaultRepositorySetup,
  emptyRepositorySetup,
  loadRepositoryProfile,
  profileEnvironment,
  readRepositorySetup,
  validateRepositorySetup,
  writeRepositorySetup,
} from "../src/repository-settings.ts";

function fixture() {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/repository-setup-tests",
  );
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "profile-"));
}
test("saved profiles drive workspace commands, pin prior configuration, and isolate generated environment", () => {
  const directory = fixture();
  try {
    const repo = "/repos/new-app";
    const initial = {
      ...emptyRepositorySetup(),
      workingDirectory: "apps/web",
      setupScript: "pnpm install\npnpm db:migrate",
      validationScript: "pnpm lint\npnpm test",
      environment: { DATABASE_URL: "postgres://localhost/local" },
      generatedVariables: ["SESSION_SECRET"],
    };
    writeRepositorySetup(directory, repo, initial);
    const pinned = loadRepositoryProfile(directory, repo);
    writeRepositorySetup(directory, repo, {
      ...initial,
      validationScript: "make validate",
    });
    assert.equal(
      pinned.configuration.validationScript,
      initial.validationScript,
    );
    assert.equal(pinned.cwd, "/work/new-app/apps/web");
    assert.equal(pinned.setup[0][2], initial.setupScript);
    assert.notEqual(loadRepositoryProfile(directory, repo).hash, pinned.hash);
    const a = profileEnvironment(pinned, {
      DATABASE_URL: "shared",
      TOKEN: "provider",
    });
    const b = profileEnvironment(pinned, {
      DATABASE_URL: "shared",
      TOKEN: "provider",
    });
    assert.equal(a.DATABASE_URL, initial.environment.DATABASE_URL);
    assert.equal(a.TOKEN, "provider");
    assert.notEqual(a.SESSION_SECRET, b.SESSION_SECRET);
    assert.equal(a.SESSION_SECRET.length, 64);
    assert.equal(readRepositorySetup(directory, repo).custom, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("built-in configurations preserve local overrides and require complete setup before coding", () => {
  const directory = fixture();
  try {
    for (const name of [
      "internal-chat-ui",
      "workplace-agents",
      "elation_companion",
    ]) {
      const config = defaultRepositorySetup(name)!;
      assert.deepEqual(
        loadRepositoryProfile(directory, "/repos/" + name),
        compileRepositoryProfile(name, config),
      );
    }
    assert.equal(
      defaultRepositorySetup("internal-chat-ui")!.environment.AWS_ENDPOINT_URL,
      "http://127.0.0.1:4566",
    );
    assert.equal(
      defaultRepositorySetup("workplace-agents")!.environment.ORIGIN,
      "http://localhost:6001",
    );
    assert.throws(
      () => loadRepositoryProfile(directory, "/repos/new"),
      /not configured/,
    );
    const config = { ...emptyRepositorySetup(), validationScript: "make test" };
    for (const gitDependencies of [
      [{ repository: "../outside", commits: ["a".repeat(40)] }],
      [{ repository: "gitops", commits: ["main"] }],
      [{ repository: "gitops", commits: [] }],
      [{ repository: 123, commits: ["a".repeat(40)] }],
    ])
      assert.throws(
        () => validateRepositorySetup({ ...config, gitDependencies }),
        /Git dependencies/,
      );
    assert.deepEqual(
      validateRepositorySetup({ ...config, gitDependencies: [] }),
      config,
    );
    for (const workingDirectory of [
      "/etc",
      "../other",
      "a/../../other",
      "a\\b",
    ])
      assert.throws(
        () => validateRepositorySetup({ ...config, workingDirectory }),
        /inside/,
      );
    assert.throws(
      () => validateRepositorySetup({ ...config, validationScript: "" }),
      /validation/,
    );
    assert.throws(
      () => validateRepositorySetup({ ...config, startScript: "make dev" }),
      /readiness/,
    );
    assert.throws(
      () => validateRepositorySetup({ ...config, environment: { TOKEN: 1 } }),
      /overrides/,
    );
    assert.throws(
      () =>
        validateRepositorySetup({
          ...config,
          environment: { TOKEN: "local" },
          generatedVariables: ["TOKEN"],
        }),
      /Generated/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("coding checkpoint exports resolve settings against the approved original repository", async () => {
  const { prepareWorkspace } = await import("../src/workspace.ts");
  const directory = fixture();
  const priorArtifacts = process.env.CODE_ASSIST_ARTIFACT_DIR;
  process.env.CODE_ASSIST_ARTIFACT_DIR = join(directory, "artifacts");
  try {
    const snapshot = {
      name: "fixture",
      source: "/synced/fixture",
      commit: "a".repeat(40),
      directory: "/snapshot/fixture",
    };
    const config = {
      ...emptyRepositorySetup(),
      validationScript: "make check",
      instructions: "original source settings",
    };
    writeRepositorySetup(directory, snapshot.source, config);
    let captured = false;
    const db = {
      executeSql: async () => ({
        rows: [
          {
            planning_id: "planning",
            current_version: 1,
            plan_hash: "hash",
            input_hash: "inputs",
            snapshots: [snapshot],
          },
        ],
      }),
    };
    await assert.rejects(
      prepareWorkspace(
        directory,
        db as import("pg-boss").Db,
        "ticket",
        AbortSignal.abort(),
        async (workspace) => {
          captured = true;
          assert.equal(
            workspace.profiles!.fixture.configuration.instructions,
            config.instructions,
          );
        },
        { ...snapshot, source: "/controller/checkpoint/repository.git" },
      ),
      /failed during creating machine/,
    );
    assert.equal(captured, true);
  } finally {
    if (priorArtifacts === undefined)
      delete process.env.CODE_ASSIST_ARTIFACT_DIR;
    else process.env.CODE_ASSIST_ARTIFACT_DIR = priorArtifacts;
    rmSync(directory, { recursive: true, force: true });
  }
});
