import type { AgentId, Message, MessageId, Timestamp } from "./types.js";

export interface SendOptions {
  from: AgentId;
  to: AgentId | "*";
  content: string;
}

export interface QueryOptions {
  /** 目标 agent（收件人） */
  forAgent: AgentId;
  /** 只返回此时间之后的消息 */
  since?: Timestamp;
  /** 只返回此 ID 之后的消息 */
  since_id?: MessageId;
  /** 只返回此发送者的消息 */
  from?: AgentId;
  /** 最多返回条数 */
  limit?: number;
}

/** 消息发送回调，用于通知 SSE 推送 */
export type OnMessageCallback = (msg: Message) => void;

/**
 * MessageBus 负责消息路由和内存存储。
 * MVP 不持久化，重启即丢。
 */
export class MessageBus {
  private messages: Message[] = [];
  private nextId: MessageId = 1;
  private listeners: OnMessageCallback[] = [];

  /** 注册消息监听器（SSE 推送用） */
  onMessage(cb: OnMessageCallback): void {
    this.listeners.push(cb);
  }

  /** 发送一条消息，存入内存，通知监听器 */
  send(opts: SendOptions): Message {
    const msg: Message = {
      id: this.nextId++,
      from: opts.from,
      to: opts.to,
      content: opts.content,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);

    // 通知所有监听器
    for (const cb of this.listeners) {
      try {
        cb(msg);
      } catch {
        // 监听器错误不影响消息发送
      }
    }

    return msg;
  }

  /** 查询某个 agent 的消息（发给它的 + 广播的） */
  query(opts: QueryOptions): Message[] {
    const limit = opts.limit ?? 50;
    let results = this.messages.filter((msg) => {
      // 只返回发给该 agent 或广播的消息
      if (msg.to !== opts.forAgent && msg.to !== "*") return false;

      // since_id 过滤
      if (opts.since_id !== undefined && msg.id <= opts.since_id) return false;

      // since 时间过滤
      if (opts.since && msg.timestamp <= opts.since) return false;

      // from 过滤
      if (opts.from && msg.from !== opts.from) return false;

      return true;
    });

    // 取最后 limit 条
    if (results.length > limit) {
      results = results.slice(-limit);
    }

    return results;
  }

  /** 获取当前最大消息 ID */
  getLastId(): MessageId {
    return this.nextId - 1;
  }
}
