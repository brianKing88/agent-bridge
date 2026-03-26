/**
 * `agent-bridge hub` — Start the relay hub
 */

import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import os from "node:os";
import { createHub } from "../../hub/src/server.js";
import { bold, box, cyan, dim, green, yellow } from "./ui.js";
import { parseArgs } from "./args.js";
import { configureMcp, ensureClaudeMdHint } from "./configure-mcp.js";

export async function startHub(argv: string[]) {
  const opts = parseArgs(argv, {
    port: "number",
    token: "string",
  });

  const port = opts.port ?? parseInt(process.env.AGENT_BRIDGE_PORT ?? "9900", 10);
  const token = opts.token ?? process.env.AGENT_BRIDGE_TOKEN ?? randomUUID().slice(0, 12);

  process.env.AGENT_BRIDGE_TOKEN = token;

  const ip = getLocalIp();
  const hubUrl = `http://${ip}:${port}`;

  console.log(`  ${dim("Starting hub...")}`);
  console.log();

  const hub = createHub({ port });

  return new Promise<void>((resolve) => {
    hub.server.listen(port, () => {
      // Pretty startup banner
      console.log(
        box(
          [
            `${dim("Hub URL:")}    ${green(hubUrl)}`,
            `${dim("Token:")}      ${green(token)}`,
            `${dim("Dashboard:")}  ${cyan(hubUrl)}`,
            ``,
            `${bold("Share this with your team to join:")}`,
            ``,
            `${cyan(`npx agent-bridge join ${hubUrl} --token ${token}`)}`,
          ],
          { title: "Hub is running" }
        )
      );
      console.log();

      // --- Auto-configure this machine's Claude Code ---
      const hostname = os.hostname().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
      const agentId = `${hostname}-hub`;

      console.log(`  ${dim("Configuring local Claude Code MCP plugin...")}`);
      configureMcp({
        hubUrl,
        token,
        agentId,
        role: "hub",
        description: `${hostname} (hub operator)`,
        scope: "project",
      });
      ensureClaudeMdHint();

      console.log();
      console.log(`  ${dim("Waiting for agents to connect... (Ctrl+C to stop)")}`);
      console.log();

      // Log agent connect/disconnect events via registry EventEmitter
      hub.registry.on("agent_online", (info: { agent_id: string; role: string }) => {
        const now = new Date().toLocaleTimeString();
        console.log(`  ${dim(now)}  ${green("+")} ${bold(info.agent_id)} joined ${dim(`(${info.role})`)}`);
      });

      hub.registry.on("agent_offline", (agentId: string) => {
        const now = new Date().toLocaleTimeString();
        console.log(`  ${dim(now)}  ${yellow("-")} ${bold(agentId)} disconnected`);
      });
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log(`\n  ${dim("Shutting down...")}`);
      hub.stop();
      resolve();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      hub.stop();
      resolve();
      process.exit(0);
    });
  });
}

function getLocalIp(): string {
  const nets = networkInterfaces();
  // Prefer Tailscale interface
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal && name.startsWith("utun")) {
        // Tailscale typically uses 100.x.x.x
        if (addr.address.startsWith("100.")) return addr.address;
      }
    }
  }
  // Fallback: first non-internal IPv4
  for (const addrs of Object.values(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "0.0.0.0";
}
