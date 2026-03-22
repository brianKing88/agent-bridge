# Agent Bridge — MVP 最终设计

> 两个 Claude Code agent 跨网络对话，零人工中继。

---

## 1. 架构

```
Machine A                                          Machine B
┌──────────────────────┐                          ┌──────────────────────┐
│                      │                          │                      │
│  Claude Code         │                          │  Claude Code         │
│  (后端 agent)        │                          │  (前端 agent)        │
│       │ stdio        │                          │       │ stdio        │
│       ▼              │                          │       ▼              │
│  ┌────────────────┐  │                          │  ┌────────────────┐  │
│  │ Bridge Plugin  │  │   POST /rpc (JSON-RPC)   │  │ Bridge Plugin  │  │
│  │                │──┼─────────────────────────►│  │                │  │
│  │ MCP Tools:     │  │                          │  │ MCP Tools:     │  │
│  │ • send_message │  │◄── SSE /events ──────────┼──│ • send_message │  │
│  │ • read_messages│  │                          │  │ • read_messages│  │
│  │ • list_agents  │  │         Relay Hub        │  │ • list_agents  │  │
│  └────────────────┘  │      ┌────────────┐      │  └────────────────┘  │
│                      │      │ Registry   │      │                      │
└──────────────────────┘      │ MessageBus │      └──────────────────────┘
                              │ SSE Mgr    │
                              │ Auth       │
                              └────────────┘
                              任意机器上运行
                              (Tailscale / LAN / 公网)
```

**两条通道**：

| 通道 | 方向 | 协议 | 用途 |
|------|------|------|------|
| RPC | Plugin → Hub | HTTP POST, JSON-RPC 2.0 | 所有主动操作 |
| Event | Hub → Plugin | SSE (Server-Sent Events) | 所有被动推送 |

---

## 2. 接口契约

### 2.1 JSON-RPC 方法 (POST /rpc)

每个请求携带 `Authorization: Bearer <AGENT_BRIDGE_TOKEN>`。

#### register

```json
// 请求
{ "jsonrpc": "2.0", "id": "1", "method": "register",
  "params": { "agent_id": "backend-01", "role": "backend", "description": "后端 API 开发" } }

// 响应
{ "jsonrpc": "2.0", "id": "1", "result": { "ok": true } }
```

#### list_agents

```json
// 请求
{ "jsonrpc": "2.0", "id": "2", "method": "list_agents", "params": {} }

// 响应
{ "jsonrpc": "2.0", "id": "2", "result": [
  { "agent_id": "backend-01", "role": "backend", "description": "后端 API 开发", "status": "online" },
  { "agent_id": "frontend-01", "role": "frontend", "description": "前端 React 开发", "status": "online" }
] }
```

#### send_message

```json
// 点对点
{ "jsonrpc": "2.0", "id": "3", "method": "send_message",
  "params": { "to": "frontend-01", "content": "POST /api/login 接口已实现，返回 {token, user}" } }

// 广播
{ "jsonrpc": "2.0", "id": "4", "method": "send_message",
  "params": { "to": "*", "content": "数据库 schema 有变更，所有人注意" } }

// 响应
{ "jsonrpc": "2.0", "id": "3", "result": { "id": 42, "timestamp": "2026-03-22T10:01:00Z" } }
```

#### read_messages

```json
// 请求（拉取新消息）
{ "jsonrpc": "2.0", "id": "5", "method": "read_messages",
  "params": { "since_id": 40, "limit": 50 } }

// 请求（按发送者过滤）
{ "jsonrpc": "2.0", "id": "6", "method": "read_messages",
  "params": { "from": "backend-01" } }

// 响应
{ "jsonrpc": "2.0", "id": "5", "result": [
  { "id": 41, "from": "backend-01", "to": "frontend-01", "content": "接口已修复", "timestamp": "..." },
  { "id": 42, "from": "backend-01", "to": "*", "content": "schema 变更", "timestamp": "..." }
] }
```

#### 错误响应

```json
{ "jsonrpc": "2.0", "id": "1", "error": { "code": -32000, "message": "Unauthorized" } }
{ "jsonrpc": "2.0", "id": "2", "error": { "code": -32601, "message": "Method not found" } }
{ "jsonrpc": "2.0", "id": "3", "error": { "code": -32001, "message": "Agent not found: xyz" } }
```

### 2.2 SSE 事件 (GET /events?agent_id=xxx)

携带 `Authorization: Bearer <AGENT_BRIDGE_TOKEN>`。

```
event: message
data: {"id":42,"from":"backend-01","to":"frontend-01","content":"接口已实现","timestamp":"2026-03-22T10:01:00Z"}

event: agent_online
data: {"agent_id":"frontend-01","role":"frontend","description":"前端 React 开发"}

event: agent_offline
data: {"agent_id":"frontend-01"}

: heartbeat
```

心跳每 15 秒发一次 SSE comment，保持连接活跃。

### 2.3 MCP Tools（Plugin 暴露给 Claude Code）

| Tool | 参数 | 说明 |
|------|------|------|
| `send_message` | `to: string, content: string` | 发消息（`to` 可以是 agent_id 或 `"*"`） |
| `read_messages` | `since_id?: number, from?: string, limit?: number` | 读取新消息 |
| `list_agents` | 无 | 查看在线 agent |

---

## 3. 开发者使用流程

### 第一步：安装

```bash
npm install -g agent-bridge
```

### 第二步：启动 Hub

在任意一台机器上（推荐 Tailscale 网络内常驻的机器）：

