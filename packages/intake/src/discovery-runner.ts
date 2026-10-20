import { runCodex, type AgentInput } from "./discovery-agent.ts";
import { terminateOwnedProcesses } from "./owned-processes.ts";
const abort = new AbortController();
let started = false;
function cancel(message: string) {
  if (abort.signal.aborted) return;
  try {
    terminateOwnedProcesses();
  } finally {
    abort.abort(new Error(message));
  }
}
process.on("disconnect", () => cancel("Owning worker disconnected."));
process.on("SIGTERM", () => cancel("Discovery process interrupted."));
process.on("message", async (message: { type: string; input?: AgentInput }) => {
  if (message.type === "abort") cancel("Discovery cancelled.");
  if (message.type !== "start" || !message.input || started) return;
  started = true;
  try {
    const execute =
      message.input.provider === "claude"
        ? (await import("./planning-agent.ts")).runClaude
        : runCodex;
    const result = await execute(message.input, abort.signal, (event) => {
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
