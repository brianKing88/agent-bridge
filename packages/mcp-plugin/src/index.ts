#!/usr/bin/env node
/**
 * Agent Bridge MCP Plugin — stdio MCP Server
 *
 * Starts in DISCONNECTED state. Claude calls `connect` to join the hub.
 * This allows multiple terminals to have the plugin loaded,
 * but only the one that needs collaboration actually connects.
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
import { notifyUser } from "./notify.js";

import os from "node:os";

// --- 读取环境变量 ---

const hubUrl = process.env.AGENT_BRIDGE_HUB;
const token = process.env.AGENT_BRIDGE_TOKEN;
const role = process.env.AGENT_BRIDGE_ROLE ?? "member";
const hostname = os.hostname().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
const agentId = process.env.AGENT_BRIDGE_AGENT_ID ?? `${hostname}-${role}`;
const description = process.env.AGENT_BRIDGE_DESC ?? `${hostname} (${role})`;

if (!hubUrl || !token) {
  console.error(
    "Missing required env vars: AGENT_BRIDGE_HUB, AGENT_BRIDGE_TOKEN"
  );
  process.exit(1);
}

// --- 初始化（不连接，等待 connect 调用）---

const hubClient = new HubClient({ hubUrl, token, agentId });
const messageQueue = new MessageQueue();
const toolContext = { hubClient, messageQueue, myAgentId: agentId, role, description };

// SSE 收到消息 → 入队 + 通知人类
hubClient.onEvent((event, data) => {
  if (event === "message") {
    const msg = data as Message;
    messageQueue.push(msg);
    notifyUser(msg);
  }
});

// --- MCP Server ---

const server = new Server(
  { name: "agent-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: getToolDefinitions(hubClient.isConnected),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = await handleToolCall(name, args ?? {}, toolContext);
  return {
    content: [{ type: "text", text: result }],
  };
});

// --- 启动 MCP server（不连接 Hub）---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
