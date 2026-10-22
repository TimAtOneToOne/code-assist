import assert from "node:assert/strict";
import { test } from "node:test";
import { rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { saveSecret } from "@code-assist/secrets";
import { createLogger } from "@code-assist/observability";
import { cleanupFixture } from "./fixtures/cleanup.ts";
import {
  publicationRun,
  prepareWindmillFork,
  verifyWindmillFork,
  beginWindmillSync,
  readWindmillIntent,
} from "../src/windmill-publication.ts";
import { publishCoding } from "../src/coding-publish.ts";
import { executeCoding } from "../src/coding-runtime.ts";
import { composeInstructions } from "../src/prompt-defaults.ts";
import type { CodingRun } from "../src/coding-types.ts";

function backend(run: CodingRun, base: string) {
  const workspace = `wm-fork-${run.branch.split("/").at(-1)}`;
  const resource = "$res:u/operator/git";
  const forks: { id: string; name: string; parent_workspace_id: string }[] = [];
  const calls: string[] = [];
  let deployed: string | undefined,
    failed = false;
  let createBranch = () => {};
  const handle = async (path: string, body?: unknown): Promise<unknown> => {
    calls.push(path);
    if (path === "/workspaces/users")
      return { email: "operator@example.invalid", workspaces: forks };
    if (path.endsWith("/users/whoami"))
      return { email: "operator@example.invalid" };
    if (path === "/w/production/workspaces/get_settings")
      return {
        git_sync: {
          repositories: [
            {
              git_repo_resource_path: resource,
              auto_pull: { enabled: true, sync_forks: true },
            },
          ],
        },
      };
    if (path.includes("/resources/get_value/"))
      return {
        url: "https://github.com/OnetoOneHealth/windmill-work",
        branch: "main",
        folder: "workspaces/production",
      };
    if (path.endsWith("/create_workspace_fork_branch")) {
      createBranch();
      return ["branch-job"];
    }
    if (path.endsWith("/create_fork")) {
      const input = body as { id: string; name: string };
      forks.push({ ...input, parent_workspace_id: "production" });
      return "Created";
    }
    if (path.includes("/jobs_u/get/"))
      return { type: "CompletedJob", success: true };
    if (path.includes("/git_sync_deploy_mode")) return { deploy_on_push: true };
    if (path === `/w/${workspace}/workspaces/get_settings`)
      return {
        git_sync: {
          repositories: [
            {
              git_repo_resource_path: resource,
              auto_pull: {
                last_synced_sha: { [run.branch]: deployed },
                last_pull_status:
                  deployed || failed
                    ? {
                        job_id: "sync-job",
                        success: !failed,
                        ...(failed ? {} : { synced_sha: deployed }),
                      }
                    : undefined,
              },
            },
          ],
        },
      };
    throw new Error("Unexpected request " + path);
  };
  return {
    workspace,
    forks,
    calls,
    handle,
    request: async <T>(path: string, body?: unknown) =>
      (await handle(path, body)) as T,
    deploy: (sha: string) => {
      deployed = sha;
    },
    fail: () => {
      failed = true;
    },
    onCreate: (f: () => void) => {
      createBranch = f;
    },
    git: async (args: string[]) =>
      args.includes("refs/heads/main") ? `${base}\trefs/heads/main` : "",
  };
}
const current = async () => {};
const signal = new AbortController().signal;

test("Windmill instructions and branch selection are repository-specific", async () => {
  const f = await cleanupFixture();
  try {
    assert.equal(publicationRun(f.run).branch, f.run.branch);
    f.run.input.snapshot.name = "windmill-work";
    assert.equal(publicationRun(f.run).branch, "wm-fork/main/one-999999");
    const text = composeInstructions(
      { prompts: {}, repositories: {} },
      "coding",
      null,
      [f.run.input.snapshot],
    );
    assert.match(text, /After local validation and Claude review pass/);
    assert.match(
      text,
      /controller retains the Windmill publication credential/,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("native fork creation resumes without creating a second fork and records exact synced commit", async () => {
  const f = await cleanupFixture();
  try {
    f.run.input.snapshot.name = "windmill-work";
    const run = publicationRun(f.run);
    const api = backend(run, run.commit!);
    await prepareWindmillFork(
      f.directory,
      run,
      "remote",
      api.git,
      signal,
      current,
      api.request,
    );
    await prepareWindmillFork(
      f.directory,
      run,
      "remote",
      api.git,
      signal,
      current,
      api.request,
    );
    assert.equal(api.calls.filter((x) => x.endsWith("/create_fork")).length, 1);
    assert.equal(
      api.calls.filter((x) => x.endsWith("/create_workspace_fork_branch"))
        .length,
      1,
    );
    await beginWindmillSync(f.directory, run, signal, api.request);
    api.deploy(run.commit!);
    const evidence = await verifyWindmillFork(
      f.directory,
      run,
      signal,
      current,
      api.request,
    );
    assert.equal(evidence.commit, run.commit);
    assert.equal(evidence.workspace, api.workspace);
    assert.match(evidence.jobUrl, /sync-job/);
    assert.equal(
      (await readWindmillIntent(f.directory, run))?.evidence?.commit,
      run.commit,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("unowned forks are preserved and new sync failures are reported even without a synced SHA", async () => {
  const f = await cleanupFixture();
  try {
    f.run.input.snapshot.name = "windmill-work";
    const run = publicationRun(f.run);
    const api = backend(run, run.commit!);
    api.forks.push({
      id: api.workspace,
      name: "Another developer",
      parent_workspace_id: "production",
    });
    await assert.rejects(
      prepareWindmillFork(
        f.directory,
        run,
        "remote",
        api.git,
        signal,
        current,
        api.request,
      ),
      /not owned/,
    );
    assert(!api.calls.some((x) => x.includes("/create_")));
    api.forks.length = 0;
    await prepareWindmillFork(
      f.directory,
      run,
      "remote",
      api.git,
      signal,
      current,
      api.request,
    );
    await beginWindmillSync(f.directory, run, signal, api.request);
    api.fail();
    await assert.rejects(
      verifyWindmillFork(f.directory, run, signal, current, api.request),
      /deployment failed.*sync-job/,
    );
    assert.equal(
      (await readWindmillIntent(f.directory, run))?.evidence,
      undefined,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("an older successful deployment never proves this candidate deployed; cancellation interrupts waiting", async () => {
  const f = await cleanupFixture();
  try {
    f.run.input.snapshot.name = "windmill-work";
    const run = publicationRun(f.run);
    const api = backend(run, run.commit!);
    await prepareWindmillFork(
      f.directory,
      run,
      "remote",
      api.git,
      signal,
      current,
      api.request,
    );
    api.deploy("a".repeat(40));
    const abort = new AbortController();
    const request = async <T>(path: string, body?: unknown) => {
      const value = await api.request<T>(path, body);
      abort.abort();
      return value;
    };
    await assert.rejects(
      verifyWindmillFork(f.directory, run, abort.signal, current, request),
      /abort/i,
    );
    assert.equal(
      (await readWindmillIntent(f.directory, run))?.evidence,
      undefined,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("publication pushes the reviewed commit to the native branch, adopts its PR, and recovers without repushing", async (t) => {
  const f = await cleanupFixture();
  const remote = "https://github.com/OnetoOneHealth/windmill-work.git";
  const origin = join(f.directory, "origin.git");
  const git = (...args: string[]) =>
    execFileSync("/usr/bin/git", args, { encoding: "utf8" }).trim();
  try {
    f.run.input.snapshot.name = "windmill-work";
    const run = publicationRun({ ...f.run, status: "publish" });
    const base = run.commit!;
    const api = backend(run, base);
    git("-C", f.source, "remote", "add", "origin", remote);
    git("-C", f.source, "update-ref", "refs/heads/main", base);
    git("clone", "--quiet", "--bare", f.source, origin);
    await writeFile(join(f.source, "feature.txt"), "reviewed implementation\n");
    git("-C", f.source, "add", ".");
    git(
      "-C",
      f.source,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "reviewed change",
    );
    run.commit = git("-C", f.source, "rev-parse", "HEAD");
    git(
      "--git-dir",
      join(f.path, "repository.git"),
      "fetch",
      "--quiet",
      f.source,
      "HEAD",
    );
    api.onCreate(() =>
      git("--git-dir", origin, "update-ref", `refs/heads/${run.branch}`, base),
    );
    saveSecret(f.directory, {
      name: "WINDMILL_WINDMILL_PRODUCTION_PERSON_TOKEN",
      description: "Synthetic fixture",
      value: "fixture-token",
    });
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit) => {
        assert.equal(
          (init.headers as Record<string, string>).Authorization,
          "Bearer fixture-token",
        );
        const value = await api.handle(
          input.replace("https://wm.onetoone.health/api", ""),
          init.body ? JSON.parse(String(init.body)) : undefined,
        );
        return Response.json(value);
      },
    );
    let pushed = false,
      pushes = 0,
      body = "Native PR";
    const url = "https://github.com/OnetoOneHealth/windmill-work/pull/999999";
    const execute: typeof executeCoding = async (command, args, abort, log) => {
      if (command.endsWith("/gh")) {
        if (args[0] === "repo")
          return JSON.stringify({ defaultBranchRef: { name: "main" } });
        if (args[1] === "edit") {
          body = await readFile(args.at(-1)!, "utf8");
          return "";
        }
        assert.equal(args[1], "list", "do not create a duplicate native PR");
        return JSON.stringify(
          pushed
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
      if (args.includes("push")) {
        assert(args.includes(`${run.commit}:refs/heads/${run.branch}`));
        assert(
          args.includes(`--force-with-lease=refs/heads/${run.branch}:${base}`),
        );
        pushes++;
      }
      const result = await executeCoding(
        command,
        args.map((x) => (x === remote ? origin : x)),
        abort,
        log,
      );
      if (args.includes("push")) {
        pushed = true;
        api.deploy(run.commit!);
      }
      return result;
    };
    const log = createLogger("windmill-test", {
      logDirectory: join(f.directory, "logs"),
      artifactDirectory: join(f.directory, "artifacts"),
    });
    assert.equal(
      await publishCoding(f.directory, run, signal, log, current, execute),
      url,
    );
    assert.match(body, /Windmill fork/);
    assert.match(body, /code-assist:/);
    assert.equal(
      await publishCoding(f.directory, run, signal, log, current, execute),
      url,
    );
    assert.equal(pushes, 1);
    assert.equal(
      git("--git-dir", origin, "rev-parse", `refs/heads/${run.branch}`),
      run.commit,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
