import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { Ticket } from "./linear.ts";

const execute = promisify(execFile);
export type Repository = { name: string; path: string; github: string | null };
export type Suggestion = { repository: Repository; evidence: string[] };

export async function discoverRepositories(
  directory: string,
): Promise<Repository[]> {
  const config = JSON.parse(
    await readFile(join(directory, "mac-mini.json"), "utf8"),
  );
  if (
    typeof config.repositoryRoot !== "string" ||
    !isAbsolute(config.repositoryRoot)
  )
    throw new Error(
      "Configure the Mac mini repository folder before scanning.",
    );
  const repositories: Repository[] = [];
  for (const entry of await readdir(config.repositoryRoot, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const path = join(config.repositoryRoot, entry.name);
    try {
      await stat(join(path, ".git"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let github: string | null = null;
    try {
      const { stdout } = await execute("/usr/bin/git", [
        "-C",
        path,
        "config",
        "--get",
        "remote.origin.url",
      ]);
      const remote = stdout.trim();
      const match = remote.match(
        /^(?:git@github\.com:|https:\/\/(?:[^/@]+@)?github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i,
      );
      github = match?.[1] ?? null;
    } catch (error) {
      if ((error as { code?: number }).code !== 1)
        throw new Error("Could not read a repository's Git remote.", {
          cause: error,
        });
    }
    repositories.push({ name: entry.name, path, github });
  }
  return repositories.sort((a, b) => a.name.localeCompare(b.name));
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function suggestRepositories(
  ticket: Ticket,
  repositories: Repository[],
): Suggestion[] {
  const sources = [
    { name: "title", text: ticket.title },
    { name: "description", text: ticket.description },
    ...ticket.comments.map((comment) => ({
      name: `comment ${comment.id}`,
      text: comment.body,
    })),
  ];
  const suggestions: Suggestion[] = [];
  for (const repository of repositories) {
    const evidence: string[] = [];
    const name = new RegExp(
      `(^|[^A-Za-z0-9_-])${escape(repository.name)}(?=$|[^A-Za-z0-9_-])`,
      "i",
    );
    const github = repository.github
      ? new RegExp(
          `https://github\\.com/${escape(repository.github)}(?=/|[\\s)>#?]|$)`,
          "i",
        )
      : null;
    for (const source of sources) {
      if (name.test(source.text))
        evidence.push(`Repository name appears in the ${source.name}.`);
      if (github?.test(source.text))
        evidence.push(
          `GitHub link to ${repository.github} appears in the ${source.name}; it may be related work.`,
        );
    }
    if (evidence.length) suggestions.push({ repository, evidence });
  }
  return suggestions;
}
