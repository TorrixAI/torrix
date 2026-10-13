import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

interface Json {
  runs?: Run[];
}

test("proxy pipeline still captures an end-to-end run", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model?: string };
      return Response.json({
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: body.model ?? "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello from mock" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "owner@regression.test", password: "password123" },
    });
    expect(signup.statusCode).toBe(201);
    const key = (signup.json() as { api_key: string }).api_key;

    const proxied = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream-test-key",
        "x-torrix-agent-id": "agent-regression-1",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
    });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.headers["x-torrix-run-id"]).toBeTruthy();
    const body = proxied.json() as { choices?: Array<{ message?: { content?: string } }> };
    expect(body.choices![0].message!.content).toBe("Hello from mock");

    const runs = await ctx.app.inject({ method: "GET", url: "/api/runs?source=proxy", headers: bearer(key) });
    expect(runs.statusCode).toBe(200);
    const listed = (runs.json() as Json).runs!;
    expect(listed).toHaveLength(1);
    expect(listed[0].model).toBe("gpt-4o");
    expect(listed[0].input_tokens).toBe(12);
    expect(listed[0].output_tokens).toBe(5);
    expect(listed[0].agent_id).toBe("agent-regression-1");
    expect(listed[0].cost_usd).toBeGreaterThan(0);

    const dashboard = await ctx.app.inject({ method: "GET", url: "/api/dashboard", headers: bearer(key) });
    expect(dashboard.statusCode).toBe(200);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("proxy accepts provider SDK path suffixes", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model?: string };
      return Response.json({
        id: "chatcmpl-suffix",
        model: body.model ?? "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "suffix ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await ctx.repos.projects.create({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      name: "Default",
      created_at: new Date().toISOString(),
    });
    const headers = {
      ...bearer(session.key),
      "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
      "x-upstream-authorization": "Bearer upstream",
    };

    const viaProxy = await ctx.app.inject({
      method: "POST",
      url: "/proxy/v1/chat/completions",
      headers,
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
    });
    expect(viaProxy.statusCode).toBe(200);

    const viaMcpProxy = await ctx.app.inject({
      method: "POST",
      url: "/mcp/v1/proxy/chat/completions",
      headers,
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
    });
    expect(viaMcpProxy.statusCode).toBe(200);

    const runs = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(runs.total).toBe(2);
    expect(runs.runs.map((r) => r.source).sort()).toEqual(["mcp_proxy", "proxy"]);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});
