/**
 * MCP Tool 定义 — 暴露给 Claude Code 的 3 个工具
 */

import type { HubClient } from "./hub-client.js";
import type { MessageQueue } from "./message-queue.js";
import type {
  AgentInfo,
  SendMessageResult,
  Message,
} from "../../shared/src/types.js";

export interface ToolContext {
  hubClient: HubClient;
  messageQueue: MessageQueue;
  myAgentId: string;
}

export function getToolDefinitions() {
  return [
    {
      name: "send_message",
      description:
        'Send a message to another agent. Use to="*" to broadcast to all agents.',
      inputSchema: {
        type: "object" as const,
        properties: {
          to: {
            type: "string",
            description:
              'Target agent_id, or "*" to broadcast to all agents',
          },
          content: {
            type: "string",
            description: "Message content",
          },
        },
        required: ["to", "content"],
      },
    },
    {
      name: "read_messages",
      description:
        "Read new messages from other agents. Returns messages from the inbox.",
      inputSchema: {
        type: "object" as const,
        properties: {
          since_id: {
            type: "number",
            description: "Only return messages after this ID",
          },
          from: {
            type: "string",
            description: "Only return messages from this agent",
          },
          limit: {
            type: "number",
            description: "Max number of messages to return (default: 50)",
          },
        },
      },
    },
    {
      name: "list_agents",
      description: "List all online agents and their roles.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];
}

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  try {
    switch (toolName) {
      case "send_message": {
        const result = await ctx.hubClient.rpc<SendMessageResult>(
          "send_message",
          { to: args.to, content: args.content }
        );
        return `Message sent (id: ${result.id}, time: ${result.timestamp})`;
      }

      case "read_messages": {
        // 先尝试从本地队列读（SSE 推送的）
        const localMsgs = ctx.messageQueue.read({
          since_id: args.since_id as number | undefined,
          from: args.from as string | undefined,
          limit: args.limit as number | undefined,
        });

        if (localMsgs.length > 0) {
          return formatMessages(localMsgs);
        }

        // 本地没有，从 Hub 拉取（补漏）
        const remoteMsgs = await ctx.hubClient.rpc<Message[]>(
          "read_messages",
          {
            since_id: args.since_id,
            from: args.from,
            limit: args.limit ?? 50,
          }
        );

        if (remoteMsgs.length === 0) {
          return "No new messages.";
        }

        return formatMessages(remoteMsgs);
      }

      case "list_agents": {
        const agents = await ctx.hubClient.rpc<AgentInfo[]>("list_agents");
        if (agents.length === 0) {
          return "No agents online.";
        }
        return agents
          .map(
            (a) =>
              `${a.status === "online" ? "🟢" : "⚪"} ${a.agent_id} (${a.role}) — ${a.description}${a.agent_id === ctx.myAgentId ? "  ← you" : ""}`
          )
          .join("\n");
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`;
  }
}

function formatMessages(msgs: Message[]): string {
  if (msgs.length === 0) return "No new messages.";

  return msgs
    .map((m) => `[${m.from}] (id:${m.id}) ${m.content}`)
    .join("\n\n");
}
