# Agent Bridge — 完整用户旅程

> 本文档既是用户指南，也是端到端验收标准。
> 每个场景 = 一个可测试的 E2E case。

---

## 全局视角

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户旅程总览                                 │
│                                                                     │
│  安装阶段          连接阶段           协作阶段           生命周期     │
│  (一次性)         (按需)             (核心价值)         (收尾)       │
│                                                                     │
│  A: hub ────┐                                                       │
│             │   A: "连接 bridge"      A: "告诉 B..."                │
│  B: join ───┘   B: "和后端联调"       B: "看看消息"     B: disconnect│
│  C: join        C: (正常开发)         C: (不受影响)     A: Ctrl+C   │
│                                                                     │
│  ← 各 1 条命令 → ← 自然语言触发 →  ← 自然语言通信 → ← 自然退出 →  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 阶段一：安装（一次性，各一条命令）

### 场景 1.1 — Person A 启动 Hub

**操作**：
```bash
npx agent-bridge hub
```

**期望结果**：
```
  ┌─ Hub is running ──────────────────────────────────────────────────┐
  │ Hub URL:    http://100.120.199.82:9900                            │
  │ Token:      3a20f7eb                                              │
  │ Dashboard:  http://100.120.199.82:9900                            │
  │                                                                   │
  │ Share this with your team to join:                                │
  │                                                                   │
  │ npx agent-bridge join http://100.120.199.82:9900 --token 3a20f7eb │
  └───────────────────────────────────────────────────────────────────┘
  Configuring local Claude Code MCP plugin...
  ✓ MCP plugin configured.
  Waiting for agents to connect...
```

**幕后发生的事**：
1. Hub HTTP 服务器启动（端口 9900）
2. 自动检测本机 IP（优先 Tailscale 100.x.x.x，其次 LAN IP）
3. 自动生成 token（或使用 `--token` 指定）
4. 自动配置本机的 Claude Code MCP plugin（scope: project）
5. 自动在 CLAUDE.md 中添加 Agent Bridge 使用说明

**A 需要做的事**：复制最后那行 `npx agent-bridge join ...` 发给队友。
**A 不需要做的事**：任何手动配置。

---

### 场景 1.2 — Person B 加入 Hub

**操作**：粘贴 A 发来的命令
```bash
npx agent-bridge join http://100.120.199.82:9900 --token 3a20f7eb
```

**交互过程**：
```
  Connecting to hub...
  Connected! 1 agent(s) currently online

  ? Agent ID [macbook-pro]: ⏎          ← 直接回车用默认
  ? Role [member]: frontend            ← 输入角色
  ? Description: React frontend dev    ← 可选描述

  ? Configure for:
    1) This project only (recommended)
    2) All projects
  Enter choice [1/2]: ⏎               ← 直接回车选 1

  Configuring Claude Code MCP plugin...
  ✓ MCP plugin configured.

  ┌─ Ready to go ────────────────────────────────────────┐
  │ Agent ID:  macbook-pro                                │
  │ Role:      frontend                                   │
  │ Hub:       http://100.120.199.82:9900                 │
  │                                                       │
  │ Next steps:                                           │
  │   1. Restart Claude Code (or open a new session)      │
  │   2. Say: "连接 bridge" or "connect to the hub"       │
  │   3. Start collaborating!                             │
  └───────────────────────────────────────────────────────┘
```

**幕后发生的事**：
1. 验证 Hub 可达 + token 正确（调 `list_agents`）
2. 收集 agent 身份信息
3. 执行 `claude mcp add agent-bridge` 配置 MCP plugin
4. 在项目 CLAUDE.md 中添加使用说明

**B 需要做的事**：粘贴命令，回答 2-3 个问题，重启 Claude Code。
**B 不需要做的事**：知道 MCP 是什么，编辑任何配置文件。

---

### 场景 1.3 — Person C 也加入（多人）

同场景 1.2。支持任意数量的 agent 加入同一个 Hub。

**Hub 端（A 的终端）会看到**：
```
  21:30:15  + macbook-pro joined (frontend)
  21:31:02  + drone-01 joined (backend)
```

---

## 阶段二：连接（按需，自然语言触发）

### 核心设计：不打扰不需要协作的终端

MCP plugin 加载后**默认不连接 Hub**。只有用户明确需要协作时，Claude 才调用 `connect`。

这意味着：
- 同一台机器上可以开 5 个 Claude Code 终端
- 只有说了"连接 bridge"的那个才会加入通信
- 其他终端完全不受影响，甚至不知道 bridge 存在

---

### 场景 2.1 — 需要协作的终端

**用户说**：
```
"连接 bridge，我要和前端联调"
```

