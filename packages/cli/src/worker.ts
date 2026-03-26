/**
 * `agent-bridge worker` — Autonomous agent that stays online and processes messages
 *
 * Lifecycle:
 *   1. Connect to Hub (SSE heartbeat)
 *   2. Register → online in registry
 *   3. Wait for messages (standby)
 *   4. Message arrives → queue → process with Claude Code → send result back
 *   5. Back to standby
 *   6. SSE drops → auto-reconnect + re-register → resume
 *   7. Ctrl+C → graceful shutdown
 */

import { spawn } from "node:child_process";
import os from "node:os";
import { bold, box, cyan, dim, green, yellow, red } from "./ui.js";
import { parseArgs } from "./args.js";

interface WorkerOptions {
  hubUrl: string;
  token: string;
  agentId: string;
  role: string;
  description: string;
  systemPrompt?: string;
}

interface IncomingMessage {
  id: number;
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

export async function startWorker(argv: string[]) {
  const opts = parseArgs(argv, {
    token: "string",
    id: "string",
    role: "string",
    desc: "string",
    prompt: "string",
  });

  // --- Parse args ---
  const hubUrl = (opts._[0] || "").replace(/\/+$/, "") || "";
  if (!hubUrl) {
    console.log(`  ${red("Usage:")} npx agent-bridge worker <hub-url> --token <token>`);
    process.exit(1);
  }

  const token = opts.token || "";
  if (!token) {
    console.log(`  ${red("Token is required.")} Use --token <token>`);
    process.exit(1);
  }

  const hostname = os.hostname().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
  const agentId = opts.id || `${hostname}-worker`;
  const role = opts.role || "worker";
  const description = opts.desc || `${hostname} autonomous worker (${role})`;
  const systemPrompt = opts.prompt || "";

  const config: WorkerOptions = {
    hubUrl: hubUrl.startsWith("http") ? hubUrl : `http://${hubUrl}`,
    token,
    agentId,
    role,
    description,
    systemPrompt,
  };

  // --- Verify Hub ---
  console.log(`  ${dim("Connecting to hub...")}`);

  try {
    const res = await rpc(config, "list_agents");
    const agents = (res as any[]) || [];
    console.log(`  ${green("Connected!")} ${dim(`${agents.length} agent(s) online`)}`);
  } catch (err: any) {
    console.log(`  ${red("Failed:")} ${err.message}`);
    process.exit(1);
  }

  // --- Register ---
  await registerAgent(config);

  // --- Banner ---
  console.log();
  console.log(
    box(
      [
        `${dim("Agent ID:")}  ${green(config.agentId)}`,
        `${dim("Role:")}      ${green(config.role)}`,
        `${dim("Hub:")}       ${green(config.hubUrl)}`,
        `${dim("Mode:")}      ${green("autonomous worker")}`,
        ``,
        `${bold("Standby — waiting for messages...")}`,
        `${dim("Messages will be processed by Claude Code automatically.")}`,
      ],
      { title: "Worker is running" }
    )
  );
  console.log();

  // --- Message queue (ordered processing, no drops) ---
  const messageQueue: IncomingMessage[] = [];
  let processing = false;
  let lastMessageId = 0;
  let shuttingDown = false;

  async function processQueue() {
    if (processing || messageQueue.length === 0 || shuttingDown) return;
    processing = true;

    while (messageQueue.length > 0 && !shuttingDown) {
      const msg = messageQueue.shift()!;
      const now = new Date().toLocaleTimeString();
      const preview = msg.content.slice(0, 100) + (msg.content.length > 100 ? "..." : "");
      console.log(`  ${dim(now)}  ${cyan("←")} ${bold(msg.from)}: ${preview}`);

      try {
        const result = await executeWithClaude(config, msg.from, msg.content);
        const trimmed = result.slice(0, 4000);

        await rpc(config, "send_message", {
          to: msg.from,
          content: trimmed,
        });

        const doneTime = new Date().toLocaleTimeString();
        const resultPreview = trimmed.slice(0, 100) + (trimmed.length > 100 ? "..." : "");
        console.log(`  ${dim(doneTime)}  ${green("→")} ${bold(msg.from)}: ${resultPreview}`);
      } catch (err: any) {
        const errTime = new Date().toLocaleTimeString();
        console.log(`  ${dim(errTime)}  ${red("✗")} Error: ${err.message}`);

        try {
          await rpc(config, "send_message", {
            to: msg.from,
            content: `[Worker Error] ${err.message}`,
          });
        } catch {
          // ignore send error
        }
      }
    }

    processing = false;
  }

  // --- Graceful shutdown ---
  process.on("SIGINT", () => {
    console.log(`\n  ${dim("Shutting down worker...")}`);
    shuttingDown = true;
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    shuttingDown = true;
    process.exit(0);
  });

  // --- SSE loop (heartbeat + message listener) ---
  await connectSse(config, async (event, data) => {
    if (event === "message") {
      const msg = data as IncomingMessage;

      // Skip messages from self
      if (msg.from === config.agentId) return;

      // Skip already seen (deduplication)
      if (msg.id <= lastMessageId) return;
      lastMessageId = msg.id;

      // Queue and process
      messageQueue.push(msg);
      processQueue();
    }

    if (event === "agent_online") {
      const info = data as { agent_id: string; role: string };
      if (info.agent_id !== config.agentId) {
        const now = new Date().toLocaleTimeString();
        console.log(`  ${dim(now)}  ${green("+")} ${bold(info.agent_id)} joined ${dim(`(${info.role})`)}`);
      }
    }

    if (event === "agent_offline") {
      const info = data as { agent_id: string };
      const now = new Date().toLocaleTimeString();
      console.log(`  ${dim(now)}  ${yellow("-")} ${bold(info.agent_id)} disconnected`);
    }
  });
}

// --- Register with Hub ---

async function registerAgent(config: WorkerOptions) {
  try {
    await rpc(config, "register", {
      agent_id: config.agentId,
      role: config.role,
      description: config.description,
    });
  } catch (err: any) {
    // If duplicate registration, that's fine (we're reconnecting)
    if (!err.message.includes("already registered")) {
      console.log(`  ${red("Register failed:")} ${err.message}`);
      process.exit(1);
    }
  }
}

// --- Call Claude Code in headless mode ---

function executeWithClaude(config: WorkerOptions, fromAgent: string, messageContent: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const prompt = config.systemPrompt
      ? `${config.systemPrompt}\n\nYou received a message from agent "${fromAgent}":\n\n${messageContent}\n\nProcess this request and respond.`
      : `You are an autonomous worker agent (${config.role}). You received a message from agent "${fromAgent}":\n\n${messageContent}\n\nProcess this request and respond concisely.`;

    const child = spawn(
      "claude",
      ["-p", "--dangerously-skip-permissions"],
      {
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude timed out after 5 minutes"));
    }, 300_000);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(err.message));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout.trim() || "(no output)");
    });

    // Feed prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// --- Hub RPC ---

