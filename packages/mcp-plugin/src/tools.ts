/**
 * MCP Tool 定义 — 暴露给 Claude Code 的工具
 *
 * 两种状态：
 *   disconnected: 只暴露 connect 工具
 *   connected:    暴露 send_message / read_messages / list_agents / disconnect
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
  role: string;
  description: string;
}

// --- Tool definitions (dynamic based on connection state) ---

export function getToolDefinitions(connected: boolean) {
  if (!connected) {
    return [
      {
        name: "connect",
        description:
          "Connect to the Agent Bridge hub to collaborate with other Claude Code agents on different machines. Call this when you need to communicate with other agents (e.g. for integration testing, cross-team coordination). If you don't need collaboration, you don't need to call this.",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
    ];
  }

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
        "Read new messages from other agents. Returns messages from the inbox. Call this at the start of every conversation to check for messages from collaborators.",
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
    {
      name: "disconnect",
      description:
        "Disconnect from the Agent Bridge hub. Call this when you no longer need to collaborate.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];
}

// --- Tool handler ---

export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  try {
    switch (toolName) {
      // --- Connect / Disconnect ---

      case "connect": {
        if (ctx.hubClient.isConnected) {
          return `Already connected as "${ctx.myAgentId}".`;
        }

        await ctx.hubClient.connectSse();

        try {
          await ctx.hubClient.rpc("register", {
            agent_id: ctx.myAgentId,
            role: ctx.role,
            description: ctx.description,
          });
        } catch (err) {
          // Hub might not be ready yet, but SSE is connected
        }

        // Check for waiting messages
        const agents = await ctx.hubClient.rpc<AgentInfo[]>("list_agents");
        const others = agents.filter((a) => a.agent_id !== ctx.myAgentId && a.status === "online");

        return [
          `Connected to hub as "${ctx.myAgentId}" (${ctx.role}).`,
          others.length > 0
            ? `\nOnline agents:\n${others.map((a) => `  🟢 ${a.agent_id} (${a.role}) — ${a.description}`).join("\n")}`
            : "\nNo other agents online yet.",
          `\nYou can now use send_message, read_messages, and list_agents.`,
        ].join("");
      }

      case "disconnect": {
        if (!ctx.hubClient.isConnected) {
          return "Not connected.";
        }
        ctx.hubClient.disconnect();
        return "Disconnected from hub. Call connect to reconnect.";
      }

      // --- Messaging (require connection) ---

      case "send_message": {
        if (!ctx.hubClient.isConnected) {
          return "Not connected to hub. Call connect first.";
        }
        const result = await ctx.hubClient.rpc<SendMessageResult>(
          "send_message",
          { to: args.to, content: args.content }
        );
        const unread = ctx.messageQueue.length;
        const hint = unread > 0 ? `\n\n📬 You have ${unread} unread message(s). Call read_messages to check.` : "";
        return `Message sent (id: ${result.id}, time: ${result.timestamp})${hint}`;
      }

      case "read_messages": {
        if (!ctx.hubClient.isConnected) {
          return "Not connected to hub. Call connect first.";
        }

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
        if (!ctx.hubClient.isConnected) {
          return "Not connected to hub. Call connect first.";
        }

        const agents = await ctx.hubClient.rpc<AgentInfo[]>("list_agents");
        if (agents.length === 0) {
          return "No agents online.";
        }
        const list = agents
          .map(
            (a) =>
              `${a.status === "online" ? "🟢" : "⚪"} ${a.agent_id} (${a.role}) — ${a.description}${a.agent_id === ctx.myAgentId ? "  ← you" : ""}`
          )
          .join("\n");
        const unread = ctx.messageQueue.length;
        const hint = unread > 0 ? `\n\n📬 You have ${unread} unread message(s). Call read_messages to check.` : "";
        return `${list}${hint}`;
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
