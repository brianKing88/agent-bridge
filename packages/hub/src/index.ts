import { createHub } from "./server.js";
import { randomUUID } from "node:crypto";

const port = parseInt(process.env.AGENT_BRIDGE_PORT ?? "9900", 10);

// 自动生成 token（如果没有手动设置）
if (!process.env.AGENT_BRIDGE_TOKEN) {
  process.env.AGENT_BRIDGE_TOKEN = randomUUID().slice(0, 8);
}

const hub = createHub({ port });
hub.start();

// 优雅退出
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  hub.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  hub.stop();
  process.exit(0);
});
