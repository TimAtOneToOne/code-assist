import { fileURLToPath } from "node:url";

export function browserServer(outputDirectory: string) {
  return {
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL("../node_modules/@playwright/mcp/cli.js", import.meta.url),
      ),
      "--headless",
      "--isolated",
      "--browser",
      "chromium",
      "--output-dir",
      outputDirectory,
    ],
  };
}