**Claude 的行为**：
1. 识别到用户需要协作（CLAUDE.md 中有关键词匹配说明）
2. 调用 `connect` 工具
3. MCP plugin 连接 SSE + 注册到 Hub

**Claude 返回**：
```
已连接到 Hub，ID: drone-01 (backend)

在线 agents:
  🟢 macbook-pro (frontend) — React frontend dev

可以直接告诉我你想和前端说什么。
```

---

### 场景 2.2 — 不需要协作的终端

**用户说**：
```
"帮我重构一下 UserService 的错误处理"
```

**Claude 的行为**：正常工作，完全不涉及 Agent Bridge。
- 不调用 `connect`
- 不检查消息
- 工具列表中只有一个 `connect` 工具（不碍事）

---

### 场景 2.3 — 连接失败（Hub 不可达）

**用户说**：`"连接 bridge"`

**Claude 调用 `connect`，plugin 返回**：
```
Error: SSE connection failed: ECONNREFUSED
```

**Claude 回复**：
```
连接 Hub 失败，可能 Hub 没在运行。让 A 确认一下 `npx agent-bridge hub` 是否还在跑。
```

---

## 阶段三：协作（核心价值 — 全自然语言）

### 关键机制：搭便车通知

每次调用任何 MCP 工具（send_message、list_agents），返回结果会**附带未读消息数**：

```
Message sent (id: 42, time: 21:32:05)

📬 You have 2 unread message(s). Call read_messages to check.
```

Claude 看到这个 hint，**自然会去读消息**。不需要定时轮询，不浪费请求。

---

### 场景 3.1 — 一对一消息

**A 的 Claude Code 中说**：
```
"告诉前端同学，/api/v2/auth 接口已经好了，请求参数是 { email, password }"
```

**Claude 的行为**：
1. 调用 `list_agents` → 找到 macbook-pro (frontend)
2. 调用 `send_message(to: "macbook-pro", content: "/api/v2/auth 接口已就绪，参数: { email, password }")"`
3. 返回 "消息已发送"

**B 端的 Claude Code 中**：
- 下次 B 和 Claude 对话时，Claude 读到 CLAUDE.md 规则 → 调 `read_messages`
- 或者 B 说 "看看有没有新消息"
- 或者 B 在使用其他 bridge 工具时看到 "📬 1 unread" 的提示

**B 看到**：
```
收到来自 drone-01 的消息：
/api/v2/auth 接口已就绪，参数: { email, password }
```

---

### 场景 3.2 — 广播消息

**A 说**：
```
"广播给所有人：数据库今晚 10 点维护，API 会中断 30 分钟"
```

**Claude 的行为**：
```
send_message(to: "*", content: "数据库今晚 22:00 维护，API 中断约 30 分钟")
```

所有在线 agent 通过 SSE 实时收到。

---

### 场景 3.3 — 请求-响应模式（提问 + 回答）

**B（前端）说**：
```
"问一下后端，用户注册接口的错误码有哪些？"
```

**B 的 Claude**：
```
send_message(to: "drone-01", content: "请提供用户注册接口的错误码列表")
```

**A（后端）下次对话时**：
```
[read_messages]
来自 macbook-pro: 请提供用户注册接口的错误码列表
```

**A 的 Claude**（可以读本地代码后回复）：
```
send_message(to: "macbook-pro", content: "注册接口错误码: 400 参数缺失, 409 邮箱已存在, 422 密码太弱, 500 服务器错误")
```

---

### 场景 3.4 — B 没有说话时收到消息（实时通知）

**A 说**：`"告诉前端，接口改了，你需要改一下"`

**A 的 Claude** → `send_message` → Hub → SSE 推送到 B 的 MCP plugin。

**B 当前状态**：Claude Code 开着，但用户没有说话（空闲）。

**发生的事**：

```
SSE 消息到达 → MCP plugin 收到
                 ├─ 1. 存入本地 MessageQueue（给 Claude 之后读）
                 └─ 2. 弹系统通知（给人看）👈 关键！
```

**B 的用户看到**（macOS 通知中心弹出）：

```
┌──────────────────────────────────┐
│ 🔔 Agent Bridge                  │
│ drone-01: 接口改了，你需要改一下  │
└──────────────────────────────────┘
```

**B 的用户看到通知后，对 Claude 说**：
```
"看看消息"
```

**Claude 调 `read_messages`**：
```
[drone-01] 接口改了，你需要改一下
```

**完整闭环**：
```
A 说话 → Claude 发消息 → Hub 转发 → B 的 plugin 收到
                                       ├→ 系统通知弹出（人看到）
                                       └→ 消息入队（Claude 之后读）
                                    人说"看看消息" → Claude 读到 → 处理
```

**不会石沉大海。** 即使 B 没在和 Claude 对话，系统通知也会提醒 B。

---

