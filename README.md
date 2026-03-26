# Agent Bridge

> Let Claude Code agents on different machines talk to each other.

```
Machine A                              Machine B
┌──────────────┐                      ┌──────────────┐
│  Claude Code  │  ── messages ──►   │  Claude Code  │
│  (backend)    │  ◄── messages ──   │  (frontend)   │
└──────┬───────┘                      └──────┬───────┘
       │           ┌──────────┐              │
       └──────────►│   Hub    │◄─────────────┘
                   │ (relay)  │
                   └──────────┘
```

## Quick Start — 2 minutes

### Step 1: Start a Hub (Person A)

```bash
git clone https://github.com/brianKing88/agent-bridge.git
cd agent-bridge && pnpm install
npx agent-bridge hub
```

Hub prints a **join command** — copy it, send to teammates:

```
npx agent-bridge join http://192.168.1.10:9900 --token 3a20f7eb
```

### Step 2: Join (Person B)

Paste the command from Person A:

```bash
npx agent-bridge join http://192.168.1.10:9900 --token 3a20f7eb
```

Answer 2-3 prompts (agent ID, role), then restart Claude Code.

### Step 3: Use

Two modes — pick the one that fits:

#### Mode A: Human-in-the-loop (interactive collaboration)

In Claude Code, say:

```
"连接 bridge，我要和前端联调"
```

Claude calls `connect` → you're online. Then:

```
"告诉前端同学 /api/auth 接口好了，参数是 { email, password }"
"看看有没有新消息"
"广播给所有人：数据库今晚维护"
```

Other terminals on the same machine are **not affected** — only the one that says "connect" joins the bridge.

#### Mode B: Autonomous worker (no human needed)

```bash
npx agent-bridge worker http://192.168.1.10:9900 --token 3a20f7eb --role backend
```

Worker stays online, automatically:
1. Receives messages via SSE heartbeat
2. Feeds them to Claude Code (headless)
3. Sends results back to the sender
4. Returns to standby

Two workers can have a full conversation without any human:

```
A worker → "POST /api/login returns 500, here's the error log"
B worker → reads code, finds bug, fixes it, replies "Fixed, retry now"
A worker → retries, confirms "200 OK, login flow works ✅"
```

## How It Works

```
┌─────────────────────────────────────────────────┐
│  Agent Lifecycle                                 │
│                                                  │
│  Start → Register → Heartbeat (SSE) → Standby   │
│                                          │       │
│                                     Message in   │
│                                          │       │
│                                          ▼       │
│                                   Process + Reply │
│                                          │       │
│                                          ▼       │
│                                     Standby ←─┘  │
│                                                  │
│  Heartbeat lost → Hub marks offline              │
└─────────────────────────────────────────────────┘
```

**Hub** = the relay server. Keeps a registry of who's online, routes messages.

**SSE** = the heartbeat. Connection alive = agent online. Connection drops = agent offline.

**Messages** are stored on Hub. If B connects later, they can still read history.

## CLI Commands

| Command | What it does |
|---------|-------------|
| `npx agent-bridge hub` | Start a Hub (relay server + dashboard) |
| `npx agent-bridge join <url> --token <t>` | Join a Hub (configures Claude Code MCP) |
| `npx agent-bridge worker <url> --token <t>` | Start an autonomous worker |

## MCP Tools (available in Claude Code after `join`)

| Tool | When | Description |
|------|------|-------------|
| `connect` | Before collaboration | Connect to Hub (default: disconnected) |
| `send_message` | After connected | Send to an agent or `"*"` to broadcast |
| `read_messages` | After connected | Read inbox |
| `list_agents` | After connected | See who's online |
| `disconnect` | Done collaborating | Disconnect from Hub |

## Dashboard

Open the Hub URL in a browser (e.g. `http://192.168.1.10:9900`) to see:
- All online agents
- Real-time message log
- No authentication needed (read-only)

## Architecture

**Transport**: HTTP + JSON-RPC 2.0 + SSE

**Two channels**:
- `POST /rpc` — Agent → Hub (send messages, register, query)
- `GET /events` — Hub → Agent (SSE push: messages, online/offline events)

**Auth**: Shared token via `Authorization: Bearer` header

**Storage**: In-memory (MVP)

## Project Structure

```
agent-bridge/
├── packages/
│   ├── cli/              # CLI (hub/join/worker commands)
│   ├── hub/              # Relay Hub (HTTP server)
│   ├── mcp-plugin/       # MCP Plugin (stdio, lazy-connect)
│   └── shared/           # Shared types
├── tests/
│   └── e2e.test.ts
└── docs/
    └── USER-JOURNEY.md   # Full scenario walkthrough
```

## Tested

- macOS (Apple Silicon) ↔ Linux (aarch64, OrangePi) over Tailscale
- 2 agents, 5+ rounds of conversation, < 10ms latency on LAN

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Core messaging (RPC + SSE) | Done |
| 1.5 | Worker mode (autonomous agents) | Done |
| 2 | Reliability (EventStore, reconnect, idempotency) | Planned |
| 3 | Contract negotiation (structured API agreements) | Planned |
| 4 | Auto network discovery (mDNS/Bonjour) | Planned |

## License

MIT
