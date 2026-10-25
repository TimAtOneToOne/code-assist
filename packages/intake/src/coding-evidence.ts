import {
  existsSync,
  mkdirSync,
  cpSync,
  renameSync,
  rmSync,
  realpathSync,
  statSync,
  readdirSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasBrowserEvidence,
  browserEvidenceRequiredMessage,
} from "./coding-types.ts";

export class BrowserEvidenceRequiredError extends Error {}
class InvalidEvidenceError extends Error {}

export function requireBrowserEvidence(
  paths: string[],
  completedTools: string[],
) {
  if (!hasBrowserEvidence(paths, completedTools))
    throw new BrowserEvidenceRequiredError(browserEvidenceRequiredMessage);
}

function evidenceDirectory(work: string, origin: string) {
  if (!/^[a-f0-9-]{36}$/.test(origin))
    throw new Error("Invalid evidence attempt ID");
  return join(work, "receipts", origin);
}

export function freezeEvidence(work: string, origin: string) {
  const target = evidenceDirectory(work, origin);
  if (existsSync(target)) return target;
  mkdirSync(join(work, "receipts"), { recursive: true });
  const temporary = target + ".tmp";
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary);
  cpSync(join(work, "evidence"), join(temporary, "evidence"), {
    recursive: true,
  });
  cpSync(join(work, "logs"), join(temporary, "logs"), { recursive: true });
  renameSync(temporary, target);
  return target;
}

export function verifyEvidence(work: string, origin: string, paths: string[]) {
  const root = realpathSync(join(evidenceDirectory(work, origin), "evidence"));
  for (const path of paths) {
    if (!path.startsWith("/work/evidence/") || path.split("/").includes(".."))
      throw new InvalidEvidenceError(
        "Evidence path must be under /work/evidence: " + path,
      );
    const target = realpathSync(
      resolve(root, path.slice("/work/evidence/".length)),
    );
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
      throw new InvalidEvidenceError(
        "Evidence escapes its saved directory: " + path,
      );
    const stat = statSync(target);
    if (!(stat.isFile() || (stat.isDirectory() && readdirSync(target).length)))
      throw new InvalidEvidenceError(
        "Evidence must be a file or nonempty directory: " + path,
      );
  }
}

export function evidenceIssues(work: string, origin: string, paths: string[]) {
  const issues: string[] = [];
  for (const path of paths) {
    try {
      verifyEvidence(work, origin, [path]);
    } catch (error) {
      if (
        error instanceof InvalidEvidenceError ||
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        issues.push(`Missing or invalid saved artifact: ${path}`);
      else throw error;
    }
  }
  return issues;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [, , command, origin, paths] = process.argv;
  if (command === "freeze") freezeEvidence("/work", origin);
  else if (command === "verify")
    verifyEvidence("/work", origin, JSON.parse(paths));
  else if (command === "inspect")
    console.log(
      JSON.stringify(evidenceIssues("/work", origin, JSON.parse(paths))),
    );
  else throw new Error("Unknown evidence command");
}