async function rpc(config: WorkerOptions, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${config.hubUrl}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: String(Date.now()),
      method,
      params: { ...params, agent_id: config.agentId },
    }),
  });

  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
  return body.result;
}

// --- SSE connection with auto-reconnect + re-register ---

type SseCallback = (event: string, data: unknown) => void;

async function connectSse(config: WorkerOptions, callback: SseCallback): Promise<never> {
  let retryDelay = 1000;
  const maxRetry = 30000;
  let firstConnect = true;

  while (true) {
    try {
      const res = await fetch(`${config.hubUrl}/events?agent_id=${config.agentId}`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });

      if (!res.ok || !res.body) throw new Error(`SSE: ${res.status}`);

      retryDelay = 1000;

      // Re-register on reconnect (SSE close = Hub marks us offline)
      if (!firstConnect) {
        console.log(`  ${dim(new Date().toLocaleTimeString())}  ${green("SSE reconnected, re-registering...")}`);
        await registerAgent(config);
      }
      firstConnect = false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              callback(currentEvent, data);
            } catch {
              // ignore parse errors
            }
            currentEvent = "message";
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") break;
      console.log(`  ${dim(`SSE reconnecting in ${retryDelay / 1000}s...`)}`);
      await new Promise((r) => setTimeout(r, retryDelay));
      retryDelay = Math.min(retryDelay * 2, maxRetry);
    }
  }

  return undefined as never;
}
