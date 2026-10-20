import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(
  new URL("../node_modules/@playwright/mcp/cli.js", import.meta.url),
);
const temporary = join(root, ".tmp/browser-mcp");
mkdirSync(temporary, { recursive: true });
const run = mkdtempSync(join(temporary, "integration-"));
const origin = process.env.BROWSER_TEST_ORIGIN ?? "http://100.91.0.83:3000";

test("Mia browser MCP: UI interaction, screenshot, diagnostics and session isolation", async () => {
  const clients: {
    client: Client;
    transport: StdioClientTransport;
    label: string;
  }[] = [];
  const evidence: { tool: string; client: string; result: unknown }[] = [];
  async function connect(label: string) {
    const client = new Client(
      { name: `code-assist-browser-test-${label}`, version: "1.0.0" },
      {
        capabilities: { roots: { listChanged: false } },
      },
    );
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: pathToFileURL(root).href, name: "Code Assist" }],
    }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        cli,
        "--headless",
        "--isolated",
        "--browser",
        "chromium",
        "--output-dir",
        join(run, label),
      ],
      cwd: root,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (data) => {
      writeFileSync(join(run, `${label}-stderr.log`), data, { flag: "a" });
    });
    clients.push({ client, transport, label });
    await client.connect(transport);
    return client;
  }
  async function call(
    client: Client,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    evidence.push({
      tool: name,
      client: clients.find((c) => c.client === client)!.label,
      result: {
        ...result,
        content: (result.content as { type: string }[]).filter(
          (part) => part.type !== "image",
        ),
      },
    });
    assert.notEqual(result.isError, true, text);
    return { text, result };
  }
  try {
    const first = await connect("a");
    const { tools } = await first.listTools();
    writeFileSync(join(run, "tools.json"), JSON.stringify(tools, null, 2));
    for (const name of [
      "browser_navigate",
      "browser_click",
      "browser_type",
      "browser_snapshot",
      "browser_take_screenshot",
      "browser_console_messages",
      "browser_network_requests",
      "browser_evaluate",
      "browser_close",
    ]) {
      assert(
        tools.some((tool) => tool.name === name),
        `Missing ${name}`,
      );
    }
    await call(first, "browser_navigate", { url: origin });
    const home = await call(first, "browser_snapshot");
    const logsRef = home.text.match(/link "Logs"[^\n]*\[ref=([^\]]+)\]/)?.[1];
    assert(logsRef, "Home snapshot did not expose Logs navigation");
    await call(first, "browser_click", {
      element: "Logs navigation",
      target: logsRef,
    });
    const page = await call(first, "browser_snapshot");
    assert.match(page.text, /heading "Logs"/);
    const serviceRef = page.text.match(
      /textbox "Service"[^\n]*\[ref=([^\]]+)\]/,
    )?.[1];
    assert(serviceRef, "Logs page did not expose service filter");
    await call(first, "browser_type", {
      element: "Service filter",
      target: serviceRef,
      text: "worker",
      submit: true,
    });
    const filtered = await call(first, "browser_snapshot");
    assert.match(filtered.text, /service=worker/);
    const screenshot = await call(first, "browser_take_screenshot", {
      type: "png",
    });
    const image = (
      screenshot.result.content as { type: string; data?: string }[]
    ).find((part) => part.type === "image");
    assert(image?.data, "Screenshot did not return image data");
    writeFileSync(join(run, "mia-logs.png"), Buffer.from(image.data, "base64"));
    await call(first, "browser_console_messages", { level: "error" });
    await call(first, "browser_network_requests");
    await call(first, "browser_evaluate", {
      function:
        "() => { localStorage.setItem('code-assist-mcp-isolation', 'client-a'); return localStorage.getItem('code-assist-mcp-isolation'); }",
    });
    const second = await connect("b");
    await call(second, "browser_navigate", { url: origin });
    const isolated = await call(second, "browser_evaluate", {
      function: "() => localStorage.getItem('code-assist-mcp-isolation')",
    });
    assert.match(isolated.text, /null/);
    const unchanged = await call(first, "browser_evaluate", {
      function: "() => localStorage.getItem('code-assist-mcp-isolation')",
    });
    assert.match(unchanged.text, /client-a/);
    await call(first, "browser_close");
    await call(second, "browser_close");
    console.log(`Browser evidence: ${run}`);
  } finally {
    for (const { client } of clients) await client.close();
    writeFileSync(
      join(run, "mcp-results.json"),
      JSON.stringify(evidence, null, 2),
    );
    for (const { transport } of clients) assert.equal(transport.pid, null);
  }
});
