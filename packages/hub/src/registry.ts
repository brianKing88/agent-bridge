import { EventEmitter } from "node:events";
import type { AgentId, AgentInfo, AgentRole } from "./types.js";

export interface RegisterOptions {
  agent_id: AgentId;
  role: AgentRole;
  description: string;
}

/**
 * Registry 管理 agent 的注册、发现、上下线状态。
 * 内存存储，MVP 不持久化。
 *
 * Events:
 *  - "agent_online"  (agentInfo: AgentInfo)
 *  - "agent_offline" (agentId: AgentId)
 */
export class Registry extends EventEmitter {
  private agents = new Map<AgentId, AgentInfo>();

  /** 注册一个 agent。如果已存在则更新并重新标记为 online。 */
  register(opts: RegisterOptions): AgentInfo {
    const existing = this.agents.get(opts.agent_id);
    if (existing && existing.status === "online") {
      // 已在线，更新信息
      existing.role = opts.role;
      existing.description = opts.description;
      return existing;
    }

    const info: AgentInfo = {
      agent_id: opts.agent_id,
      role: opts.role,
      description: opts.description,
      status: "online",
    };
    this.agents.set(opts.agent_id, info);
    this.emit("agent_online", info);
    return info;
  }

  /** 标记 agent 下线。 */
  unregister(agentId: AgentId): void {
    const info = this.agents.get(agentId);
    if (info) {
      info.status = "offline";
      this.emit("agent_offline", agentId);
    }
  }

  /** 获取单个 agent 信息。 */
  get(agentId: AgentId): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  /** 列出所有在线 agent。 */
  listOnline(): AgentInfo[] {
    return Array.from(this.agents.values()).filter((a) => a.status === "online");
  }

  /** 列出所有 agent（包括离线）。 */
  listAll(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  /** 检查 agent 是否在线。 */
  isOnline(agentId: AgentId): boolean {
    return this.agents.get(agentId)?.status === "online";
  }
}
