# Agent Bridge — 交互体验重新设计

## 当前体验（太复杂）

```
用户需要做 7 件事：
1. git clone
2. pnpm install
3. 在远程启动 Hub（记住 token）
4. 本机 claude mcp add（输入 5 个环境变量）
5. 重启 Claude Code
6. 记住自己的 agent_id
7. 记住对方的 agent_id 才能发消息

问题：
- 不知道哪个是自己
- 不知道对方是谁
- token 容易搞错
- agent_id 要手动取名
- 注册是隐式的（Plugin 启动时自动注册），但测试时 curl 也能注册，导致幽灵 agent
```

## 理想体验（最简化）

```
整个过程只需要 3 步：

┌─────────────────────────────────────────────────────┐
│ 第 1 步：任意机器启动 Hub                              │
│                                                      │
│   $ npx agent-bridge hub                             │
│                                                      │
│   ✅ Hub running on http://0.0.0.0:9900              │
│   🔑 Token: a7x9k2                                  │
│   📋 Join command (copy to other machines):          │
│                                                      │
│   npx agent-bridge join --hub http://THIS_IP:9900    │
│                         --token a7x9k2               │
│                                                      │
└─────────────────────────────────────────────────────┘
                         │
                         │ 用户复制这条命令到另一台机器
                         ▼
┌─────────────────────────────────────────────────────┐
│ 第 2 步：另一台机器加入                               │
│                                                      │
│   $ npx agent-bridge join --hub http://x.x.x.x:9900 │
│                            --token a7x9k2            │
│                                                      │
│   自动完成：                                          │
│   ✅ 生成 agent_id（用主机名: orangepi-backend）      │
│   ✅ 注册到 Hub                                      │
│   ✅ 写入 Claude Code MCP 配置                       │
│   ✅ 提示重启 Claude Code                             │
│                                                      │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ 第 3 步：在 Claude Code 里直接用                      │
│                                                      │
│   > "看看谁在线"                                      │
│                                                      │
│   🟢 orangepi-backend (backend) — 无人机任务机       │
│   🟢 brian-mac (frontend) — 你                       │
│       ↑ 自动标记哪个是"你"                            │
│                                                      │
│   > "告诉后端 agent，接口加个 battery 字段"            │
│                                                      │
│   ✅ 消息已发送给 orangepi-backend                    │
│                                                      │
│   不需要记住 agent_id！                               │
│   "后端 agent" / "前端" / "对方" 都能自动识别          │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## 关键简化

| 之前 | 之后 |
|------|------|
| 手动取 agent_id | 自动用 `主机名-角色`（如 `orangepi-backend`） |
| 5 个环境变量 | 2 个参数（`--hub` 和 `--token`） |
| 手动 `claude mcp add` | `join` 命令自动写入 |
| 不知道哪个是自己 | `list_agents` 标记 `← you` |
| 需要记住对方 agent_id | 说"后端 agent"就能自动匹配 |
| curl 测试会残留幽灵 agent | Hub 重启清空（内存存储） |
| token 手动想 | Hub 自动生成随机 token |

## 需要改的代码

### 1. Hub 启动时自动生成 token

```typescript
// packages/hub/src/index.ts
const token = process.env.AGENT_BRIDGE_TOKEN ?? crypto.randomUUID().slice(0, 8);
```

### 2. Plugin 自动生成 agent_id

```typescript
// packages/mcp-plugin/src/index.ts
import os from "node:os";
const hostname = os.hostname().split(".")[0]; // "orangepi" / "brians-mac"
const agentId = process.env.AGENT_BRIDGE_AGENT_ID ?? `${hostname}-${role}`;
```

### 3. list_agents 标记自己

```typescript
// packages/mcp-plugin/src/tools.ts — list_agents 输出
agents.map(a =>
  `${a.status === "online" ? "🟢" : "⚪"} ${a.agent_id} (${a.role}) — ${a.description}${a.agent_id === myAgentId ? " ← you" : ""}`
)
```

### 4. CLI join 命令

```bash
# npx agent-bridge join --hub http://x.x.x.x:9900 --token abc123 --role backend
# 自动：
# 1. 生成 agent_id
# 2. claude mcp add agent-bridge --scope user ...
# 3. 打印 "Done! Restart Claude Code to start collaborating."
```
