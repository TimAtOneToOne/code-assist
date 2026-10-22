import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { findSecretByName, revealSecret } from "@code-assist/secrets";
import { activeSnapshot, repositoryDirectory } from "./coding-repositories.ts";
import type { CodingRun } from "./coding-types.ts";

const baseUrl = "https://wm.onetoone.health";
const parent = "production";
const tokenName = "WINDMILL_WINDMILL_PRODUCTION_PERSON_TOKEN";

export function isWindmill(run: CodingRun) {
  return activeSnapshot(run).name === "windmill-work";
}
export function publicationRun(run: CodingRun): CodingRun {
  if (!isWindmill(run)) return run;
  const slug = run.branch
    .replace(/^feature\//, "")
    .replace(/^wm-fork\/main\//, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw new Error("Windmill fork branches require a lowercase ticket slug.");
  return { ...run, branch: `wm-fork/main/${slug}` };
}

type Fork = { id: string; name: string; parent_workspace_id: string | null };
type Sync = {
  git_repo_resource_path: string;
  auto_pull?: {
    enabled?: boolean;
    sync_forks?: boolean;
    last_pull_status?: {
      job_id: string;
      success: boolean;
      synced_sha?: string;
    };
    last_synced_sha?: Record<string, string>;
  };
};
type Settings = { git_sync?: { repositories: Sync[] } };
export type ForkEvidence = {
  workspace: string;
  branch: string;
  url: string;
  jobUrl: string;
  commit: string;
};
type ForkIntent = {
  workspace: string;
  name: string;
  branch: string;
  initialHead: string;
  resource: string;
  actor: string;
  branchJobs?: string[];
  awaiting?: { commit: string; previousJob?: string };
  evidence?: ForkEvidence;
};
type Git = (args: string[]) => Promise<string>;
type Request = <T>(path: string, body?: unknown) => Promise<T>;
export function windmillRequest(
  directory: string,
  signal: AbortSignal,
): Request {
  const secret = findSecretByName(directory, tokenName);
  if (!secret)
    throw new Error(
      `Configure the existing ${tokenName} secret for Windmill publication.`,
    );
  const token = revealSecret(directory, secret.id);
  return async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Windmill ${path.split("?")[0]} returned HTTP ${response.status}.`,
      );
    const text = await response.text();
    return (
      response.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(text)
        : text
    ) as T;
  };
}
export async function readWindmillIntent(directory: string, run: CodingRun) {
  try {
    return JSON.parse(
      await readFile(
        join(repositoryDirectory(directory, run), "windmill-fork.json"),
        "utf8",
      ),
    ) as ForkIntent;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function save(directory: string, run: CodingRun, intent: ForkIntent) {
  const path = join(repositoryDirectory(directory, run), "windmill-fork.json");
  await writeFile(path + ".tmp", JSON.stringify(intent), { mode: 0o600 });
  await rename(path + ".tmp", path);
}
export async function beginWindmillSync(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  request: Request = windmillRequest(directory, signal),
) {
  const intent = await readWindmillIntent(directory, run);
  if (!intent || !run.commit)
    throw new Error("No Windmill fork or reviewed commit to publish.");
  const settings = await request<Settings>(
    `/w/${intent.workspace}/workspaces/get_settings`,
  );
  const previousJob = settings.git_sync?.repositories.find(
    (r) => r.git_repo_resource_path === intent.resource,
  )?.auto_pull?.last_pull_status?.job_id;
  await save(directory, run, {
    ...intent,
    awaiting: { commit: run.commit, previousJob },
  });
}
export async function prepareWindmillFork(
  directory: string,
  run: CodingRun,
  remote: string,
  git: Git,
  signal: AbortSignal,
  assertCurrent: () => Promise<void>,
  request: Request = windmillRequest(directory, signal),
) {
  const workspace = `wm-fork-${run.branch.slice("wm-fork/main/".length)}`;
  const name = `${run.identifier} · Code Assist ${run.id.slice(0, 8)}`;
  const users = await request<{ email: string; workspaces: Fork[] }>(
    "/workspaces/users",
  );
  if (!users.email)
    throw new Error(
      "Windmill did not identify the configured publication account.",
    );
  let fork = users.workspaces.find((w) => w.id === workspace);
  let intent = await readWindmillIntent(directory, run);
  if (
    intent &&
    (intent.workspace !== workspace ||
      intent.branch !== run.branch ||
      intent.name !== name ||
      intent.actor !== users.email)
  )
    throw new Error(
      "The saved Windmill fork belongs to a different coding run or branch.",
    );
  if (
    fork &&
    (!intent || fork.parent_workspace_id !== parent || fork.name !== name)
  )
    throw new Error(
      `Windmill fork ${workspace} already exists and is not owned by this coding run. Choose a fresh branch.`,
    );
  const settings = await request<Settings>(
    `/w/${parent}/workspaces/get_settings`,
  );
  // Confirm the native connection owns this repository before creating its branch.
  const matching: Sync[] = [];
  for (const repo of settings.git_sync?.repositories ?? []) {
    const connection = await request<{
      url?: string;
      branch?: string;
      folder?: string;
    }>(
      `/w/${parent}/resources/get_value/${repo.git_repo_resource_path.replace(/^\$res:/, "")}`,
    );
    if (
      connection.url?.replace(/\.git$/, "") ===
        "https://github.com/OnetoOneHealth/windmill-work" &&
      connection.branch === "main" &&
      connection.folder === "workspaces/production"
    )
      matching.push(repo);
  }
  if (
    matching.length !== 1 ||
    !matching[0].auto_pull?.enabled ||
    !matching[0].auto_pull.sync_forks
  )
    throw new Error(
      "Could not identify an enabled native fork-sync connection for windmill-work/main/workspaces/production.",
    );
  const resource = matching[0].git_repo_resource_path;
  if (intent && intent.resource !== resource)
    throw new Error(
      "The Windmill Git Sync connection changed since this fork was created.",
    );
  if (!intent) {
    const branch = await git([
      "ls-remote",
      "--heads",
      remote,
      `refs/heads/${run.branch}`,
    ]);
    if (branch)
      throw new Error(
        "The Windmill fork branch already contains unowned work.",
      );
    const initialHead = (
      await git(["ls-remote", "--heads", remote, "refs/heads/main"])
    ).split(/\s+/)[0];
    if (!/^[a-f0-9]{40}$/.test(initialHead))
      throw new Error("Could not resolve Windmill's main branch.");
    intent = {
      workspace,
      name,
      branch: run.branch,
      initialHead,
      resource,
      actor: users.email,
    };
    await assertCurrent();
    await save(directory, run, intent);
    intent.branchJobs = await request<string[]>(
      `/w/${parent}/workspaces/create_workspace_fork_branch`,
      { id: workspace, name, forked_datatables: [] },
    );
    await save(directory, run, intent);
  }
  if (!intent.branchJobs)
    throw new Error(
      "Windmill branch creation has an uncertain outcome. Inspect its native Git Sync jobs before retrying creation.",
    );
  if (!fork) {
    await assertCurrent();
    await request(`/w/${parent}/workspaces/create_fork`, {
      id: workspace,
      name,
      forked_datatables: [],
    });
    fork = (
      await request<{ workspaces: Fork[] }>("/workspaces/users")
    ).workspaces.find((w) => w.id === workspace);
  }
  if (fork?.parent_workspace_id !== parent || fork.name !== name)
    throw new Error("Windmill did not create the expected production fork.");
  const identity = await request<{ email: string }>(
    `/w/${workspace}/users/whoami`,
  );
  if (identity.email !== intent.actor)
    throw new Error(
      "The Windmill fork is using a different publication account.",
    );
  for (const id of intent.branchJobs) {
    while (true) {
      await assertCurrent();
      const job = await request<{ type: string; success?: boolean }>(
        `/w/${parent}/jobs_u/get/${id}?no_logs=true&no_code=true`,
      );
      if (job.type === "CompletedJob") {
        if (!job.success)
          throw new Error(
            `Windmill fork branch creation failed: ${baseUrl}/run/${id}?workspace=${parent}`,
          );
        break;
      }
      await delay(1000, undefined, { signal });
    }
  }
  const mode = await request<{ deploy_on_push: boolean }>(
    `/w/${workspace}/workspaces/git_sync_deploy_mode?branch=${encodeURIComponent(run.branch)}`,
  );
  if (!mode.deploy_on_push)
    throw new Error(
      "Native Git Sync does not deploy this branch to its Windmill fork.",
    );
  return intent;
}
export async function verifyWindmillFork(
  directory: string,
  run: CodingRun,
  signal: AbortSignal,
  assertCurrent: () => Promise<void>,
  request: Request = windmillRequest(directory, signal),
) {
  const intent = await readWindmillIntent(directory, run);
  if (!intent) throw new Error("No saved Windmill fork publication intent.");
  while (true) {
    await assertCurrent();
    const settings = await request<Settings>(
      `/w/${intent.workspace}/workspaces/get_settings`,
    );
    const sync = settings.git_sync?.repositories.find(
      (r) => r.git_repo_resource_path === intent.resource,
    )?.auto_pull;
    const status = sync?.last_pull_status;
    if (
      status &&
      !status.success &&
      intent.awaiting?.commit === run.commit &&
      status.job_id !== intent.awaiting.previousJob
    )
      throw new Error(
        `Windmill fork deployment failed: ${baseUrl}/run/${status.job_id}?workspace=${intent.workspace}`,
      );
    if (status?.synced_sha === run.commit) {
      if (!status.success)
        throw new Error(
          `Windmill fork deployment failed: ${baseUrl}/run/${status.job_id}?workspace=${intent.workspace}`,
        );
      if (sync?.last_synced_sha?.[run.branch] === run.commit) {
        const evidence = {
          workspace: intent.workspace,
          branch: run.branch,
          commit: run.commit!,
          url: `${baseUrl}/?workspace=${intent.workspace}`,
          jobUrl: `${baseUrl}/run/${status.job_id}?workspace=${intent.workspace}`,
        };
        await save(directory, run, { ...intent, evidence });
        return evidence;
      }
    }
    await delay(1000, undefined, { signal });
  }
}
