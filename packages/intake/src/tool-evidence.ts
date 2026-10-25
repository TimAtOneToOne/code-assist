import type { ToolEvidence } from "./acceptance-types.ts";

type Event = {
  type?: string;
  item?: {
    id: string;
    type: string;
    server?: string;
    tool?: string;
    command?: string;
    status?: string;
    exit_code?: number;
    error?: unknown;
  };
  message?: {
    content?:
      | {
          type: string;
          id?: string;
          name?: string;
          tool_use_id?: string;
          is_error?: boolean;
        }[]
      | string;
  };
};
// Both SDKs expose native tool IDs; only completed executions become evidence.
export function toolEvidenceCollector() {
  const pending = new Map<
    string,
    { name: string; kind: ToolEvidence["kind"] }
  >();
  const completed: ToolEvidence[] = [];
  return {
    completed,
    observe(value: unknown) {
      const event = value as Event;
      if (event.type === "item.completed" && event.item) {
        const item = event.item;
        if (item.type === "mcp_tool_call" && item.server === "playwright")
          completed.push({
            id: item.id,
            name: item.tool!,
            kind: "browser",
            succeeded: item.status === "completed" && !item.error,
          });
        if (item.type === "command_execution")
          completed.push({
            id: item.id,
            name: item.command!,
            kind: "command",
            succeeded: item.status === "completed" && item.exit_code === 0,
          });
      }
      if (Array.isArray(event.message?.content))
        for (const block of event.message.content) {
          if (
            event.type === "assistant" &&
            block.type === "tool_use" &&
            block.id &&
            block.name
          ) {
            const kind = block.name.startsWith("mcp__playwright__")
              ? "browser"
              : block.name === "Bash"
                ? "command"
                : ["Read", "Grep", "Glob"].includes(block.name)
                  ? "inspection"
                  : null;
            if (kind) pending.set(block.id, { name: block.name, kind });
          }
          if (
            event.type === "user" &&
            block.type === "tool_result" &&
            block.tool_use_id
          ) {
            const tool = pending.get(block.tool_use_id);
            if (tool) {
              completed.push({
                id: block.tool_use_id,
                ...tool,
                succeeded: !block.is_error,
              });
              pending.delete(block.tool_use_id);
            }
          }
        }
    },
  };
}
