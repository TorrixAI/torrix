import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

const MODERN = "2026-07-28";

function meta(version = MODERN): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
}

function headers(key: string, method: string, name?: string): Record<string, string> {
  return {
    ...bearer(key),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MODERN,
    "mcp-method": method,
    ...(name ? { "mcp-name": name } : {}),
  };
}

function body(id: number | null, method: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta() } };
}

async function callModern(
  ctx: TestApp,
  key: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { name?: string; id?: number | null; headers?: Record<string, string>; version?: string } = {},
) {
  const useHeaders = opts.headers ?? headers(key, method, opts.name);
  const payload = body(opts.id === undefined ? 1 : opts.id, method, params);
  if (opts.version) {
    (payload.params as Record<string, unknown>)._meta = meta(opts.version);
  }
  return ctx.app.inject({ method: "POST", url: "/mcp", headers: useHeaders, payload });
}

test("server/discover advertises both protocol versions, capabilities and identity", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const res = await callModern(ctx, session.key, "server/discover", {}, { headers: headers(session.key, "server/discover") });
    expect(res.statusCode).toBe(200);
    const result = res.json().result;
    expect(result.supportedVersions).toEqual([MODERN, "2025-06-18"]);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.resultType).toBe("complete");
    expect(result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("torrix");
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe("public");
    expect(res.headers["mcp-session-id"]).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});

test("stateless requests work without initialize or a session", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await ctx.repos.projects.create({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      name: "Default",
      created_at: new Date().toISOString(),
    });

    const listed = await callModern(ctx, session.key, "tools/list", {}, { headers: headers(session.key, "tools/list") });
    expect(listed.statusCode).toBe(200);
    const listResult = listed.json().result;
    expect(listResult.tools.map((tool: { name: string }) => tool.name)).toContain("get_dashboard");
    expect(listResult.resultType).toBe("complete");
    expect(listResult.ttlMs).toBe(60_000);
    expect(listResult.cacheScope).toBe("public");
    expect(listed.headers["mcp-session-id"]).toBeUndefined();

    const called = await callModern(ctx, session.key, "tools/call", { name: "list_runs", arguments: { limit: 5 } }, {
      name: "list_runs",
    });
    expect(called.statusCode).toBe(200);
    const callResult = called.json().result;
    expect(callResult.resultType).toBe("complete");
    expect(callResult.isError).toBe(false);
    expect(JSON.parse(callResult.content[0].text).total).toBeGreaterThanOrEqual(0);

    await new Promise((resolve) => setTimeout(resolve, 200));
    const logged = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, source: "mcp" });
    expect(logged.runs.some((run) => (run.name ?? "").includes("mcp: list_runs"))).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

test("the transport headers are validated against the body", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);

    const missingMethod = await callModern(ctx, session.key, "tools/list", {}, {
      headers: { ...bearer(session.key), "content-type": "application/json", "mcp-protocol-version": MODERN },
    });
    expect(missingMethod.statusCode).toBe(400);
    expect(missingMethod.json().error.code).toBe(-32020);

    const wrongMethod = await callModern(ctx, session.key, "tools/list", {}, {
      headers: headers(session.key, "tools/call"),
    });
    expect(wrongMethod.statusCode).toBe(400);
    expect(wrongMethod.json().error.message).toContain("Mcp-Method");

    const missingName = await callModern(ctx, session.key, "tools/call", { name: "list_runs", arguments: {} }, {
      headers: headers(session.key, "tools/call"),
    });
    expect(missingName.statusCode).toBe(400);
    expect(missingName.json().error.message).toContain("Mcp-Name");

    const wrongName = await callModern(ctx, session.key, "tools/call", { name: "list_runs", arguments: {} }, {
      name: "get_dashboard",
    });
    expect(wrongName.statusCode).toBe(400);
    expect(wrongName.json().error.code).toBe(-32020);

    const encoded = await callModern(ctx, session.key, "tools/call", { name: "list_runs", arguments: { limit: 1 } }, {
      headers: { ...headers(session.key, "tools/call"), "mcp-name": "=?base64?bGlzdF9ydW5z?=" },
    });
    expect(encoded.statusCode).toBe(200);
    expect(encoded.json().result.isError).toBe(false);

    const versionMismatch = await callModern(ctx, session.key, "tools/list", {}, {
      headers: { ...headers(session.key, "tools/list"), "mcp-protocol-version": "2025-06-18" },
    });
    expect(versionMismatch.statusCode).toBe(400);
    expect(versionMismatch.json().error.code).toBe(-32020);
    expect(versionMismatch.json().error.message).toContain("MCP-Protocol-Version");
  } finally {
    await ctx.cleanup();
  }
});

test("an unsupported version lists what the server does support", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const res = await callModern(ctx, session.key, "tools/list", {}, {
      headers: { ...headers(session.key, "tools/list"), "mcp-protocol-version": "1900-01-01" },
      version: "1900-01-01",
    });
    expect(res.statusCode).toBe(400);
    const error = res.json().error;
    expect(error.code).toBe(-32022);
    expect(error.data.supported).toEqual([MODERN, "2025-06-18"]);
    expect(error.data.requested).toBe("1900-01-01");
  } finally {
    await ctx.cleanup();
  }
});

test("unknown methods answer 404 and removed methods are gone", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);

    const unknown = await callModern(ctx, session.key, "resources/list", {}, { headers: headers(session.key, "resources/list") });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe(-32601);

    const ping = await callModern(ctx, session.key, "ping", {}, { headers: headers(session.key, "ping") });
    expect(ping.statusCode).toBe(404);
    expect(ping.json().error.code).toBe(-32601);

    const batch = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: headers(session.key, "tools/list"),
      payload: [body(1, "tools/list"), body(2, "tools/list")],
    });
    expect(batch.statusCode).toBe(400);
    expect(batch.json().error.code).toBe(-32600);
  } finally {
    await ctx.cleanup();
  }
});

test("legacy 2025-06-18 clients keep the initialize handshake and session", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const init = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: bearer(session.key),
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    });
    expect(init.statusCode).toBe(200);
    const sessionId = init.headers["mcp-session-id"] as string;
    expect(sessionId).toBeTruthy();
    expect(init.json().result.protocolVersion).toBe("2025-06-18");

    const listed = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...bearer(session.key), "mcp-session-id": sessionId },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(listed.statusCode).toBe(200);
    const result = listed.json().result;
    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.resultType).toBeUndefined();
    expect(result.ttlMs).toBeUndefined();
  } finally {
    await ctx.cleanup();
  }
});
