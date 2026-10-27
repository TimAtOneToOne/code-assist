import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Ticket } from "../src/linear.ts";
import {
  parseSetupScan,
  prepareRepositorySetups,
  setupScanPrompt,
  type SetupProgress,
} from "../src/repository-setup-discovery.ts";
import {
  emptyRepositorySetup,
  readRepositorySetup,
  repositorySetupContext,
  writeRepositorySetup,
} from "../src/repository-settings.ts";

const config = {
  ...emptyRepositorySetup(),
  setupScript: "npm ci",
  validationScript: "npm run lint\nnpm test",
};
const scan = {
  summary: "Package scripts define validation.",
  findings: [],
  questions: [],
  configuration: config,
};
const snapshot = {
  name: "fixture",
  source: "/repos/fixture",
  directory: "/snapshots/fixture",
  commit: "a".repeat(40),
};
const ticket: Ticket = {
  id: "fixture-ticket",
  identifier: "ONE-123",
  title: "Remove document answers",
  url: "https://linear.app/example/ONE-123",
  description: "Remove document answers. Keep original uploaded documents.",
  labels: ["Plan"],
  comments: [],
  updatedAt: "2026-10-26T00:00:00Z",
};
function fixture() {
  const root = join(
    import.meta.dirname,
    "../../../.tmp/repository-setup-discovery",
  );
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "unit-"));
}

test("setup scans validate structured fields while allowing intentional optional blanks and unanswered setup", () => {
  assert.deepEqual(
    parseSetupScan({
      ...scan,
      configuration: { ...config, environment: [], gitDependencies: [] },
    }),
    scan,
  );
  assert.throws(
    () => parseSetupScan({ ...scan, configuration: null }),
    /no configuration/,
  );
  const blocked = {
    ...scan,
    configuration: null,
    questions: [
      {
        question: "Which test identity?",
        context: "No test identity is documented.",
        options: [],
      },
    ],
  };
  assert.deepEqual(parseSetupScan(blocked), blocked);
  assert.throws(
    () =>
      parseSetupScan({
        ...scan,
        configuration: { ...config, environment: [], validationScript: "" },
      }),
    /validation/,
  );
  assert.throws(
    () =>
      parseSetupScan({
        ...scan,
        configuration: {
          ...config,
          environment: [
            { name: "TOKEN", value: "a" },
            { name: "TOKEN", value: "b" },
          ],
        },
      }),
    /environment/,
  );
  const context = repositorySetupContext({
    ...config,
    environment: { TOKEN: "sensitive" },
  });
  assert.deepEqual(context.environmentVariables, ["TOKEN"]);
  assert(!JSON.stringify(context).includes("sensitive"));
  assert.equal(context.configuration.validationScript, config.validationScript);
  assert.match(
    setupScanPrompt(snapshot, ticket, [], ["TOKEN"], ["fixture"]),
    /native Playwright MCP/,
  );
  assert.match(
    setupScanPrompt(snapshot, ticket, [], [], [], {
      prompts: { global: "Saved global guidance" },
      repositories: {
        [snapshot.source]: { planning: "Repository-specific setup guidance" },
      },
    }),
    /Repository-specific setup guidance/,
  );
});

test("setup receives the ticket and owner-facing guidance even with saved prompt overrides", () => {
  const prompt = setupScanPrompt(
    snapshot,
    ticket,
    [{ answers: ["Keep the original documents"] }],
    ["EXISTING_ACCESS"],
    ["company-library"],
    { prompts: { planning: "Use detailed source evidence" }, repositories: {} },
  );
  assert(prompt.includes(JSON.stringify(ticket)));
  assert.match(prompt, /Keep the original documents/);
  assert.match(prompt, /EXISTING_ACCESS/);
  assert.match(prompt, /company-library/);
  assert.match(prompt, /Use detailed source evidence/);
  assert.match(prompt, /WHEN \/ IF \/ THEN \/ OTHERWISE/);
  assert.match(prompt, /preliminary understanding/);
  assert.match(prompt, /feature questions come after setup/);
  assert.match(prompt, /never request secret values in replies/);
  assert.match(prompt, /Do not edit files/);
});

