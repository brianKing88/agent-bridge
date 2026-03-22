import { createHub } from "./server.js";

const port = parseInt(process.env.AGENT_BRIDGE_PORT ?? "9900", 10);

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