### 场景 3.5 — 消息送达但对方未 connect

**A 发消息给 B，但 B 的 Claude Code 当前没有调 `connect`**。

**发生的事**：
1. Hub 存储消息（内存中）
2. B 不会收到系统通知（SSE 未连接，plugin 收不到推送）
3. B 下次 `connect` 后调用 `read_messages` → 能读到历史消息
4. 消息不丢失，只是延迟

---

### 场景 3.6 — 多轮联调对话

典型的前后端联调流程：

```
B→A: "POST /api/login 返回 500，body 是 {email: 'test@test.com', password: '123'}"
A→B: "已修复，是 bcrypt 的依赖版本问题。请重试"
B→A: "现在返回 200 了，但 token 的 expires_in 字段是 null"
A→B: "已修复，expires_in 现在返回 3600（单位秒）"
B→A: "确认通过 ✅ 登录流程联调完成"
```

**每条消息 = 一次 `send_message` 调用。对用户来说就是自然语言对话。**

---

## 阶段四：生命周期

### 场景 4.1 — 主动断开连接

**用户说**：`"联调结束了，断开 bridge"`

**Claude 调用** `disconnect`。

**发生的事**：
1. SSE 连接断开
2. Hub 检测到断开 → 标记 agent offline
3. 其他 agent 通过 SSE 收到 `agent_offline` 事件
4. 该终端的 Claude Code 回到普通模式，工具列表只剩 `connect`

---

### 场景 4.2 — 关闭终端（非主动）

用户直接关了终端或 Ctrl+C Claude Code。

**发生的事**：同 4.1 — SSE 连接断开，Hub 自动标记 offline。无需额外处理。

---

### 场景 4.3 — 重新连接

**用户说**：`"重新连接 bridge"`

**Claude 调用** `connect` → 重新注册 + 建立 SSE → 恢复通信。

可以读到断开期间的历史消息（通过 `read_messages`）。

---

### 场景 4.4 — Hub 关闭

Hub 操作者 Ctrl+C 停止 Hub。

**所有 agent 端**：
- SSE 连接断开
- MCP plugin 的 SSE loop 自动重连（指数退避：1s → 2s → 4s → ... → 30s）
- 期间所有 tool 调用返回错误提示

**Hub 重启后**：
- Agent 的 SSE 自动重连成功
- 但需要重新 `connect`（重新注册），因为 Hub 内存已清空

---

## 阶段五：Dashboard（旁观者视角）

### 场景 5.1 — 在浏览器中查看

**任何人打开** Hub URL（如 `http://100.120.199.82:9900`）：
- 看到所有在线 agent
- 看到实时消息流（SSE 推送）
- **不需要 token**（只读）

这让不参与联调的人也能观察进度。

---

## 验收 checklist

| # | 场景 | 验收标准 |
|---|------|---------|
| 1.1 | hub 启动 | 打印 join 命令 + 自动配置 MCP |
| 1.2 | join 加入 | 验证连通 → 交互配置 → MCP 就绪 |
| 2.1 | 按需连接 | 说"连接"才调 connect，否则不连 |
| 2.2 | 不干扰 | 不需要协作的终端零噪音 |
| 2.3 | 连接失败 | 友好报错，不崩溃 |
| 3.1 | 一对一消息 | A→B 送达，B 能读到 |
| 3.2 | 广播 | A→* 所有人收到 |
| 3.3 | 请求-响应 | 来回多轮对话正常 |
| 3.4 | 空闲时收消息 | 系统通知弹出，人看到后说"看消息"即可 |
| 3.5 | 未 connect 时 | 消息存在 Hub，connect 后可读历史 |
| 3.6 | 多轮联调 | 5+ 轮对话无丢失 |
| 4.1 | 主动断开 | disconnect 后 Hub 标记 offline |
| 4.2 | 被动断开 | 关终端 = 自动 offline |
| 4.3 | 重连 | connect 后恢复通信 + 历史消息 |
| 4.4 | Hub 重启 | Agent 自动重连，需重新 register |
| 5.1 | Dashboard | 浏览器实时查看，无需认证 |

---

## 已知限制 & 后续改进

| 问题 | 现状 | 改进方向 |
|------|------|---------|
| Hub 重启丢数据 | 内存存储 | Phase 2: 持久化 EventStore |
| 消息无确认机制 | 发了不知道对方是否看了 | 已读回执 / delivery status |
| Agent 不会主动检查消息 | 系统通知提醒人类 → 人说话触发 Claude | MCP Resource Notification（真正自动） |
| Hub 需要手动启动 | 有人得跑 `hub` 命令 | Phase 4: 自动发现 (mDNS/Bonjour) |
| 一个 hub 一个 token | 所有人共享同一 token | Per-agent token / OAuth |