```bash
export AGENT_BRIDGE_TOKEN=my-secret-token
agent-bridge hub --port 9900

# 输出:
# Agent Bridge Hub running on http://0.0.0.0:9900
# Token: my-secret-token
```

### 第三步：配置 Claude Code（每台机器）

Machine A（后端 agent）：

```bash
claude mcp add agent-bridge --scope user \
  -e AGENT_BRIDGE_HUB=http://100.64.1.1:9900 \
  -e AGENT_BRIDGE_TOKEN=my-secret-token \
  -e AGENT_BRIDGE_AGENT_ID=backend-01 \
  -e AGENT_BRIDGE_ROLE=backend \
  -e AGENT_BRIDGE_DESC="后端 API 开发" \
  -- node /path/to/agent-bridge/plugin/index.mjs
```

Machine B（前端 agent）：

```bash
claude mcp add agent-bridge --scope user \
  -e AGENT_BRIDGE_HUB=http://100.64.1.2:9900 \
  -e AGENT_BRIDGE_TOKEN=my-secret-token \
  -e AGENT_BRIDGE_AGENT_ID=frontend-01 \
  -e AGENT_BRIDGE_ROLE=frontend \
  -e AGENT_BRIDGE_DESC="前端 React 开发" \
  -- node /path/to/agent-bridge/plugin/index.mjs
```

### 第四步：开始协作

在 Claude Code 中自然语言对话：

```
用户: "告诉前端 agent，登录接口已经实现了"
Claude Code: [调用 send_message(to="frontend-01", content="POST /api/login 已实现...")]

用户: "看看有没有新消息"
Claude Code: [调用 read_messages()]
→ "来自 frontend-01: token 过期时间是多少？"
```

---

## 4. 使用场景示例：前后端联调登录功能

```
时间轴                 后端 agent (backend-01)              前端 agent (frontend-01)
──────────────────────────────────────────────────────────────────────────────────

10:00  [启动]          register → Hub ✓                     register → Hub ✓
                       SSE: agent_online(frontend-01)       SSE: agent_online(backend-01)

10:01  [后端通知]       send_message →
                       to: frontend-01                      ← SSE: message
                       "POST /api/login 接口已实现            read_messages()
                        参数: {email, password}              看到: "POST /api/login 已实现..."
                        返回: {token, refresh_token, user}"

10:02  [前端提问]                                            send_message →
                       ← SSE: message                       to: backend-01
                       read_messages()                      "token 过期时间是多少？
                       看到: "token 过期时间是多少？"           需要设置自动刷新"

10:03  [后端回答]       send_message →
                       to: frontend-01                      ← SSE: message
                       "access_token 15分钟                  read_messages()
                        refresh_token 7天                    看到: "access_token 15分钟..."
                        刷新: POST /api/refresh"

10:05  [前端完成]                                            send_message →
                       ← SSE: message                       to: backend-01
                       read_messages()                      "登录 + 自动刷新已实现 ✅
                       看到: "登录 + 自动刷新已实现 ✅"         测试通过"

10:06  [广播]           send_message →
                       to: "*"                              ← SSE: message
                       "登录功能联调完成，                     read_messages()
                        下一个: 用户注册"                     看到: "登录功能联调完成..."
```

### 消息在 Hub 中的存储（内存）

```
messages = [
  { id: 1, from: "backend-01",  to: "frontend-01", content: "POST /api/login...",    ts: "10:01" },
  { id: 2, from: "frontend-01", to: "backend-01",  content: "token 过期时间...",      ts: "10:02" },
  { id: 3, from: "backend-01",  to: "frontend-01", content: "access_token 15分钟...", ts: "10:03" },
  { id: 4, from: "frontend-01", to: "backend-01",  content: "登录已实现 ✅",          ts: "10:05" },
  { id: 5, from: "backend-01",  to: "*",           content: "登录联调完成...",         ts: "10:06" },
]
```

---

## 5. Hub 内部模块

```
packages/hub/src/
├── index.ts            启动入口
├── server.ts           Express 服务器 (POST /rpc + GET /events)
├── rpc-handler.ts      JSON-RPC 2.0 分发器
├── auth.ts             Bearer Token 校验中间件
├── registry.ts         Agent 注册与发现 (Map<AgentId, AgentInfo>)
├── message-bus.ts      消息路由与存储 (Array<Message>)
└── sse-manager.ts      SSE 连接管理 (Map<AgentId, Response>)
```

实现顺序：`rpc-handler → auth → registry → message-bus → sse-manager → server → index`

---

## 6. 技术栈

| 组件 | 选型 |
|------|------|
| Hub 运行时 | Node.js 20+, TypeScript, ESM |
| HTTP 框架 | Express |
| RPC 协议 | JSON-RPC 2.0 |
| 推送 | SSE (Server-Sent Events) |
| 存储 | 内存 Map/Array (MVP) |
| 认证 | Bearer Token (环境变量) |
| MCP SDK | @modelcontextprotocol/sdk |
| 包管理 | pnpm (monorepo workspace) |
| 测试 | vitest |

---

## 7. MVP 不做的事

- ❌ SQLite 持久化（Phase 2）
- ❌ Bridge Code 配对（Phase 4）
- ❌ 白板 Blackboard（Phase 2）
- ❌ 契约 ContractStore（Phase 3）
- ❌ 自动网络发现（Phase 4）
- ❌ Claude Code 对话注入（开放问题）
- ❌ gRPC 绑定（Phase 4）
