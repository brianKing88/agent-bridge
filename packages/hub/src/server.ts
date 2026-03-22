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
  const dashboardClients: ServerResponse[] = [];

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

    // 通知 dashboard
    broadcastDashboard(dashboardClients, "agent_online", { agent_id, role, description: description ?? "" });

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

    // 通知 dashboard
    broadcastDashboard(dashboardClients, "message", { id: msg.id, from: msg.from, to: msg.to, content: msg.content, timestamp: msg.timestamp });

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
    broadcastDashboard(dashboardClients, "agent_offline", { agent_id: agentId });
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

    // Dashboard 不需要认证
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      serveDashboard(res, registry, messageBus);
      return;
    }

    // Dashboard SSE 也不需要 token（只读）
    if (req.method === "GET" && url.pathname === "/dashboard/events") {
      serveDashboardSse(res, dashboardClients);
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

/** Dashboard SSE 广播 */
function broadcastDashboard(clients: ServerResponse[], event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    try {
      clients[i].write(payload);
    } catch {
      clients.splice(i, 1);
    }
  }
}

/** Dashboard SSE 连接 */
function serveDashboardSse(res: ServerResponse, clients: ServerResponse[]) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  clients.push(res);
  res.on("close", () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
}

/** Dashboard HTML */
function serveDashboard(res: ServerResponse, registry: Registry, messageBus: MessageBus) {
  const agents = registry.listOnline();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent Bridge Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'SF Mono','Cascadia Code',monospace;background:#0a0a0a;color:#e0e0e0;padding:20px}
h1{font-size:20px;color:#6ee7b7;margin-bottom:4px}
.sub{color:#666;font-size:12px;margin-bottom:20px}
.agents{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.agent{background:#111;border:1px solid #222;border-radius:8px;padding:10px 16px;font-size:13px}
.agent .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6ee7b7;margin-right:6px}
.agent .role{color:#888;font-size:11px}
.log{background:#111;border:1px solid #222;border-radius:8px;padding:16px;min-height:400px;max-height:70vh;overflow-y:auto}
.log-title{font-size:14px;color:#888;margin-bottom:12px}
.msg{margin:8px 0;padding:8px 12px;border-radius:6px;font-size:13px;animation:fadeIn .3s}
.msg.m{background:#0d1520;border-left:3px solid #60a5fa}
.msg.online{background:#0d1f17;border-left:3px solid #6ee7b7}
.msg.offline{background:#1f0d0d;border-left:3px solid #ef4444}
.msg .time{color:#555;font-size:11px;margin-right:8px}
.msg .from{color:#60a5fa;font-weight:bold}
.msg .arrow{color:#555;margin:0 4px}
.msg .to{color:#6ee7b7}
.msg .content{color:#ccc;margin-top:4px}
.empty{color:#555;font-style:italic;padding:20px;text-align:center}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<h1>Agent Bridge Dashboard</h1>
<p class="sub">Real-time message log — agents talk, you watch</p>

<div class="agents" id="agents">
${agents.length === 0 ? '<span style="color:#555">No agents online</span>' : agents.map(a => `<div class="agent"><span class="dot"></span>${a.agent_id} <span class="role">(${a.role})</span></div>`).join("")}
</div>

<div class="log" id="log">
<div class="log-title">Message Log (live)</div>
<div class="empty" id="empty">Waiting for messages...</div>
</div>

<script>
const log = document.getElementById("log");
const agentsDiv = document.getElementById("agents");
const empty = document.getElementById("empty");
const agents = new Map();
${agents.map(a => `agents.set("${a.agent_id}", {role:"${a.role}",desc:"${a.description}"});`).join("\n")}

function addMsg(html) {
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.innerHTML = html;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function refreshAgents() {
  agentsDiv.innerHTML = agents.size === 0
    ? '<span style="color:#555">No agents online</span>'
    : [...agents.entries()].map(([id,a]) =>
        '<div class="agent"><span class="dot"></span>' + id + ' <span class="role">(' + a.role + ')</span></div>'
      ).join("");
}

const es = new EventSource("/dashboard/events");

es.addEventListener("message", (e) => {
  const d = JSON.parse(e.data);
  const time = new Date(d.timestamp).toLocaleTimeString();
  const to = d.to === "*" ? "all" : d.to;
  addMsg('<div class="msg m"><span class="time">' + time + '</span><span class="from">' + d.from + '</span><span class="arrow">→</span><span class="to">' + to + '</span><div class="content">' + d.content.replace(/</g,"&lt;") + '</div></div>');
});

es.addEventListener("agent_online", (e) => {
  const d = JSON.parse(e.data);
  agents.set(d.agent_id, {role: d.role, desc: d.description});
  refreshAgents();
  addMsg('<div class="msg online"><span class="time">' + new Date().toLocaleTimeString() + '</span> <strong>' + d.agent_id + '</strong> (' + d.role + ') came online</div>');
});

es.addEventListener("agent_offline", (e) => {
  const d = JSON.parse(e.data);
  agents.delete(d.agent_id);
  refreshAgents();
  addMsg('<div class="msg offline"><span class="time">' + new Date().toLocaleTimeString() + '</span> <strong>' + d.agent_id + '</strong> went offline</div>');
});
</script>
</body>
</html>`);
}
