import { join } from "node:path";
import { processReleaseReferences } from "./release-cleanup.ts";

export type ProcessRow = {
  pid: number;
  parent: number;
  command: string;
};
export function processRows(text: string): ProcessRow[] {
  if (!text.trim()) throw new Error("Empty process listing");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) throw new Error("Unrecognized process listing");
      return {
        pid: Number(match[1]),
        parent: Number(match[2]),
        command: match[3],
      };
    });
}
export function descendants(rows: ProcessRow[], parents: number[]) {
  const found = new Set(parents);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (found.has(row.parent) && !found.has(row.pid)) {
        found.add(row.pid);
        changed = true;
      }
    }
  }
  return found;
}
export function workingDirectories(listing: string) {
  const result = new Map<number, string>();
  let pid = 0;
  for (const line of listing.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && pid) result.set(pid, line.slice(1));
  }
  return result;
}
export function processRelease(root: string, listing: string, pid: number) {
  const releases = processReleaseReferences(root, listing).get(pid);
  if (releases?.size !== 1) throw new Error("Running release is unknown");
  return [...releases][0];
}
export function hostActivity(
  root: string,
  rows: ProcessRow[],
  listing: string,
  services: number[],
  inspector: number,
) {
  const ignored = descendants(rows, [inspector]);
  const owned = descendants(rows, services);
  const directories = workingDirectories(listing);
  return rows
    .filter((row) => {
      if (ignored.has(row.pid) || services.includes(row.pid)) return false;
      const cwd = directories.get(row.pid);
      return (
        owned.has(row.pid) ||
        cwd?.startsWith(join(root, "data") + "/") ||
        cwd?.startsWith(join(root, "releases") + "/") ||
        row.command.includes(root + "/")
      );
    })
    .map((row) => ({ pid: row.pid, parent: row.parent }));
}

// Match executable/script names, never print command arguments or environment values.
export function guestActivity(rows: ProcessRow[]) {
  return rows
    .filter(
      (row) =>
        /(?:^|[\s/])(?:codex|claude|pytest|vitest|jest|eslint|prettier|tsc)(?:[\s.]|$)|@(?:openai\/codex|anthropic-ai\/claude)|@playwright\/mcp|\/coding-guest\.ts(?:\s|$)/.test(
          row.command,
        ) ||
        (/\/run\.mjs(?:\s|$)/.test(row.command) &&
          !/\/ca-setup-app\.service(?:\s|$)/.test(row.command)),
    )
    .map((row) => ({ pid: row.pid, parent: row.parent }));
}
