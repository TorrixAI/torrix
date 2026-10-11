# MCP

Torrix works with the Model Context Protocol in two ways.

## Ask your assistant about your traces

Torrix is an MCP server, so Claude, Cursor, opencode or any MCP client can query your data in plain
language: "what did we spend on gpt-4o this week?", "show me the failed runs from the last
deploy", "compare these two runs".

Tools available:

| Tool | What it does |
|---|---|
| `get_dashboard` | spend, tokens, latency and errors over a window, per agent and per tool |
| `list_runs` | recent runs, filtered by model, source, agent or score |
| `get_run` | one run with its prompt, response, reasoning and tool calls |
| `compare_runs` | two to four runs side by side |
| `get_trace`, `get_session` | every run in a turn or a conversation |
| `get_cost_summary` | month to date spend, per model |
| `search_runs` | search names, models and metadata |
| `list_anomalies` | runs that cost much more than usual |

**Over HTTP** (streamable HTTP transport): add `http://localhost:8088/mcp` to your MCP client with
the header `authorization: Bearer trxk_YOUR_KEY`.

**Over stdio**, for clients that start servers as a command:

```json
{
  "command": "bun",
  "args": ["/path/to/torrix/packages/server/src/mcpStdio.ts"],
  "env": { "TORRIX_BASE_URL": "http://localhost:8088", "TORRIX_API_KEY": "trxk_YOUR_KEY" }
}
```

Every tool call made through the Torrix MCP server is itself recorded as a run, so you can see what
your assistant looked at.

## Record calls to other MCP servers

The MCP proxy records tool calls your agents make to any MCP server. Send JSON-RPC requests to
`http://localhost:8088/mcp/proxy` with:

| Header | Meaning |
|---|---|
| `authorization` | your Torrix key |
| `x-target-mcp-url` | the MCP server to forward to |
| `x-upstream-authorization` or `x-upstream-api-key` | credentials for that server |
| `x-torrix-trace`, `x-torrix-session`, `x-agent-name` | grouping, as with the HTTP proxy |

Only `tools/call` requests are recorded. Handshakes and listings pass through quietly.
