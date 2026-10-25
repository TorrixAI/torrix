import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(ctx: TestApp, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Default", created_at: new Date().toISOString() });
  return id;
}

function jsonRpc(id: number, method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method, params };
}

test("MCP HTTP sessions, DELETE, tool logging and compare_runs", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const userId = session.user.id;
    const projectId = await seedProject(ctx, userId);
    const now = new Date().toISOString();
    for (const name of ["run-a", "run-b"]) {
      const id = crypto.randomUUID();
      await ctx.repos.runs.save({
        id,
        user_id: userId,
        project_id: projectId,
        name,
        model: "gpt-4o-mini",
        provider: "openai",
        status: 200,
        source: "proxy",
        input_tokens: 10,
        output_tokens: 5,
        created_at: now,
      } as never);
    }

    const init = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: bearer(session.key),
      payload: jsonRpc(1, "initialize", { protocolVersion: "2025-06-18" }),
    });
    expect(init.statusCode).toBe(200);
    const sessionId = init.headers["mcp-session-id"] as string;
    expect(sessionId).toBeTruthy();
    expect(init.json().result.serverInfo.name).toBe("torrix");

    const withSession = { ...bearer(session.key), "mcp-session-id": sessionId };
    const listed = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: withSession,
      payload: jsonRpc(2, "tools/list"),
    });
    const toolNames = listed.json().result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("compare_runs");

    const unknown = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...bearer(session.key), "mcp-session-id": "does-not-exist" },
      payload: jsonRpc(3, "tools/list"),
    });
    expect(unknown.statusCode).toBe(404);

    const runIds = (await ctx.repos.runs.list(userId, { limit: 10, offset: 0 })).runs.map((run) => run.id);
    const compared = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: withSession,
      payload: jsonRpc(4, "tools/call", { name: "compare_runs", arguments: { run_ids: runIds } }),
    });
    expect(compared.statusCode).toBe(200);
    expect(compared.json().result.isError).toBe(false);
    expect(compared.json().result.content[0].text).toContain("run-a");

    for (const name of ["get_dashboard", "compare_runs"]) {
      const call = await ctx.app.inject({
        method: "POST",
        url: "/mcp",
        headers: withSession,
        payload: jsonRpc(5, "tools/call", { name, arguments: name === "compare_runs" ? { run_ids: runIds } : {} }),
      });
      expect(call.statusCode).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    const logged = await ctx.repos.runs.list(userId, { limit: 50, offset: 0, source: "mcp" });
    expect(logged.runs.length).toBeGreaterThanOrEqual(2);
    const dashboardRun = logged.runs.find((run) => (run.name ?? "").includes("mcp: get_dashboard"));
    expect(dashboardRun).toBeTruthy();
    expect(dashboardRun?.session_id).toBe(sessionId);

    const removed = await ctx.app.inject({ method: "DELETE", url: "/mcp", headers: withSession });
    expect(removed.statusCode).toBe(200);
    const removedAgain = await ctx.app.inject({ method: "DELETE", url: "/mcp", headers: withSession });
    expect(removedAgain.statusCode).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

test("MCP GET stream opens an SSE session", async () => {
  const ctx = await createTestApp();
  let controller: AbortController | null = null;
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const address = ctx.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      headers: { authorization: `Bearer ${session.key}`, accept: "text/event-stream" },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("notifications/initialized");
    controller.abort();
    controller = null;
  } finally {
    controller?.abort();
    await ctx.cleanup();
  }
});

