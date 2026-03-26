/**
 * System notification — 当 SSE 收到消息时通知人类
 *
 * macOS: 使用 osascript 弹系统通知
 * Linux: 使用 notify-send
 * Fallback: stderr 输出（终端可见）
 */

import { execFile } from "node:child_process";
import type { Message } from "../../shared/src/types.js";

export function notifyUser(msg: Message) {
  const title = `Agent Bridge`;
  const body = `${msg.from}: ${msg.content.slice(0, 200)}`;

  if (process.platform === "darwin") {
    // macOS native notification
    execFile("osascript", [
      "-e",
      `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`,
    ], (err) => {
      // ignore errors silently
    });
  } else if (process.platform === "linux") {
    // Linux (requires notify-send / libnotify)
    execFile("notify-send", [title, body], (err) => {
      // ignore errors silently
    });
  }

  // Always write to stderr as fallback (visible in Claude Code MCP logs)
  process.stderr.write(`\n📬 [${msg.from}] ${msg.content.slice(0, 100)}\n`);
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
