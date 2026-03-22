import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  RPC_ERRORS,
} from "./types.js";
import { RPC_ERRORS as ERRORS } from "./types.js";

// Handler 函数签名：接收 params + 调用者 agentId，返回 result
export type RpcHandler = (
  params: Record<string, unknown>,
  agentId: string
) => Promise<unknown> | unknown;

export class RpcDispatcher {
  private handlers = new Map<string, RpcHandler>();

  /** 注册一个 RPC 方法的 handler */
  register(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  /** 处理一个 JSON-RPC 请求，返回响应 */
  async handle(body: unknown, agentId: string): Promise<JsonRpcResponse> {
    // 解析请求
    const req = this.parseRequest(body);
    if ("error" in req) return req;

    // 查找 handler
    const handler = this.handlers.get(req.method);
    if (!handler) {
      return this.errorResponse(req.id, ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
    }

    // 执行 handler
    try {
      const result = await handler(req.params ?? {}, agentId);
      return this.successResponse(req.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as any)?.code ?? ERRORS.INTERNAL_ERROR;
      return this.errorResponse(req.id, code, message);
    }
  }

  private parseRequest(body: unknown): JsonRpcRequest | JsonRpcErrorResponse {
    if (!body || typeof body !== "object") {
      return this.errorResponse("0", ERRORS.PARSE_ERROR, "Parse error: invalid JSON");
    }

    const obj = body as Record<string, unknown>;

    if (obj.jsonrpc !== "2.0") {
      return this.errorResponse(
        String(obj.id ?? "0"),
        ERRORS.INVALID_REQUEST,
        "Invalid Request: missing jsonrpc 2.0"
      );
    }

    if (typeof obj.method !== "string") {
      return this.errorResponse(
        String(obj.id ?? "0"),
        ERRORS.INVALID_REQUEST,
        "Invalid Request: missing method"
      );
    }

    if (typeof obj.id !== "string" && typeof obj.id !== "number") {
      return this.errorResponse("0", ERRORS.INVALID_REQUEST, "Invalid Request: missing id");
    }

    return {
      jsonrpc: "2.0",
      id: String(obj.id),
      method: obj.method,
      params: (obj.params as Record<string, unknown>) ?? {},
    };
  }

  private successResponse(id: string, result: unknown): JsonRpcSuccessResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private errorResponse(id: string, code: number, message: string): JsonRpcErrorResponse {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}
