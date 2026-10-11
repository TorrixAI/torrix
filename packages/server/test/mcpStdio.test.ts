import { expect, test } from "bun:test";
import * as path from "node:path";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

interface JsonRpc {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function seedRun(ctx: TestApp, userId: string): Promise<Run> {
  const run = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: "stdio check",
    model: "gpt-4o",
    provider: "openai",
    input_tokens: 120,
    output_tokens: 30,
    cost_usd: 0.002,
    latency_ms: 250,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  return run;
}

function parseLines(buffer: string): JsonRpc[] {
  return buffer
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as JsonRpc);
}

test("stdio MCP server drives initialize, tools/list and tools/call over a real HTTP API", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const run = await seedRun(ctx, session.user.id);
    const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    expect(address).toContain("127.0.0.1");

    const scriptPath = path.resolve(import.meta.dir, "..", "src", "mcpStdio.ts");
    const child = Bun.spawn(["bun", scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TORRIX_BASE_URL: address,
        TORRIX_API_KEY: session.key,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    let stdout = "";
    let stderrText = "";
    const reader = (async () => {
      const stream = child.stdout as ReadableStream<Uint8Array>;
      const decoder = new TextDecoder();
      const read = stream.getReader();
      for (;;) {
        const { done, value } = await read.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
      }
    })();
    void (async () => {
      const decoder = new TextDecoder();
      const read = (child.stderr as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await read.read();
        if (done) break;
        stderrText += decoder.decode(value, { stream: true });
      }
    })();

    const send = (message: Record<string, unknown>) => {
      (child.stdin as { write: (chunk: string) => void }).write(`${JSON.stringify(message)}\n`);
    };

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_runs", arguments: { limit: 5 } } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_dashboard", arguments: { days: 7 } } });
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_agents", arguments: {} } });
    send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "pending_approvals", arguments: {} } });

    const deadline = Date.now() + 30_000;
    let responses: JsonRpc[] = [];
    while (Date.now() < deadline) {
      responses = parseLines(stdout);
      if (responses.filter((r) => r.id !== undefined).length >= 6) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill();
    await reader.catch(() => undefined);

    const byId = new Map(responses.filter((r) => r.id !== undefined).map((r) => [r.id as number, r]));
    if (byId.size < 6) {
      throw new Error(`only ${byId.size} responses; exit=${child.exitCode}; stderr=${stderrText.slice(0, 400)}; stdout=${stdout.slice(0, 400)}`);
    }

    const init = byId.get(1);
    expect(init?.result?.serverInfo).toBeTruthy();

    const tools = (byId.get(2)?.result?.tools as Array<{ name: string }> | undefined) ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_runs");
    // Agent-control tools ship with the enterprise extension, not the core build.
    expect(names).not.toContain("list_agents");
    expect(names).not.toContain("pending_approvals");

    const listResult = byId.get(3)?.result;
    expect(byId.get(3)?.error).toBeUndefined();
    const listText = ((listResult?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "");
    expect(listText).toContain(run.id);

    const dashText = ((byId.get(4)?.result?.content as Array<{ text: string }> | undefined)?.[0]?.text ?? "");
    expect(dashText).toContain("totalRuns");

    expect(byId.get(5)?.result?.isError).toBe(true);
    expect(byId.get(6)?.result?.isError).toBe(true);
  } finally {
    await ctx.cleanup();
  }
}, 120_000);
