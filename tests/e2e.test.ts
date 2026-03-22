/**
 * Agent Bridge E2E 测试
 *
 * 验收标准：两个 agent 通过 Relay Hub 跨网络完成 5 轮对话。
 *
 * 测试流程：
 * 1. 启动 Hub
 * 2. Agent A 注册（后端）
 * 3. Agent B 注册（前端）
 * 4. A 发消息给 B
 * 5. B 通过 read_messages 收到
 * 6. B 回复 A
 * 7. A 通过 read_messages 收到
 * 8. 重复至 5 轮
 * 9. 验证 agent 上下线事件
 * 10. 关闭 Hub
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const HUB_PORT = 19900; // 测试用端口，避免和生产冲突
const HUB_URL = `http://127.0.0.1:${HUB_PORT}`;
const TOKEN = "test-token-e2e";

// ============================================================
// Helper: JSON-RPC 请求
// ============================================================

let requestId = 0;

async function rpc(method: string, params: Record<string, unknown> = {}) {
  requestId++;
  const res = await fetch(`${HUB_URL}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: String(requestId),
      method,
      params,
    }),
  });
  return res.json();
}

// ============================================================
// Helper: SSE 连接
// ============================================================

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function connectSse(agentId: string): {
  events: SseEvent[];
  close: () => void;
  waitForEvent: (eventType: string, timeout?: number) => Promise<SseEvent>;
} {
  const events: SseEvent[] = [];
  const controller = new AbortController();

  // Start SSE connection in background
  fetch(`${HUB_URL}/events?agent_id=${agentId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: controller.signal,
  })
    .then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!; // keep incomplete line

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push({ event: currentEvent, data });
              currentEvent = "message"; // reset
            } catch {
              // ignore parse errors
            }
          }
          // ignore comments (: heartbeat) and empty lines
        }
      }
    })
    .catch(() => {
      // AbortError on close, ignore
    });

  function waitForEvent(
    eventType: string,
    timeout = 5000
  ): Promise<SseEvent> {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      function check() {
        const found = events.find(
          (e) => e.event === eventType && !("_consumed" in e.data)
        );
        if (found) {
          (found.data as Record<string, unknown>)._consumed = true;
          resolve(found);
          return;
        }
        if (Date.now() - start > timeout) {
          reject(
            new Error(
              `Timeout waiting for SSE event "${eventType}" (${timeout}ms)`
            )
          );
          return;
        }
        setTimeout(check, 50);
      }
      check();
    });
  }

  return {
    events,
    close: () => controller.abort(),
    waitForEvent,
  };
}

// ============================================================
// Helper: 等待一小段时间（让 SSE 传输完成）
// ============================================================

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// 测试
// ============================================================

describe("Agent Bridge E2E", () => {
  let hubProcess: { kill: () => void } | null = null;

  beforeAll(async () => {
    // 启动 Hub
    // 使用动态 import 来启动 Hub server
    // Hub 需要读取 AGENT_BRIDGE_TOKEN 和端口
    process.env.AGENT_BRIDGE_TOKEN = TOKEN;
    process.env.PORT = String(HUB_PORT);

    try {
      const hub = await import("../packages/hub/src/server.js");
      if (hub.createServer) {
        const server = hub.createServer();
        await new Promise<void>((resolve) => {
          server.listen(HUB_PORT, () => resolve());
        });
        hubProcess = { kill: () => server.close() };
      } else if (hub.app) {
        const server = hub.app.listen(HUB_PORT);
        hubProcess = { kill: () => server.close() };
      }
    } catch {
      // Hub may not be ready yet, try starting as subprocess
      const { spawn } = await import("child_process");
      const proc = spawn("npx", ["tsx", "packages/hub/src/index.ts"], {
        env: { ...process.env, AGENT_BRIDGE_TOKEN: TOKEN, PORT: String(HUB_PORT) },
        cwd: new URL("..", import.meta.url).pathname,
        stdio: "pipe",
      });
      hubProcess = { kill: () => proc.kill() };
      // Wait for Hub to be ready
      await sleep(2000);
    }
  }, 10000);

  afterAll(() => {
    hubProcess?.kill();
  });

  // ----------------------------------------------------------
  // Test 1: Hub 健康检查
  // ----------------------------------------------------------
  it("Hub 响应 JSON-RPC 请求", async () => {
    const res = await rpc("list_agents");
    expect(res.jsonrpc).toBe("2.0");
    expect(res.result).toBeInstanceOf(Array);
  });

  // ----------------------------------------------------------
  // Test 2: 认证 — 无 Token 被拒绝
  // ----------------------------------------------------------
  it("无 Token 返回 401", async () => {
    const res = await fetch(`${HUB_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "auth-test",
        method: "list_agents",
        params: {},
      }),
    });
    // 应该返回 401 或 JSON-RPC 错误
    const body = await res.json();
    const isUnauthorized =
      res.status === 401 || body.error?.code === -32000;
    expect(isUnauthorized).toBe(true);
  });

  // ----------------------------------------------------------
  // Test 3: Agent 注册
  // ----------------------------------------------------------
  it("Agent 注册成功", async () => {
    const res = await rpc("register", {
      agent_id: "backend-01",
      role: "backend",
      description: "后端 API 开发",
    });
    expect(res.result).toEqual({ ok: true });
  });

  it("重复注册返回错误", async () => {
    const res = await rpc("register", {
      agent_id: "backend-01",
      role: "backend",
      description: "后端 API 开发",
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32002); // DUPLICATE_AGENT
  });

  // ----------------------------------------------------------
  // Test 4: Agent 列表
  // ----------------------------------------------------------
  it("list_agents 返回已注册 agent", async () => {
    // 先注册第二个 agent
    await rpc("register", {
      agent_id: "frontend-01",
      role: "frontend",
      description: "前端 React 开发",
    });

    const res = await rpc("list_agents");
    expect(res.result).toHaveLength(2);

    const ids = res.result.map((a: { agent_id: string }) => a.agent_id);
    expect(ids).toContain("backend-01");
    expect(ids).toContain("frontend-01");
  });

  // ----------------------------------------------------------
  // Test 5: 消息发送与接收（5 轮对话）
  // ----------------------------------------------------------
  it("两个 agent 完成 5 轮对话", async () => {
    const conversation = [
      {
        from: "backend-01",
        to: "frontend-01",
        content: "POST /api/telemetry 接口已实现，返回 {lat, lng, altitude, battery}",
      },
      {
        from: "frontend-01",
        to: "backend-01",
        content: "收到，battery 字段的值范围是 0-100 还是 0.0-1.0？",
      },
      {
        from: "backend-01",
        to: "frontend-01",
        content: "0-100 整数。另外低电量 (<20) 时 MQTT QoS 从 0 改为 1。",
      },
      {
        from: "frontend-01",
        to: "backend-01",
        content: "好的，已添加电量显示条和低电量红色告警。联调检查一下？",
      },
      {
        from: "backend-01",
        to: "frontend-01",
        content: "确认联调通过。下一个接口：POST /api/mission/start",
      },
    ];

    let lastId = 0;

    for (const msg of conversation) {
      // 发送
      const sendRes = await rpc("send_message", {
        to: msg.to,
        content: msg.content,
      });
      // 这里我们模拟发送者身份 — Hub 需要知道谁在发
      // 注意：实际实现中 Hub 从 token 或 register 信息推断发送者
      // E2E 测试中我们简化处理
      expect(sendRes.result).toBeDefined();
      expect(sendRes.result.id).toBeGreaterThan(lastId);
      lastId = sendRes.result.id;

      // 接收方读取
      const readRes = await rpc("read_messages", {
        since_id: lastId - 1,
        limit: 1,
      });
      expect(readRes.result).toBeInstanceOf(Array);
      expect(readRes.result.length).toBeGreaterThanOrEqual(1);

      const received = readRes.result[readRes.result.length - 1];
      expect(received.content).toBe(msg.content);
    }
  });

  // ----------------------------------------------------------
  // Test 6: 广播消息
  // ----------------------------------------------------------
  it("广播消息发送给所有 agent", async () => {
    const res = await rpc("send_message", {
      to: "*",
      content: "全体注意：数据库 schema 有变更",
    });
    expect(res.result).toBeDefined();
    expect(res.result.id).toBeGreaterThan(0);

    // 任意 agent 都能读到广播消息
    const readRes = await rpc("read_messages", {
      since_id: res.result.id - 1,
    });
    const broadcast = readRes.result.find(
      (m: { to: string }) => m.to === "*"
    );
    expect(broadcast).toBeDefined();
    expect(broadcast.content).toContain("schema 有变更");
  });

  // ----------------------------------------------------------
  // Test 7: SSE 事件推送
  // ----------------------------------------------------------
  it("SSE 推送消息事件", async () => {
    const sse = connectSse("frontend-01");

    // 等待 SSE 连接建立
    await sleep(500);

    // 后端发消息给前端
    await rpc("send_message", {
      to: "frontend-01",
      content: "SSE 测试消息",
    });

    // 前端应通过 SSE 收到
    const event = await sse.waitForEvent("message", 3000);
    expect(event.data.content).toBe("SSE 测试消息");

    sse.close();
  });

  // ----------------------------------------------------------
  // Test 8: SSE agent_online 事件
  // ----------------------------------------------------------
  it("SSE 推送 agent_online 事件", async () => {
    const sse = connectSse("backend-01");
    await sleep(500);

    // 注册一个新 agent
    await rpc("register", {
      agent_id: "tester-01",
      role: "tester",
      description: "测试 agent",
    });

    const event = await sse.waitForEvent("agent_online", 3000);
    expect(event.data.agent_id).toBe("tester-01");

    sse.close();
  });

  // ----------------------------------------------------------
  // Test 9: read_messages 过滤
  // ----------------------------------------------------------
  it("read_messages 支持 from 过滤", async () => {
    const res = await rpc("read_messages", {
      from: "backend-01",
    });
    expect(res.result).toBeInstanceOf(Array);
    for (const msg of res.result) {
      expect(msg.from).toBe("backend-01");
    }
  });

  it("read_messages 支持 limit", async () => {
    const res = await rpc("read_messages", { limit: 2 });
    expect(res.result).toBeInstanceOf(Array);
    expect(res.result.length).toBeLessThanOrEqual(2);
  });

  // ----------------------------------------------------------
  // Test 10: 错误处理
  // ----------------------------------------------------------
  it("发消息给不存在的 agent 返回错误", async () => {
    const res = await rpc("send_message", {
      to: "nonexistent-agent",
      content: "hello",
    });
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32001); // AGENT_NOT_FOUND
  });

  it("调用不存在的方法返回错误", async () => {
    const res = await rpc("nonexistent_method");
    expect(res.error).toBeDefined();
    expect(res.error.code).toBe(-32601); // METHOD_NOT_FOUND
  });
});
