import { workspaceLogEnvironment } from "./workspace-environment.ts";
// Executed only inside the attempt's OrbStack guest, under an owned systemd unit.
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { Codex } from "@openai/codex-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@code-assist/observability";
import { artifactPath } from "@code-assist/observability/artifacts";
import { terminateOwnedProcesses } from "./owned-processes.ts";
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
  id: string;
  repository?: string;
  repositories?: string[];
  environments?: boolean;
  provider: "codex" | "claude";
  apiKey: string;
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  anthropicWorkspaceId?: string;
};
const repository = input.repository ?? "internal-chat-ui";
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository))
  throw new Error("Invalid repository");
const environment = JSON.parse(
  readFileSync(
    input.environments
      ? `/work/environments/${repository}.json`
      : "/work/environment.json",
    "utf8",
  ),
) as Record<string, string>;
const home = "/home/workspace",
  temp = "/work/tmp",
  artifacts = "/work/logs/artifacts";
mkdirSync(temp, { recursive: true });
mkdirSync(join(home, ".codex"), { recursive: true, mode: 0o700 });
mkdirSync(join(home, ".claude"), { recursive: true, mode: 0o700 });
mkdirSync("/work/evidence", { recursive: true });
const log = createLogger(
  "coding",
  {
    logDirectory: "/work/logs",
    artifactDirectory: artifacts,
    environment: workspaceLogEnvironment({
      ...Object.fromEntries(
        (input.repositories ?? [repository]).flatMap((name) => {
          if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))
            throw new Error("Invalid repository");
          const env = JSON.parse(
            readFileSync(
              input.environments
                ? "/work/environments/" + name + ".json"
                : "/work/environment.json",
              "utf8",
            ),
          );
          return Object.entries(env).map(([key, value]) => [
            name + "_" + key,
            String(value),
          ]);
        }),
      ),
      API_KEY: input.apiKey,
    }),
  },
  { attempt_id: input.id },
);
const emit = (type: string, value: unknown) => {
  const reference = log.payload(`coding.${type}`, type, value);
  const safe = JSON.parse(
    readFileSync(artifactPath(artifacts, reference.artifact_id), "utf8"),
  );
  process.stdout.write(JSON.stringify({ type, value: safe }) + "\n");
};
const abort = new AbortController();
process.on("SIGTERM", () => {
  terminateOwnedProcesses();
  abort.abort();
});
const require = createRequire(
  new URL("../../browser-mcp/package.json", import.meta.url),
);
const browserCli = join(
  dirname(require.resolve("@playwright/mcp/package.json")),
  "cli.js",
);
const mcp = {
  command: "/usr/local/bin/node",
  args: [
    browserCli,
    "--headless",
    "--isolated",
    "--browser",
    "chromium",
    "--output-dir",
    "/work/evidence",
  ],
};
const shell = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: home,
  USER: "workspace",
  LANG: "C.UTF-8",
  TMPDIR: temp,
  ...environment,
};
try {
  let result: unknown;
  if (input.provider === "codex") {
    const sdk = new Codex({
      apiKey: input.apiKey,
      env: { ...shell, CODEX_HOME: join(home, ".codex") },
      config: {
        shell_environment_policy: { inherit: "none", set: shell },
        mcp_servers: { playwright: mcp },
      },
    });
    const thread = sdk.startThread({
      model: input.model,
      workingDirectory: `/work/${repository}`,
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      webSearchMode: "disabled",
    });
    const { events } = await thread.runStreamed(input.prompt, {
      signal: abort.signal,
      outputSchema: input.schema,
    });
    let completed = false,
      final = "";
    for await (const event of events) {
      emit("event", event);
      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      )
        final = event.item.text;
      if (event.type === "turn.completed") completed = true;
      if (event.type === "turn.failed") throw new Error(event.error.message);
      if (event.type === "error") throw new Error(event.message);
    }
    if (!completed) throw new Error("Codex ended without completing.");
    result = JSON.parse(final);
  } else {
    let succeeded = false;
    for await (const event of query({
      prompt: input.prompt,
      options: {
        model: input.model,
        cwd: `/work/${repository}`,
        env: {
          ...shell,
          ANTHROPIC_API_KEY: input.apiKey,
          CLAUDE_CONFIG_DIR: join(home, ".claude"),
          ...(input.anthropicWorkspaceId
            ? {
                ANTHROPIC_CUSTOM_HEADERS: `anthropic-workspace-id: ${input.anthropicWorkspaceId}`,
              }
            : {}),
        },
        abortController: abort,
        settingSources: [],
        plugins: [],
        mcpServers: { playwright: mcp },
        tools: ["Read", "Grep", "Glob", "Bash"],
        allowedTools: ["Read", "Grep", "Glob", "Bash", "mcp__playwright__*"],
        permissionMode: "dontAsk",
        permissionPrompts: "none",
        outputFormat: { type: "json_schema", schema: input.schema },
      },
    })) {
      emit("event", event);
      if (event.type === "result") {
        if (event.subtype !== "success" || event.is_error)
          throw new Error("Claude review did not succeed.");
        result = event.structured_output;
        succeeded = true;
      }
    }
    if (!succeeded || !result)
      throw new Error("Claude ended without a review.");
  }
  abort.signal.throwIfAborted();
  emit("result", result);
} catch (error) {
  emit("error", { error });
  process.exitCode = 1;
}
