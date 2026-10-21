import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type AgentReceipt = {
  result: Record<string, unknown>;
  browserCalls: string[];
};

export function writeReceipt(path: string, receipt: AgentReceipt) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, JSON.stringify(receipt), {
    mode: 0o600,
    flush: true,
  });
  renameSync(`${path}.tmp`, path);
}

export function readReceipt(path: string): AgentReceipt | null {
  try {
    return parseReceipt(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function parseReceipt(text: string): AgentReceipt {
  const value = JSON.parse(text);
  if (
    !value ||
    !value.result ||
    typeof value.result !== "object" ||
    !Array.isArray(value.browserCalls) ||
    value.browserCalls.some((call: unknown) => typeof call !== "string")
  )
    throw new Error("Saved agent result is invalid; preserve it for recovery.");
  return value;
}
