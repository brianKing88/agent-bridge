import type { IncomingMessage, ServerResponse } from "node:http";

const TOKEN = process.env.AGENT_BRIDGE_TOKEN ?? "";

/**
 * 从 Authorization header 提取 Bearer token。
 * 返回 token 字符串，或 null（无 header / 格式错误）。
 */
export function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
}

/**
 * 验证 token 是否有效。
 * 如果 AGENT_BRIDGE_TOKEN 未设置（空字符串），跳过验证。
 */
export function verifyToken(token: string | null): boolean {
  if (!TOKEN) return true; // 未配置 token，跳过验证
  return token === TOKEN;
}

/**
 * Express 中间件：校验 Bearer Token。
 * 失败返回 401。
 */
export function authMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): void {
  const token = extractToken(req);
  if (!verifyToken(token)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  next();
}
