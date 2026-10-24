import { browserServer } from "./server.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

assert.notEqual(
  process.getuid?.(),
  0,
  "Browser readiness must run as the workspace user",
);
const directory = process.argv[2] ?? "/work/runtime-readiness";
mkdirSync(directory, { recursive: true });
const output = mkdtempSync(join(directory, "check-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html lang="en"><title>Browser Readiness</title>
    <button onclick="document.querySelector('p').textContent='Interaction passed'">Check Browser</button>
    <p role="status">Waiting</p></html>`);
});
const client = new Client(
  { name: "coding-browser-readiness", version: "1.0.0" },
  { capabilities: { roots: { listChanged: false } } },
);
client.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: pathToFileURL(output).href, name: "Browser readiness" }],
}));
const transport = new StdioClientTransport({
  ...browserServer(output),
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
  cwd: output,
  stderr: "pipe",
});
transport.stderr?.on("data", (data) => {
  writeFileSync(join(output, "stderr.log"), data, { flag: "a" });
});
const evidence: unknown[] = [];
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as {
    type: string;
    text?: string;
    data?: string;
  }[];
  evidence.push({
    name,
    result: { ...result, content: content.filter((c) => c.type !== "image") },
  });
  const text = content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  assert.notEqual(result.isError, true, text);
  return { text, content };
}
let passed = false;
let failure: unknown;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await client.connect(transport);
  await call("browser_navigate", { url: `http://127.0.0.1:${address.port}` });
  const before = await call("browser_snapshot");
  const target = before.text.match(
    /button "Check Browser"[^\n]*\[ref=([^\]]+)\]/,
  )?.[1];
  assert(target, before.text);
  await call("browser_click", { target });
  assert.match((await call("browser_snapshot")).text, /Interaction passed/);
  const screenshot = await call("browser_take_screenshot", { type: "png" });
  const data = screenshot.content.find((c) => c.type === "image")?.data;
  assert(data, "Chromium did not produce a screenshot");
  writeFileSync(join(output, "browser.png"), Buffer.from(data, "base64"));
  passed = true;
} catch (error) {
  failure = error;
} finally {
  try {
    try {
      if (client.transport) await call("browser_close");
    } finally {
      await client.close();
    }
  } catch (error) {
    passed = false;
    failure ??= error;
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    writeFileSync(
      join(output, "result.json"),
      JSON.stringify({ passed, uid: process.getuid?.(), evidence }, null, 2),
    );
    console.log(
      JSON.stringify({ check: "shared browser readiness", passed, output }),
    );
  }
}

if (failure) throw failure;
