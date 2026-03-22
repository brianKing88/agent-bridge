#!/usr/bin/env node
/**
 * Agent Bridge MCP Plugin — stdio MCP Server
 *
 * 环境变量：
 *   AGENT_BRIDGE_HUB    — Hub 地址 (如 http://100.64.1.1:9900)
 *   AGENT_BRIDGE_TOKEN  — 共享 Token
 *   AGENT_BRIDGE_AGENT_ID — 本 agent 的 ID
 *   AGENT_BRIDGE_ROLE   — 角色 (如 backend / frontend)
 *   AGENT_BRIDGE_DESC   — 描述
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { HubClient } from "./hub-client.js";
import { MessageQueue } from "./message-queue.js";
import { getToolDefinitions, handleToolCall } from "./tools.js";
import type { Message } from "../../shared/src/types.js";

// --- 读取环境变量 ---

const hubUrl = process.env.AGENT_BRIDGE_HUB;
const token = process.env.AGENT_BRIDGE_TOKEN;
const agentId = process.env.AGENT_BRIDGE_AGENT_ID;
const role = process.env.AGENT_BRIDGE_ROLE ?? "member";
const description = process.env.AGENT_BRIDGE_DESC ?? "";

if (!hubUrl || !token || !agentId) {
  console.error(
    "Missing required env vars: AGENT_BRIDGE_HUB, AGENT_BRIDGE_TOKEN, AGENT_BRIDGE_AGENT_ID"
  );
  process.exit(1);
}

// --- 初始化 ---

const hubClient = new HubClient({ hubUrl, token, agentId });
const messageQueue = new MessageQueue();
const toolContext = { hubClient, messageQueue };

// SSE 收到消息 → 入队
hubClient.onEvent((event, data) => {
  if (event === "message") {
    messageQueue.push(data as Message);
  }
});

// --- MCP Server ---

const server = new Server(
  { name: "agent-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions(),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleToolCall(name, args ?? {}, toolContext);
  return {
    content: [{ type: "text", text: result }],
  };
});

// --- 启动 ---

async function main() {
  // 1. 连接 SSE（后台）
  await hubClient.connectSse();

  // 2. 注册到 Hub
  try {
    await hubClient.rpc("register", {
      agent_id: agentId,
      role,
      description,
    });
  } catch (err) {
    console.error(`Failed to register: ${(err as Error).message}`);
    // 继续运行，可能 Hub 还没启动
  }

  // 3. 启动 MCP stdio 服务
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
