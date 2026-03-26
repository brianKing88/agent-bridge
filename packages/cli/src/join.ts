/**
 * `agent-bridge join` — Join a hub and configure Claude Code MCP
 */

import os from "node:os";
import { bold, box, cyan, dim, green, red } from "./ui.js";
import { prompt } from "./prompt.js";
import { parseArgs } from "./args.js";
import { configureMcp, ensureClaudeMdHint } from "./configure-mcp.js";

export async function joinHub(argv: string[]) {
  const opts = parseArgs(argv, {
    token: "string",
    id: "string",
    role: "string",
    desc: "string",
    scope: "string",
  });

  // --- Step 1: Hub URL ---
  let hubUrl = opts._[0] || "";
  if (!hubUrl) {
    hubUrl = await prompt(`  ${cyan("?")} Hub URL ${dim("(from the hub operator)")}: `);
    if (!hubUrl) {
      console.log(`  ${red("Hub URL is required.")}`);
      process.exit(1);
    }
  }
  // Normalize URL
  hubUrl = hubUrl.replace(/\/+$/, "");
  if (!hubUrl.startsWith("http")) hubUrl = `http://${hubUrl}`;

  // --- Step 2: Token ---
  let token = opts.token || "";
  if (!token) {
    token = await prompt(`  ${cyan("?")} Token ${dim("(from the hub operator)")}: `);
    if (!token) {
      console.log(`  ${red("Token is required.")}`);
      process.exit(1);
    }
  }

  // --- Step 3: Verify connection ---
  console.log();
  console.log(`  ${dim("Connecting to hub...")}`);

  try {
    const res = await fetch(`${hubUrl}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ping",
        method: "list_agents",
        params: {},
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    if (data.error) throw new Error(data.error.message);

    const agentCount = (data.result?.agents ?? []).length;
    console.log(`  ${green("Connected!")} ${dim(`${agentCount} agent(s) currently online`)}`);
  } catch (err: any) {
    console.log(`  ${red("Failed to connect:")} ${err.message}`);
    console.log(`  ${dim("Check that the hub is running and the URL/token are correct.")}`);
    process.exit(1);
  }

  // --- Step 4: Agent identity ---
  console.log();
  const hostname = os.hostname().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
  const defaultId = opts.id || hostname;
  const defaultRole = opts.role || "member";

  const agentId = await prompt(
    `  ${cyan("?")} Agent ID ${dim(`[${defaultId}]`)}: `,
    defaultId
  );
  const role = await prompt(
    `  ${cyan("?")} Role ${dim(`[${defaultRole}]`)}: `,
    defaultRole
  );
  const description = opts.desc || await prompt(
    `  ${cyan("?")} Description ${dim(`(optional, what this agent does)`)}: `
  );

  // --- Step 5: Scope selection ---
  console.log();
  const scopeInput = opts.scope || await prompt(
    `  ${cyan("?")} Configure for:\n\n` +
    `    ${cyan("1)")} This project only ${dim("(recommended for team projects)")}\n` +
    `    ${cyan("2)")} All projects      ${dim("(global, this machine always joins)")}\n\n` +
    `  Enter choice ${dim("[1/2]")}: `,
    "1"
  );

  const scope = scopeInput.trim() === "2" ? "user" as const : "project" as const;

  // --- Step 6: Configure Claude Code MCP ---
  console.log();
  console.log(`  ${dim("Configuring Claude Code MCP plugin...")}`);

  const ok = configureMcp({ hubUrl, token, agentId, role, description, scope });
  if (!ok) return;

  // --- Step 7: Add CLAUDE.md hint ---
  ensureClaudeMdHint();

  // --- Step 8: Success ---
  console.log();
  console.log(
    box(
      [
        `${dim("Agent ID:")}  ${green(agentId)}`,
        `${dim("Role:")}      ${green(role)}`,
        `${dim("Hub:")}       ${green(hubUrl)}`,
        ``,
        `${bold("Next steps:")}`,
        ``,
        `  1. Restart Claude Code ${dim("(or open a new session)")}`,
        `  2. Say: ${cyan('"连接 bridge"')} or ${cyan('"connect to the hub"')}`,
        `  3. Start collaborating!`,
      ],
      { title: "Ready to go" }
    )
  );
  console.log();
}
