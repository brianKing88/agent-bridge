import type { ServerResponse } from "node:http";
import type { AgentId, SseEventMap, SseEventType } from "./types.js";

interface SseConnection {
  agentId: AgentId;
  res: ServerResponse;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const HEARTBEAT_INTERVAL = 15_000; // 15 秒

/**
 * SSE 连接管理器。
 * 维护每个 agent 的 SSE 连接，推送事件，发心跳。
 */
export class SseManager {
  private connections = new Map<AgentId, SseConnection>();

  /** 建立 SSE 连接 */
  connect(agentId: AgentId, res: ServerResponse): void {
    // 如果已有连接，先关闭旧的
    this.disconnect(agentId);

    // 设置 SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 禁用 nginx 缓冲
    });

    // 发送初始 comment，确认连接
    res.write(": connected\n\n");

    // 心跳定时器
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": heartbeat\n\n");
      }
    }, HEARTBEAT_INTERVAL);

    const conn: SseConnection = { agentId, res, heartbeatTimer };
    this.connections.set(agentId, conn);

    // 连接断开时清理
    res.on("close", () => {
      this.disconnect(agentId);
    });
  }

  /** 断开 SSE 连接 */
  disconnect(agentId: AgentId): void {
    const conn = this.connections.get(agentId);
    if (conn) {
      clearInterval(conn.heartbeatTimer);
      if (!conn.res.writableEnded) {
        conn.res.end();
      }
      this.connections.delete(agentId);
    }
  }

  /** 向指定 agent 发送 SSE 事件 */
  sendTo<T extends SseEventType>(agentId: AgentId, event: T, data: SseEventMap[T]): boolean {
    const conn = this.connections.get(agentId);
    if (!conn || conn.res.writableEnded) return false;

    conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  /** 向所有连接的 agent 广播（可选排除某个 agent） */
  broadcast<T extends SseEventType>(
    event: T,
    data: SseEventMap[T],
    excludeAgent?: AgentId
  ): void {
    for (const [agentId, conn] of this.connections) {
      if (agentId === excludeAgent) continue;
      if (!conn.res.writableEnded) {
        conn.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    }
  }

  /** 检查 agent 是否有活跃的 SSE 连接 */
  isConnected(agentId: AgentId): boolean {
    const conn = this.connections.get(agentId);
    return !!conn && !conn.res.writableEnded;
  }

  /** 获取所有已连接的 agent ID */
  getConnectedAgents(): AgentId[] {
    return Array.from(this.connections.keys());
  }

  /** 关闭所有连接 */
  disconnectAll(): void {
    for (const agentId of this.connections.keys()) {
      this.disconnect(agentId);
    }
  }
}
