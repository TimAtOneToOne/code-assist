import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "@code-assist/observability";
import { checkCodingBranch, publishCoding } from "../src/coding-publish.ts";
import { executeCoding, codingPrompt } from "../src/coding-runtime.ts";
import { cleanupFixture } from "./fixtures/cleanup.ts";
import {
  publicationDescriptions,
  descriptionHashes,
  descriptionContext,
} from "../src/coding-description.ts";
import { assessAcceptance } from "../src/acceptance.ts";
import type { CodingStep } from "../src/coding-types.ts";
import { publicationReady } from "../src/coding-repositories.ts";

test("new PR publication and lost-response recovery keep private tooling out of external content", async () => {
  const { directory, source, run } = await cleanupFixture();
  const origin = join(directory, "origin.git");
  const remote = "https://github.com/example/fixture.git";
  const url = "https://github.com/example/fixture/pull/1";
  const signal = new AbortController().signal;
  const log = createLogger("publication-test", {
    logDirectory: join(directory, "logs"),
    artifactDirectory: join(directory, "artifacts"),
  });
  try {
    execFileSync("/usr/bin/git", [
      "-C",
      source,
      "remote",
      "add",
      "origin",
      remote,
    ]);
    execFileSync("/usr/bin/git", [
      "-C",
      source,
      "update-ref",
      "refs/heads/main",
      run.commit!,
    ]);
    execFileSync("/usr/bin/git", [
      "clone",
      "--quiet",
      "--bare",
      source,
      origin,
    ]);
    const description =
      "## Summary\n\nCapture GitHub deliveries.\n\nBefore merge: create staging and production webhook secrets. These have not been created; webhook registration and live delivery verification follow deployment.\n\n**Optional optimizations and controls:** none.\n";
    let body = "",
      title = "",
      creates = 0;
    const execute: typeof executeCoding = async (
      command,
      args,
      abort,
      logger,
    ) => {
      if (command.endsWith("/gh")) {
        if (args[0] === "repo")
          return JSON.stringify({ defaultBranchRef: { name: "main" } });
        if (args[1] === "create") {
          title = args[args.indexOf("--title") + 1];
          body = await readFile(args.at(-1)!, "utf8");
          creates++;
          throw new Error("Lost PR response");
        }
        assert.equal(args[1], "list");
        return JSON.stringify(
          creates
            ? [
                {
                  state: "OPEN",
                  headRefOid: run.commit,
                  baseRefName: "main",
                  url,
                  body,
                },
              ]
            : [],
        );
      }
      return executeCoding(
        command,
        args.map((arg) => (arg === remote ? origin : arg)),
        abort,
        logger,
      );
    };
    await assert.rejects(
      publishCoding(
        directory,
        run,
        signal,
        log,
        async () => {},
        execute,
        description,
      ),
      /Lost PR response/,
    );
    assert.equal(
      await publishCoding(
        directory,
        run,
        signal,
        log,
        async () => {},
        execute,
        description,
      ),
      url,
    );
    assert.equal(creates, 1);
    assert.doesNotMatch(
      body + title,
      /Code Assist|code-assist|100\.91\.0\.83|Claude|Codex|approved plan/,
    );
    assert(body.startsWith(description.trim()));
    assert(
      body.includes(
        "Before merge: create staging and production webhook secrets",
      ),
    );
    assert(body.includes("These have not been created"));
    assert(body.includes(run.commit!));
    assert(body.includes("Optional optimizations and controls"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reply requires fresh validation and review even when the code is unchanged", async () => {
  const { directory, run, steps } = await cleanupFixture();
  try {
    assert(publicationReady(run, steps));
    const reply = {
      id: randomUUID(),
      stepId: randomUUID(),
      question: "Accept deployment interruption?",
      text: "Yes.",
      requestedBy: "owner",
      createdAt: new Date().toISOString(),
    };
    const resumed = { ...run, direction_responses: [reply] };
    assert.equal(publicationReady(resumed, steps), false);
    const checked = steps.map((step) =>
      step.kind === "validate"
        ? { ...step, direction_response_id: reply.id }
        : step,
    );
    assert.equal(publicationReady(resumed, checked), false);
    assert(
      publicationReady(
        resumed,
        checked.map((step) => ({ ...step, direction_response_id: reply.id })),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("code revisions fast-forward the owned PR, recover a lost push response, and preserve its description", async () => {
  const fixture = await cleanupFixture();
  const { directory, source, path } = fixture;
  const origin = join(directory, "origin.git");
  const remote = "https://github.com/example/fixture.git";
  const prUrl = "https://github.com/example/fixture/pull/1";
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", ["-C", source, ...args], {
      encoding: "utf8",
    }).trim();
  const signal = new AbortController().signal;
  const log = createLogger("publication-test", {
    logDirectory: join(directory, "logs"),
    artifactDirectory: join(directory, "artifacts"),
  });
  try {
    const base = fixture.run.commit!;
    git("remote", "add", "origin", remote);
    git("update-ref", "refs/heads/main", base);
    execFileSync("/usr/bin/git", [
      "clone",
      "--quiet",
      "--bare",
      source,
      origin,
    ]);
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "update-ref",
      `refs/heads/${fixture.run.branch}`,
      base,
    ]);
    await writeFile(join(source, "feature.txt"), "requested revision\n");
    git("add", "feature.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "revision",
    );
    const candidate = git("rev-parse", "HEAD");
    execFileSync("/usr/bin/git", [
      "--git-dir",
      join(path, "repository.git"),
      "fetch",
      "--quiet",
      source,
      "HEAD",
    ]);
    const request = {
      id: randomUUID(),
      text: "Use a clearer confirmation. Internal Code Assist notes: http://100.91.0.83:3000/tickets/private",
      requestedBy: "owner",
      createdAt: new Date().toISOString(),
      baseCommits: { fixture: base },
      pullRequests: { fixture: prUrl },
    };
    await writeFile(
      join(source, "feature.txt"),
      "another contributor's work\n",
    );
    git("add", "feature.txt");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "external work",
    );
    const external = git("rev-parse", "HEAD");
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "fetch",
      "--quiet",
      source,
      "HEAD",
    ]);
    const run = {
      ...fixture.run,
      status: "publish" as const,
      commit: candidate,
      pr_url: prUrl,
      merged_at: null,
      merge_commit: null,
      main_workflows: null,
      change_requests: [request],
    };
    let body = `## Summary\n\nUser-added context stays here.\n\n- fixture: ${base}\n\n[Code Assist plan, validation and review](http://100.91.0.83:3000/tickets/${run.issue_id})\n\n<!-- code-assist:${run.id} -->`;
    let state = "OPEN",
      pushes = 0,
      edits = 0,
      losePushResponse = true,
      racePush = false;
    const head = () =>
      execFileSync(
        "/usr/bin/git",
        ["--git-dir", origin, "rev-parse", `refs/heads/${run.branch}`],
        { encoding: "utf8" },
      ).trim();
    const execute: typeof executeCoding = async (
      command,
      args,
      abort,
      logger,
    ) => {
      if (command.endsWith("/gh")) {
        if (args[0] === "repo")
          return JSON.stringify({ defaultBranchRef: { name: "main" } });
        if (args[1] === "edit") {
          body = await readFile(args.at(-1)!, "utf8");
          edits++;
          return "";
        }
        assert(
          ["view", "list"].includes(args[1]),
          "must never open a second PR",
        );
        const pr = {
          state,
          headRefOid: head(),
          baseRefName: "main",
          url: prUrl,
          body,
        };
        return JSON.stringify(args[1] === "list" ? [pr] : pr);
      }
      const isPush = args.includes("push");
      if (isPush) {
        pushes++;
        assert(
          args.includes(`--force-with-lease=refs/heads/${run.branch}:${base}`),
        );
        if (racePush)
          execFileSync("/usr/bin/git", [
            "--git-dir",
            origin,
            "update-ref",
            `refs/heads/${run.branch}`,
            external,
          ]);
      }
      const result = await executeCoding(
        command,
        args.map((arg) => (arg === remote ? origin : arg)),
        abort,
        logger,
      );
      if (isPush && losePushResponse) {
        losePushResponse = false;
        throw new Error("Lost push response");
      }
      return result;
    };
    await checkCodingBranch(run, signal, log, execute);
    for (const invalid of ["MERGED", "CLOSED"]) {
      state = invalid;
      await assert.rejects(
        checkCodingBranch(run, signal, log, execute),
        /merged, closed/,
      );
      await assert.rejects(
        publishCoding(directory, run, signal, log, async () => {}, execute),
        /merged, closed/,
      );
    }
    state = "OPEN";
    const ownedBody = body;
    body = "Somebody else's PR";
    await assert.rejects(
      checkCodingBranch(run, signal, log, execute),
      /merged, closed/,
    );
    body = ownedBody;
    await assert.rejects(
      publishCoding(directory, run, signal, log, async () => {}, execute),
      /Lost push response/,
    );
    assert.equal(head(), candidate);
    assert.equal(
      await publishCoding(directory, run, signal, log, async () => {}, execute),
      prUrl,
    );
    assert.equal(pushes, 1);
    assert.equal(edits, 1);
    assert(body.includes("User-added context stays here."));
    assert(body.includes(`- fixture: ${candidate}`));
    assert.doesNotMatch(
      body,
      /Code Assist|code-assist|100\.91\.0\.83|Claude|Codex/,
    );
    assert(body.includes(`<!-- publication:${run.id} -->`));
    assert(body.includes(`<!-- revision:${request.id} -->`));
    await publishCoding(directory, run, signal, log, async () => {}, execute);
    assert.equal(pushes, 1);
    assert.equal(edits, 1);

    // Simulate another writer changing the head between the read and the push.
    await rm(join(path, `publication-${request.id}.json`));
    execFileSync("/usr/bin/git", [
      "--git-dir",
      origin,
      "update-ref",
      `refs/heads/${run.branch}`,
      base,
    ]);
    racePush = true;
    await assert.rejects(
      publishCoding(directory, run, signal, log, async () => {}, execute),
    );
    assert.equal(head(), external, "another writer's head is not overwritten");
    await assert.rejects(
      checkCodingBranch(run, signal, log, execute),
      /branch changed/,
    );

    const promptRun = {
      ...run,
      direction_responses: [
        {
          id: "reply",
          stepId: "step",
          question: "Migration ordering?",
          text: "Accept the deployment gap and withdraw the ordering change.",
          requestedBy: "owner",
          createdAt: new Date().toISOString(),
        },
      ],
      workspace_id: null,
      input: {
        ...run.input,
        snapshot: { ...run.input.snapshot, name: "internal-chat-ui" },
      },
      plan: { markdown: "Approved feature", changeSummary: "", responses: [] },
    };
    for (const kind of ["implement", "review"] as const) {
      const prompt = await codingPrompt(
        directory,
        promptRun,
        { ...fixture.steps[0], kind },
        [],
      );
      assert(prompt.includes(request.text));
      assert(prompt.includes("material scope change"));
      assert(prompt.includes("fresh validation evidence"));
      assert(prompt.includes(promptRun.direction_responses[0].text));
      assert(
        prompt.includes(
          "do not repeatedly block on that same accepted concern",
        ),
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PR text can pass acceptance before secrets or a GitHub PR exist and cannot change after review", async () => {
  const { directory, run, steps } = await cleanupFixture();
  try {
    const description =
      "## Summary\n\nCapture deliveries. Before merge: create both environment secrets; neither exists yet.\n\nOptional optimizations and controls: none.\n";
    run.plan.acceptanceScenarios = [
      {
        id: "GH-05",
        title: "Operator Prerequisites",
        repositories: ["fixture"],
        method: "inspection",
        procedure: "Inspect the proposed PR description",
        expectedOutcome:
          "Both secrets must exist before merge; no live deployment claimed",
      },
    ];
    const implementation = {
      ...steps[0],
      kind: "collect",
      continuation: {
        kind: "implement",
        agentStepId: steps[0].id,
        result: {},
        browserCalls: [],
      },
      result: {
        disposition: "implemented",
        commit: run.commit,
        pullRequestDescription: description,
      },
    } as CodingStep;
    const history = [implementation, steps[1]];
    assert.equal(run.pr_url, null);
    const descriptions = publicationDescriptions(run, history);
    assert.equal(descriptions.fixture, description);
    assert.match(
      descriptionContext(run, history),
      /read-only.*publication-descriptions.json/,
    );
    const hashes = descriptionHashes(descriptions);
    const result = {
      summary: "Proposed description documents pending secrets",
      scenarios: [
        {
          id: "GH-05",
          status: "passed" as const,
          observed:
            "The proposed description requires both secrets before merge and says neither exists yet.",
          toolCallIds: ["read-draft"],
          artifacts: [],
        },
      ],
    };
    const tools = [
      {
        id: "read-draft",
        name: "Read proposed PR description",
        kind: "inspection" as const,
        succeeded: true,
      },
    ];
    const report = {
      ...assessAcceptance(run, "acceptance", result, tools),
      publicationDescriptionHashes: hashes,
    };
    assert(report.passed);
    const attempt = {
      ...steps[0],
      id: "acceptance",
      kind: "accept",
    } as CodingStep;
    const accepted = {
      ...steps[0],
      kind: "collect",
      continuation: {
        kind: "accept",
        agentStepId: attempt.id,
        result,
        browserCalls: [],
        tools,
      },
      result: report,
    } as unknown as CodingStep;
    const review = {
      ...steps[2],
      result: { ...steps[2].result, publicationDescriptionHashes: hashes },
    };
    const complete = [...history, attempt, accepted, review];
    assert(publicationReady(run, complete));
    assert.equal(
      publicationReady(run, [...history, attempt, accepted, steps[2]]),
      false,
    );
    implementation.result!.pullRequestDescription = description.replace(
      "Before merge",
      "After merge",
    );
    assert.equal(publicationReady(run, complete), false);
    implementation.result!.pullRequestDescription = description;
    assert(publicationReady(run, complete));
    // A newer implementation with no draft must not reuse an older candidate's wording.
    const newer = {
      ...implementation,
      result: { disposition: "implemented", commit: run.commit },
    };
    assert.deepEqual(publicationDescriptions(run, [...complete, newer]), {});
    // Repositories retain their own description and candidate identity.
    run.input.snapshots = [
      run.input.snapshot,
      { ...run.input.snapshot, name: "service" },
    ];
    run.repositories = [
      { name: "fixture", commit: run.commit },
      { name: "service", commit: "b".repeat(40) },
    ] as typeof run.repositories;
    const service = {
      ...implementation,
      repository_index: 1,
      result: {
        ...implementation.result,
        commit: "b".repeat(40),
        pullRequestDescription: "## Summary\n\nService only\n",
      },
    };
    assert.deepEqual(publicationDescriptions(run, [...complete, service]), {
      fixture: description,
      service: "## Summary\n\nService only\n",
    });
    run.repositories![1].commit = "c".repeat(40);
    assert.deepEqual(publicationDescriptions(run, [...complete, service]), {
      fixture: description,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
