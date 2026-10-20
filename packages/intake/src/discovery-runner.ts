import { runCodex, type AgentInput } from "./discovery-agent.ts";
const abort = new AbortController();
let started = false;
process.on("disconnect", () =>
  abort.abort(new Error("Owning worker disconnected.")),
);
process.on("SIGTERM", () =>
  abort.abort(new Error("Discovery process interrupted.")),
);
process.on("message", async (message: { type: string; input?: AgentInput }) => {
  if (message.type === "abort") abort.abort(new Error("Discovery cancelled."));
  if (message.type !== "start" || !message.input || started) return;
  started = true;
  try {
    const result = await runCodex(message.input, abort.signal, (event) => {
      if (process.connected) process.send!({ type: "event", event });
    });
    if (process.connected) process.send!({ type: "result", result });
  } catch (error) {
    process.exitCode = 1;
    if (process.connected)
      process.send!({
        type: "error",
        error: error instanceof Error ? error.message : "Codex failed.",
      });
  } finally {
    if (process.connected) process.disconnect();
  }
});
