// ============================================================
// Agent Bridge — Shared Types (MVP)
// 这是 Hub 和 Plugin 的共享契约，修改前需双方对齐。
// ============================================================

// ------------------------------------------------------------
// 基础类型
// ------------------------------------------------------------

/** Agent 唯一标识 */
export type AgentId = string;

/** 消息递增 ID */
export type MessageId = number;

/** ISO 8601 时间戳 */
export type Timestamp = string;

/** Agent 角色（MVP 不做权限区分，仅作标识） */
export type AgentRole = string;

// ------------------------------------------------------------
// Agent 信息
// ------------------------------------------------------------

export interface AgentInfo {
  agent_id: AgentId;
  role: AgentRole;
  description: string;
  status: "online" | "offline";
}

// ------------------------------------------------------------
// 消息结构
// ------------------------------------------------------------

export interface Message {
  id: MessageId;
  from: AgentId;
  to: AgentId | "*";       // "*" = 广播
  content: string;
  timestamp: Timestamp;
}

// ------------------------------------------------------------
// JSON-RPC 2.0 基础
// ------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// 标准 JSON-RPC 2.0 错误码
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // 应用层自定义错误码 (-32000 ~ -32099)
  UNAUTHORIZED: -32000,
  AGENT_NOT_FOUND: -32001,
  DUPLICATE_AGENT: -32002,
} as const;

// ------------------------------------------------------------
// RPC 方法：请求 params 和返回 result
// ------------------------------------------------------------

// --- register ---
export interface RegisterParams {
  agent_id: AgentId;
  role: AgentRole;
  description: string;
}

export interface RegisterResult {
  ok: true;
}

// --- list_agents ---
export type ListAgentsParams = Record<string, never>; // 无参数

export type ListAgentsResult = AgentInfo[];

// --- send_message ---
export interface SendMessageParams {
  to: AgentId | "*";
  content: string;
}

export interface SendMessageResult {
  id: MessageId;
  timestamp: Timestamp;
}

// --- read_messages ---
export interface ReadMessagesParams {
  since?: Timestamp;       // 只返回此时间之后的消息
  since_id?: MessageId;    // 只返回此 ID 之后的消息（比时间戳更精确，为 Phase 2 断点续传铺路）
  from?: AgentId;          // 只返回此 agent 发的消息
  limit?: number;          // 最多返回条数，默认 50
}

export type ReadMessagesResult = Message[];

// ------------------------------------------------------------
// RPC 方法名 → Params/Result 映射（方便类型推导）
// ------------------------------------------------------------

export interface RpcMethodMap {
  register: { params: RegisterParams; result: RegisterResult };
  list_agents: { params: ListAgentsParams; result: ListAgentsResult };
  send_message: { params: SendMessageParams; result: SendMessageResult };
  read_messages: { params: ReadMessagesParams; result: ReadMessagesResult };
}

export type RpcMethod = keyof RpcMethodMap;

// ------------------------------------------------------------
// SSE 事件
// ------------------------------------------------------------

export interface SseMessageEvent {
  id: MessageId;
  from: AgentId;
  to: AgentId | "*";
  content: string;
  timestamp: Timestamp;
}

export interface SseAgentOnlineEvent {
  agent_id: AgentId;
  role: AgentRole;
  description: string;
}

export interface SseAgentOfflineEvent {
  agent_id: AgentId;
}

export interface SseEventMap {
  message: SseMessageEvent;
  agent_online: SseAgentOnlineEvent;
  agent_offline: SseAgentOfflineEvent;
  // heartbeat 用 SSE comment (: heartbeat\n\n)，不走 event type
}

export type SseEventType = keyof SseEventMap;

// ------------------------------------------------------------
// HTTP 端点汇总（供参考）
// ------------------------------------------------------------
//
// POST /rpc           JSON-RPC 2.0 入口（需 Authorization: Bearer <token>）
// GET  /events        SSE 事件流（需 Authorization: Bearer <token>，query: agent_id）
//
// 认证：所有请求携带 Authorization: Bearer <AGENT_BRIDGE_TOKEN>
// Token 来源：环境变量 AGENT_BRIDGE_TOKEN（Hub 和 Plugin 共享同一个 token）
