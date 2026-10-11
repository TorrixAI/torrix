/**
 * Standalone MCP server speaking stdio JSON-RPC 2.0. It is a thin bridge to a
 * running Torrix's streamable HTTP endpoint (`/mcp`), so an MCP host can launch
 * it as a subprocess and still see exactly the tools that instance serves:
 *
 *   TORRIX_BASE_URL=http://localhost:8088 \
 *   TORRIX_API_KEY=trxk_... \
 *   bun packages/server/src/mcpStdio.ts
 *
 * Register it in an MCP client config as:
 *   { "command": "bun", "args": ["<path>/packages/server/src/mcpStdio.ts"],
 *     "env": { "TORRIX_BASE_URL": "...", "TORRIX_API_KEY": "trxk_..." } }
 */

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

const baseUrl = (process.env.TORRIX_BASE_URL ?? "http://127.0.0.1:8088").replace(/\/+$/, "");
const apiKey = process.env.TORRIX_API_KEY ?? "";
let sessionId: string | null = null;

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function bridgeError(id: unknown, message: string): unknown {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } };
}

async function forward(message: JsonRpcMessage): Promise<unknown | undefined> {
  const isRequest = message.id !== undefined;
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    if (sessionId) {
      headers["mcp-session-id"] = sessionId;
    }
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30_000),
    });
    const issued = res.headers.get("mcp-session-id");
    if (issued) {
      sessionId = issued;
    }
    if (res.status === 404 && sessionId) {
      sessionId = null;
    }
    const text = await res.text();
    if (!res.ok && res.status !== 202) {
      return isRequest ? bridgeError(message.id, `torrix ${res.status}: ${text.slice(0, 200)}`) : undefined;
    }
    return text.trim() && isRequest ? JSON.parse(text) : undefined;
  } catch (err) {
    return isRequest ? bridgeError(message.id, `torrix unreachable at ${baseUrl}: ${(err as Error).message}`) : undefined;
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) {
      continue;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    void forward(message).then((res) => {
      if (res !== undefined) {
        write(res);
      }
    });
  }
});
