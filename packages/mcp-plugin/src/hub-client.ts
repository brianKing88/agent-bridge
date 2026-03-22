/**
 * Hub Client — HTTP + SSE 客户端，连接 Relay Hub
 */

import type { Message, AgentId, SseEventMap, SseEventType } from "../../shared/src/types.js";

export interface HubClientOptions {
  hubUrl: string;
  token: string;
  agentId: AgentId;
}

type SseCallback = (event: SseEventType, data: unknown) => void;

export class HubClient {
  private hubUrl: string;
  private token: string;
  private agentId: AgentId;
  private sseController: AbortController | null = null;
  private listeners: SseCallback[] = [];
  private connected = false;

  constructor(options: HubClientOptions) {
    this.hubUrl = options.hubUrl.replace(/\/$/, "");
    this.token = options.token;
    this.agentId = options.agentId;
  }

  /** 发送 JSON-RPC 请求到 Hub */
  async rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.hubUrl}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: String(Date.now()),
        method,
        params: { ...params, agent_id: this.agentId },
      }),
    });

    const body = await res.json() as { result?: T; error?: { code: number; message: string } };

    if (body.error) {
      throw new Error(`RPC error ${body.error.code}: ${body.error.message}`);
    }

    return body.result as T;
  }

  /** 注册 SSE 事件监听器 */
  onEvent(callback: SseCallback) {
    this.listeners.push(callback);
  }

  /** 启动 SSE 连接 */
  async connectSse(): Promise<void> {
    if (this.connected) return;

    this.sseController = new AbortController();
    this.connected = true;

    this.runSseLoop().catch(() => {
      this.connected = false;
    });
  }

  private async runSseLoop() {
    let retryDelay = 1000;
    const maxRetry = 30000;

    while (this.connected) {
      try {
        const res = await fetch(`${this.hubUrl}/events?agent_id=${this.agentId}`, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: this.sseController!.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`);
        }

        retryDelay = 1000; // reset on successful connect
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent: SseEventType = "message";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim() as SseEventType;
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                for (const cb of this.listeners) {
                  cb(currentEvent, data);
                }
              } catch {
                // ignore parse errors
              }
              currentEvent = "message";
            }
            // ignore comments (: heartbeat) and empty lines
          }
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") break;
        // exponential backoff
        await new Promise((r) => setTimeout(r, retryDelay));
        retryDelay = Math.min(retryDelay * 2, maxRetry);
      }
    }
  }

  /** 断开 SSE */
  disconnect() {
    this.connected = false;
    this.sseController?.abort();
    this.sseController = null;
  }

  get isConnected() {
    return this.connected;
  }
}
