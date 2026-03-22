import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { RpcDispatcher } from "./rpc-handler.js";
import { Registry } from "./registry.js";
import { MessageBus } from "./message-bus.js";
import { SseManager } from "./sse-manager.js";
import { extractToken, verifyToken } from "./auth.js";
import type {
  RegisterParams,
  SendMessageParams,
  ReadMessagesParams,
  AgentId,
  RPC_ERRORS,
} from "./types.js";
import { RPC_ERRORS as ERRORS } from "./types.js";

export interface HubOptions {
  port: number;
}

export function createHub(options: HubOptions) {
  const registry = new Registry();
  const messageBus = new MessageBus();
  const sseManager = new SseManager();
  const rpc = new RpcDispatcher();

  // --- 注册 RPC handlers ---

  rpc.register("register", (params, _agentId) => {
    const { agent_id, role, description } = params as unknown as RegisterParams;
    if (!agent_id || !role) {
      const err = new Error("Missing required params: agent_id, role");
      (err as any).code = ERRORS.INVALID_PARAMS;
      throw err;
    }

    const info = registry.register({ agent_id, role, description: description ?? "" });

    // 广播上线通知给其他 agent
    sseManager.broadcast(
      "agent_online",
      { agent_id: info.agent_id, role: info.role, description: info.description },
      info.agent_id // 排除自己
    );

    return { ok: true };
  });

  rpc.register("list_agents", () => {
    return registry.listOnline();
  });

  rpc.register("send_message", (params, agentId) => {
    const { to, content } = params as unknown as SendMessageParams;
    if (!to || !content) {
      const err = new Error("Missing required params: to, content");
      (err as any).code = ERRORS.INVALID_PARAMS;
      throw err;
    }

    // 检查目标 agent 是否存在（广播除外）
    if (to !== "*" && !registry.get(to)) {
      const err = new Error(`Agent not found: ${to}`);
      (err as any).code = ERRORS.AGENT_NOT_FOUND;
      throw err;
    }

    const msg = messageBus.send({ from: agentId, to, content });

    // SSE 推送
    if (to === "*") {
      // 广播给所有人（除发送者）
      sseManager.broadcast(
        "message",
        { id: msg.id, from: msg.from, to: msg.to, content: msg.content, timestamp: msg.timestamp },
        agentId
      );
    } else {
      // 点对点推送
      sseManager.sendTo(to, "message", {
        id: msg.id,
        from: msg.from,
        to: msg.to,
        content: msg.content,
        timestamp: msg.timestamp,
      });
    }

    return { id: msg.id, timestamp: msg.timestamp };
  });

  rpc.register("read_messages", (params, agentId) => {
    const { since, since_id, from, limit } = params as unknown as ReadMessagesParams;
    return messageBus.query({
      forAgent: agentId,
      since,
      since_id,
      from,
      limit,
    });
  });

  // --- Agent 下线时广播 ---

  registry.on("agent_offline", (agentId: AgentId) => {
    sseManager.broadcast("agent_offline", { agent_id: agentId });
    sseManager.disconnect(agentId);
  });

  // --- HTTP 服务器 ---

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 认证
    const token = extractToken(req);
    if (!verifyToken(token)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // POST /rpc — JSON-RPC 入口
    if (req.method === "POST" && url.pathname === "/rpc") {
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: "0", error: { code: -32700, message: "Parse error" } }));
        return;
      }

      // 从请求中提取 agentId（从 register params 或已注册的 token 关联）
      // MVP 简化：从 params.agent_id 或 query 中取
      const agentId = (parsed as any)?.params?.agent_id
        ?? url.searchParams.get("agent_id")
        ?? "unknown";

      const response = await rpc.handle(parsed, agentId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    // GET /events — SSE 端点
    if (req.method === "GET" && url.pathname === "/events") {
      const agentId = url.searchParams.get("agent_id");
      if (!agentId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing agent_id query parameter" }));
        return;
      }

      sseManager.connect(agentId, res);

      // 连接断开时标记 agent 下线
      res.on("close", () => {
        registry.unregister(agentId);
      });
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return {
    server,
    registry,
    messageBus,
    sseManager,
    start() {
      server.listen(options.port, () => {
        console.log(`Agent Bridge Hub running on http://0.0.0.0:${options.port}`);
        if (process.env.AGENT_BRIDGE_TOKEN) {
          console.log(`Token: ${process.env.AGENT_BRIDGE_TOKEN}`);
        } else {
          console.log("Warning: No AGENT_BRIDGE_TOKEN set, auth disabled");
        }
      });
    },
    stop() {
      sseManager.disconnectAll();
      server.close();
    },
  };
}

/** 读取 HTTP 请求 body */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
