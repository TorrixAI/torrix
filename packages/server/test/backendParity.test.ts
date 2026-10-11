import { expect, test } from "bun:test";
import type { RoutingRule, Run, RunData } from "../src/core/domain";
import { dispatchWebhook } from "../src/lib/costGate";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp } from "./helpers";

async function waitFor(assert: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assert()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

function seedRun(userId: string, projectId: string, overrides: Partial<RunData> & { id: string; created_at: string }): Run {
  return buildRunRow({
    user_id: userId,
    project_id: projectId,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o-mini",
    status: 200,
    ...overrides,
  });
}

test("sampling config is admin-only and validates the rate", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "sampling@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;

    const initial = await ctx.app.inject({ method: "GET", url: "/api/sampling-config", headers: bearer(key) });
    expect(initial.statusCode).toBe(200);
    expect((initial.json() as { sample_rate: number }).sample_rate).toBe(1);

    const invalid = await ctx.app.inject({
      method: "PUT",
      url: "/api/sampling-config",
      headers: bearer(key),
      payload: { sample_rate: 1.5 },
    });
    expect(invalid.statusCode).toBe(400);

    const saved = await ctx.app.inject({
      method: "PUT",
      url: "/api/sampling-config",
      headers: bearer(key),
      payload: { sample_rate: 0.25 },
    });
    expect(saved.statusCode).toBe(200);
    const readBack = await ctx.app.inject({ method: "GET", url: "/api/sampling-config", headers: bearer(key) });
    expect((readBack.json() as { sample_rate: number }).sample_rate).toBe(0.25);
  } finally {
    await ctx.cleanup();
  }
});

test("sampled-out streaming successes are dropped but streaming errors are always logged", async () => {
  const encoder = new TextEncoder();
  let fail = false;
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":"x","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { status: fail ? 500 : 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "sampled@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const userId = (await ctx.repos.users.findByEmail("sampled@torrix.test"))!.id;
    await ctx.repos.instance.set("global_sample_rate", "0");

    const request = (): Promise<{ statusCode: number }> =>
      ctx.app.inject({
        method: "POST",
        url: "/proxy",
        headers: {
          ...bearer(key),
          "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
          "x-upstream-authorization": "Bearer upstream",
        },
        payload: { model: "gpt-4o", stream: true, messages: [{ role: "user", content: "hi" }] },
      });

    expect((await request()).statusCode).toBe(200);
    expect((await ctx.repos.runs.list(userId, { limit: 5, offset: 0 })).total).toBe(0);

    fail = true;
    expect((await request()).statusCode).toBe(500);
    const after = await ctx.repos.runs.list(userId, { limit: 5, offset: 0 });
    expect(after.total).toBe(1);
    expect(after.runs[0].status).toBe(500);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("community has no playground run cap", async () => {
  const upstream = Bun.serve({ port: 0, async fetch() { return Response.json({ ok: true }); } });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "playcap@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const userId = (await ctx.repos.users.findByEmail("playcap@torrix.test"))!.id;
    const projectId = (await ctx.repos.projects.findDefault(userId))!.id;
    for (let i = 0; i < 50; i += 1) {
      await ctx.repos.runs.save(
        seedRun(userId, projectId, { id: `pg_${i}`, created_at: new Date(Date.now() + i).toISOString(), source: "playground" }),
      );
    }
    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
        "x-torrix-source": "playground",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("community has no golden run cap", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "goldcap@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const userId = (await ctx.repos.users.findByEmail("goldcap@torrix.test"))!.id;
    const projectId = (await ctx.repos.projects.findDefault(userId))!.id;
    for (let i = 0; i < 50; i += 1) {
      await ctx.repos.runs.save(
        seedRun(userId, projectId, { id: `gold_${i}`, created_at: new Date(Date.now() + i).toISOString(), is_golden: true }),
      );
    }
    await ctx.repos.runs.save(seedRun(userId, projectId, { id: "gold_target", created_at: new Date().toISOString() }));
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/runs/gold_target",
      headers: bearer(key),
      payload: { is_golden: true },
    });
    expect(res.statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("runs without a client trace id default to a one-run trace", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch() {
      return Response.json({
        id: "chatcmpl-trace",
        model: "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "trace-default@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const userId = (await ctx.repos.users.findByEmail("trace-default@torrix.test"))!.id;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    const runs = await ctx.repos.runs.list(userId, { limit: 5, offset: 0 });
    expect(runs.runs[0].trace_id).toBe(runs.runs[0].id);

    const traced = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
        "x-torrix-trace": "turn-42",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi again" }] },
    });
    expect(traced.statusCode).toBe(200);
    const after = await ctx.repos.runs.list(userId, { limit: 5, offset: 0 });
    expect(after.runs[0].trace_id).toBe("turn-42");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("outbound webhooks carry an HMAC-SHA256 signature when a secret is set", async () => {
  const captured: Array<{ headers: Record<string, string>; body: string }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, name) => {
        headers[name] = value;
      });
      captured.push({ headers, body: await req.text() });
      return new Response("ok");
    },
  });
  try {
    await dispatchWebhook(`http://127.0.0.1:${server.port}/hook`, { event: "test" }, "topsecret");
    await waitFor(() => captured.length === 1);
    const signature = captured[0].headers["x-torrix-signature"];
    expect(String(signature)).toStartWith("sha256=");
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("topsecret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(captured[0].body));
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(signature).toBe(`sha256=${expected}`);
  } finally {
    server.stop(true);
  }
});

