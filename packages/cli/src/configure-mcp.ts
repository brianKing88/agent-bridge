/**
 * Shared MCP configuration logic — used by both `hub` and `join` commands
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dim, green, yellow } from "./ui.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface McpConfigOptions {
  hubUrl: string;
  token: string;
  agentId: string;
  role: string;
  description?: string;
  scope: "project" | "user";
}

/**
 * Configure Claude Code MCP plugin for agent-bridge.
 * Returns true if successful, false otherwise.
 */
export function configureMcp(opts: McpConfigOptions): boolean {
  const pluginEntry = resolve(__dirname, "../../mcp-plugin/src/index.ts");
  const scopeFlag = opts.scope === "user" ? "--scope user" : "--scope project";

  const envFlags = [
    `-e AGENT_BRIDGE_HUB=${opts.hubUrl}`,
    `-e AGENT_BRIDGE_TOKEN=${opts.token}`,
    `-e AGENT_BRIDGE_AGENT_ID=${opts.agentId}`,
    `-e AGENT_BRIDGE_ROLE=${opts.role}`,
    opts.description ? `-e AGENT_BRIDGE_DESC="${opts.description}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cmd = `claude mcp add agent-bridge ${scopeFlag} ${envFlags} -- npx tsx ${pluginEntry}`;

  try {
    execSync(cmd, { stdio: "pipe" });
    console.log(`  ${green("✓")} MCP plugin configured.`);
    return true;
  } catch {
    console.log(`  ${yellow("Could not auto-configure.")} Run this manually:`);
    console.log();
    console.log(`  ${dim(cmd)}`);
    console.log();
    return false;
  }
}

/**
 * Ensure CLAUDE.md contains agent-bridge instructions.
 */
export function ensureClaudeMdHint(): void {
  const claudeMdPath = resolve(process.cwd(), "CLAUDE.md");

  try {
    if (existsSync(claudeMdPath)) {
      const content = readFileSync(claudeMdPath, "utf-8");
      if (content.includes(CLAUDE_MD_MARKER)) return;
      writeFileSync(claudeMdPath, content + "\n\n" + CLAUDE_MD_SNIPPET + "\n");
    } else {
      writeFileSync(claudeMdPath, CLAUDE_MD_SNIPPET + "\n");
    }
    console.log(`  ${dim("Added Agent Bridge instructions to CLAUDE.md")}`);
  } catch {
    // Not critical, skip silently
  }
}

const CLAUDE_MD_MARKER = "<!-- agent-bridge -->";
const CLAUDE_MD_SNIPPET = `${CLAUDE_MD_MARKER}
## Agent Bridge

This project has Agent Bridge configured for cross-machine agent collaboration.

- The plugin starts **disconnected** by default. It does NOT auto-connect.
- When the user asks to collaborate with other agents (e.g. "连接 bridge", "和前端联调", "connect to the hub"), call \`connect\` to join.
- Once connected, call \`read_messages\` to check inbox, \`list_agents\` to see who's online, \`send_message\` to communicate.
- If the user doesn't mention collaboration, do NOT call \`connect\`. Just work normally.
${CLAUDE_MD_MARKER}`;
