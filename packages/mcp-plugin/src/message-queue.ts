/**
 * Message Queue — SSE 推送的消息缓存在本地，agent 通过 read_messages 拉取
 */

import type { Message, AgentId, MessageId, Timestamp } from "../../shared/src/types.js";

export class MessageQueue {
  private messages: Message[] = [];
  private maxSize = 500;

  /** SSE 收到消息时入队 */
  push(msg: Message) {
    this.messages.push(msg);
    // 防止内存无限增长
    if (this.messages.length > this.maxSize) {
      this.messages = this.messages.slice(-this.maxSize);
    }
  }

  /** agent 调用 read_messages 时读取 */
  read(options: {
    since_id?: MessageId;
    since?: Timestamp;
    from?: AgentId;
    limit?: number;
  } = {}): Message[] {
    let result = this.messages;

    if (options.since_id !== undefined) {
      result = result.filter((m) => m.id > options.since_id!);
    }

    if (options.since) {
      const sinceTime = new Date(options.since).getTime();
      result = result.filter((m) => new Date(m.timestamp).getTime() > sinceTime);
    }

    if (options.from) {
      result = result.filter((m) => m.from === options.from);
    }

    const limit = options.limit ?? 50;
    return result.slice(-limit);
  }

  get length() {
    return this.messages.length;
  }
}