test("MCP proxy forwards JSON-RPC, logs only tools/call and falls back for LLM traffic", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as Record<string, unknown>;
      seen.push(body);
      if (body.method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } });
      }
      if (body.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
      }
      return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "not found" } });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);

    const handshake = await ctx.app.inject({
      method: "POST",
      url: "/mcp/proxy",
      headers: {
        ...bearer(session.key),
        "x-target-mcp-url": `http://127.0.0.1:${upstream.port}/mcp`,
        "content-type": "application/json",
      },
      payload: jsonRpc(1, "initialize"),
    });
    expect(handshake.statusCode).toBe(200);
    expect(seen).toHaveLength(1);
    let logged = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, source: "mcp_proxy" });
    expect(logged.total).toBe(0);

    const call = await ctx.app.inject({
      method: "POST",
      url: "/mcp/proxy",
      headers: {
        ...bearer(session.key),
        "x-target-mcp-url": `http://127.0.0.1:${upstream.port}/mcp`,
        "x-torrix-trace": "trace-mcp",
        "content-type": "application/json",
      },
      payload: jsonRpc(2, "tools/call", { name: "search", arguments: { q: "hello" } }),
    });
    expect(call.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    logged = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, source: "mcp_proxy" });
    expect(logged.total).toBe(1);
    expect(logged.runs[0].name).toContain("mcp_proxy: search");
    expect(logged.runs[0].trace_id).toBe("trace-mcp");
    const events = await ctx.repos.events.listByRun(logged.runs[0].id);
    expect(events.find((event) => event.type === "response")?.message).toContain("ok");
    expect(events.find((event) => event.type === "tool_call")?.message).toContain("search");

    const missingTarget = await ctx.app.inject({
      method: "POST",
      url: "/mcp/proxy",
      headers: { ...bearer(session.key), "content-type": "application/json" },
      payload: jsonRpc(3, "tools/list"),
    });
    expect(missingTarget.statusCode).toBe(400);
    expect(missingTarget.json().error).toBe("missing_x_target_mcp_url");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("MCP proxy forwards the 2026-07-28 stateless routing headers", async () => {
  let seen: Headers | null = null;
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      seen = req.headers;
      const body = (await req.json()) as Record<string, unknown>;
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/mcp/proxy",
      headers: {
        ...bearer(session.key),
        "x-target-mcp-url": `http://127.0.0.1:${upstream.port}/mcp`,
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "search",
        "mcp-param-q": "hello",
      },
      payload: jsonRpc(1, "tools/call", { name: "search", arguments: { q: "hello" } }),
    });
    expect(res.statusCode).toBe(200);
    expect(seen).not.toBeNull();
    expect(seen!.get("mcp-protocol-version")).toBe("2026-07-28");
    expect(seen!.get("mcp-method")).toBe("tools/call");
    expect(seen!.get("mcp-name")).toBe("search");
    expect(seen!.get("mcp-param-q")).toBe("hello");
    expect(seen!.get("mcp-session-id")).toBeNull();
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("OTLP maps cache tokens and resolves parent spans within a trace", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);
    const span = (overrides: Record<string, unknown>) => ({
      traceId: "trace-a",
      spanId: "span-parent",
      name: "chat gpt-4o-mini",
      startTimeUnixNano: "1700000000000000000",
      endTimeUnixNano: "1700000000500000000",
      attributes: [
        { key: "gen_ai.request.model", value: { stringValue: "gpt-4o-mini" } },
        { key: "gen_ai.usage.input_tokens", value: { intValue: "120" } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: "30" } },
        { key: "gen_ai.usage.cache_read.input_tokens", value: { intValue: "80" } },
        { key: "gen_ai.usage.cache_creation.input_tokens", value: { intValue: "10" } },
      ],
      kind: 2,
      ...overrides,
    });
    const payload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "agent" } }] },
          scopeSpans: [
            {
              scope: { name: "test" },
              spans: [
                span({}),
                span({
                  spanId: "span-child",
                  parentSpanId: "span-parent",
                  attributes: [
                    { key: "gen_ai.request.model", value: { stringValue: "gpt-4o-mini" } },
                    { key: "gen_ai.usage.input_tokens", value: { intValue: "40" } },
                    { key: "gen_ai.usage.output_tokens", value: { intValue: "5" } },
                  ],
                }),
                // Cross-trace parent: must not link to span-parent.
                span({
                  traceId: "trace-b",
                  spanId: "span-other",
                  parentSpanId: "span-parent",
                  attributes: [{ key: "gen_ai.request.model", value: { stringValue: "gpt-4o-mini" } }],
                }),
              ],
            },
          ],
        },
      ],
    };

    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/traces",
      headers: { ...bearer(session.key), "content-type": "application/json" },
      payload,
    });
    expect(res.statusCode).toBe(200);

    const child = await ctx.repos.runs.getById("otel-span-child", session.user.id);
    expect(child?.parent_run_id).toBe("otel-span-parent");
    expect(child?.trace_id).toBe("trace-a");

    const parent = await ctx.repos.runs.getById("otel-span-parent", session.user.id);
    expect(parent?.cache_read_tokens).toBe(80);
    expect(parent?.cache_creation_tokens).toBe(10);
    expect(parent?.parent_run_id).toBeNull();

    const crossTrace = await ctx.repos.runs.getById("otel-span-other", session.user.id);
    expect(crossTrace?.parent_run_id).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});