test("intake tests missing configurations before saving and reuses them for later tickets", async () => {
  const directory = fixture();
  let scans = 0,
    tests = 0;
  const progress: SetupProgress[][] = [];
  const hooks = {
    current: async () => {},
    progress: async (entries: SetupProgress[]) => {
      progress.push(structuredClone(entries));
    },
    scan: async () => {
      scans++;
      return scan;
    },
    test: async (
      _s: typeof snapshot,
      _c: typeof config,
      created: (id: string) => Promise<void>,
    ) => {
      tests++;
      assert.equal(
        readRepositorySetup(directory, snapshot.source).configuration,
        null,
      );
      await created("test-id");
    },
    publish: async () =>
      writeRepositorySetup(directory, snapshot.source, config),
  };
  try {
    const first = await prepareRepositorySetups(directory, [snapshot], hooks);
    assert.equal(first.questions, null);
    assert.equal(
      first.contexts[snapshot.source].configuration.validationScript,
      config.validationScript,
    );
    assert.equal(progress.at(-1)![0].status, "saved");
    assert.equal(progress.at(-1)![0].testId, "test-id");
    await prepareRepositorySetups(directory, [snapshot], hooks);
    assert.equal(scans, 1);
    assert.equal(tests, 1);
    assert.equal(progress.at(-1)![0].status, "reused");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("questions, failed tests, and superseded inputs never save an unverified setup", async () => {
  for (const scenario of ["questions", "failure", "superseded"] as const) {
    const directory = fixture();
    let tested = false,
      stale = false;
    try {
      const result = prepareRepositorySetups(directory, [snapshot], {
        current: async () => {
          if (stale) throw new Error("superseded");
        },
        progress: async () => {},
        scan: async () =>
          scenario === "questions"
            ? {
                ...scan,
                configuration: null,
                questions: [
                  {
                    question: "Map SERVICE_TOKEN in Secrets?",
                    context: "Required by repository tests.",
                    options: [],
                  },
                ],
              }
            : scan,
        test: async () => {
          tested = true;
          if (scenario === "failure") throw new Error("test failed");
          stale = true;
        },
        publish: async () => {
          throw new Error("must not save");
        },
      });
      if (scenario === "questions") {
        assert.equal((await result).questions?.questions.length, 1);
        assert.equal(tested, false);
      } else
        await assert.rejects(
          result,
          scenario === "failure" ? /test failed/ : /superseded/,
        );
      assert.equal(
        readRepositorySetup(directory, snapshot.source).configuration,
        null,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("multi-repository intake preserves configured repos and settings saved during a scan", async () => {
  const directory = fixture();
  const configured = {
    ...snapshot,
    name: "existing",
    source: "/repos/existing",
  };
  const ownerConfig = { ...config, validationScript: "make check" };
  try {
    writeRepositorySetup(directory, configured.source, ownerConfig);
    const result = await prepareRepositorySetups(
      directory,
      [configured, snapshot],
      {
        current: async () => {},
        progress: async () => {},
        scan: async (s) => {
          assert.equal(s.source, snapshot.source);
          writeRepositorySetup(directory, s.source, ownerConfig);
          return scan;
        },
        test: async () => {
          throw new Error("must reuse saved setup");
        },
        publish: async () => {
          throw new Error("must preserve saved setup");
        },
      },
    );
    assert.equal(
      result.contexts[snapshot.source].configuration.validationScript,
      "make check",
    );
    assert.equal(
      result.contexts[configured.source].configuration.validationScript,
      "make check",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an owner save during testing wins over the tested proposal", async () => {
  const directory = fixture();
  const ownerConfig = { ...config, validationScript: "make validate" };
  let last: SetupProgress[] = [];
  try {
    const result = await prepareRepositorySetups(directory, [snapshot], {
      current: async () => {},
      progress: async (entries) => {
        last = structuredClone(entries);
      },
      scan: async () => scan,
      test: async () => {
        writeRepositorySetup(directory, snapshot.source, ownerConfig);
      },
      publish: async () =>
        readRepositorySetup(directory, snapshot.source).configuration!,
    });
    assert.equal(
      result.contexts[snapshot.source].configuration.validationScript,
      "make validate",
    );
    assert.equal(last[0].status, "reused");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("later tickets reuse setup commands with newly resolved dependency pins without rewriting the saved recipe", async () => {
  const directory = fixture();
  const saved = {
    ...config,
    gitDependencies: [{ repository: "library", commits: ["a".repeat(40)] }],
  };
  writeRepositorySetup(directory, snapshot.source, saved);
  try {
    const pins = [{ repository: "library", commits: ["b".repeat(40)] }];
    const result = await prepareRepositorySetups(directory, [snapshot], {
      current: async () => {},
      progress: async () => {},
      dependencies: async (_source, configuration) => {
        assert.deepEqual(configuration, saved);
        return { pins, questions: [] };
      },
      scan: async () => {
        throw new Error("must reuse setup recipe");
      },
      test: async () => {
        throw new Error("setup is already configured");
      },
      publish: async () => {
        throw new Error("must not rewrite saved setup");
      },
    });
    assert.deepEqual(
      result.contexts[snapshot.source].configuration.gitDependencies,
      pins,
    );
    assert.equal(
      result.contexts[snapshot.source].configuration.validationScript,
      saved.validationScript,
    );
    assert.deepEqual(
      readRepositorySetup(directory, snapshot.source).configuration,
      saved,
    );
    assert.deepEqual(Object.keys(result.contexts), [snapshot.source]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
