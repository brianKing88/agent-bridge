# Agent Bridge

> Cross-server multi-agent collaboration for Claude Code.

Two Claude Code agents on different machines, talking to each other like real developers doing integration testing — no human relay needed.

```
Machine A (Drone)                    Machine B (Web Dev)
┌──────────────┐                    ┌──────────────┐
│  Claude Code  │                    │  Claude Code  │
│  (backend)    │                    │  (frontend)   │
│       │       │                    │       │       │
│  MCP Plugin   │   POST /rpc →     │  MCP Plugin   │
│  send_message │──────────────────►│  read_messages │
│  read_messages│◄── SSE /events ───│  send_message  │
└──────────────┘                    └──────────────┘
                    Relay Hub
                  (any reachable server)
```

## Why

Claude Code Agent Teams works great — **on a single machine**. But when your backend agent runs on a drone's mission computer and your frontend agent runs on your Mac, they can't talk to each other. You become the human relay, copy-pasting between terminals.

Agent Bridge fixes this. One Hub, two Plugins, agents talk directly.

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/brianKing88/agent-bridge.git
cd agent-bridge
pnpm install
```

### 2. Start the Hub

On any reachable machine (server, cloud VM, or one of the dev machines):

```bash
export AGENT_BRIDGE_TOKEN=my-secret-token
cd packages/hub
npx tsx src/index.ts

# Output:
# Agent Bridge Hub running on http://0.0.0.0:9900
# Token: my-secret-token
```

### 3. Add MCP Plugin to Claude Code

On each machine that needs an agent:

```bash
claude mcp add agent-bridge \
  -e AGENT_BRIDGE_HUB=http://<hub-ip>:9900 \
  -e AGENT_BRIDGE_TOKEN=my-secret-token \
  -e AGENT_BRIDGE_AGENT_ID=backend-01 \
  -e AGENT_BRIDGE_ROLE=backend \
  -e AGENT_BRIDGE_DESC="Backend API developer" \
  -- node /path/to/agent-bridge/packages/mcp-plugin/src/index.ts
```

### 4. Talk

In Claude Code, just say:

```
"Tell the frontend agent that /api/telemetry now returns a battery field"
```

Claude Code calls `send_message` → Hub routes it → frontend agent receives it.

## MCP Tools

| Tool | Description |
|------|-------------|
| `send_message` | Send a message to another agent (or `"*"` to broadcast) |
| `read_messages` | Read new messages from inbox |
| `list_agents` | See who's online |

## Architecture

**Transport**: HTTP + JSON-RPC 2.0 + SSE (aligned with [A2A](https://a2a-protocol.org/) and [MCP](https://modelcontextprotocol.io/) standards)

**Two channels**:
- `POST /rpc` — Agent → Hub (send messages, register, query)
- `GET /events` — Hub → Agent (SSE push: new messages, agent online/offline)

**Auth**: Shared token via `AGENT_BRIDGE_TOKEN` env var + `Authorization: Bearer` header

**Storage**: In-memory (MVP). No database required.

## API

### JSON-RPC Methods

```bash
# Register
curl -X POST http://hub:9900/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":"1","method":"register",
       "params":{"agent_id":"backend-01","role":"backend","description":"API dev"}}'

# Send message
curl -X POST http://hub:9900/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":"2","method":"send_message",
       "params":{"agent_id":"backend-01","to":"frontend-01","content":"API ready"}}'

# Read messages
curl -X POST http://hub:9900/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":"3","method":"read_messages",
       "params":{"agent_id":"frontend-01"}}'

# List agents
curl -X POST http://hub:9900/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":"4","method":"list_agents","params":{}}'
```

### SSE Events

```
GET /events?agent_id=frontend-01
Authorization: Bearer <token>

event: message
data: {"id":1,"from":"backend-01","content":"API ready","timestamp":"..."}

event: agent_online
data: {"agent_id":"backend-01","role":"backend","description":"API dev"}

event: agent_offline
data: {"agent_id":"backend-01"}
```

## Project Structure

```
agent-bridge/
├── packages/
│   ├── hub/              # Relay Hub (HTTP server)
│   │   └── src/
│   │       ├── server.ts        # HTTP server (node:http, zero deps)
│   │       ├── rpc-handler.ts   # JSON-RPC 2.0 dispatcher
│   │       ├── auth.ts          # Bearer token auth
│   │       ├── registry.ts      # Agent registration & discovery
│   │       ├── message-bus.ts   # Message routing & storage
│   │       ├── sse-manager.ts   # SSE connection management
│   │       └── index.ts         # Entry point
│   ├── mcp-plugin/       # MCP Plugin (stdio server)
│   │   └── src/
│   │       ├── hub-client.ts    # HTTP + SSE client
│   │       ├── message-queue.ts # Local message buffer
│   │       ├── tools.ts         # MCP tool definitions
│   │       └── index.ts         # Entry point
│   └── shared/            # Shared types
│       └── src/types.ts
├── tests/
│   └── e2e.test.ts
└── demo.html              # Interactive demo
```

## Tested

- macOS (Apple Silicon) ↔ Linux (aarch64, OrangePi) over Tailscale
- 2 agents, 5+ rounds of conversation, < 10ms latency on LAN

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Core messaging (RPC + SSE) | Done |
| 2 | Reliability (EventStore, reconnect, idempotency) + Blackboard | Planned |
| 3 | Contract negotiation (structured API agreements) | Planned |
| 4 | Auto network discovery, Bridge Code pairing, A2A compatibility | Planned |

## Design Docs

- [Architecture Design](./FINAL-DESIGN.md)
- [Interactive Demo](./demo.html) — open in browser

## License

MIT
