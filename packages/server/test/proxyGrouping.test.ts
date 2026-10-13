import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function project(ctx: TestApp, userId: string): Promise<void> {
  await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: userId, name: "Default", created_at: new Date().toISOString() });
}

test("W3C traceparent and Helicone headers map onto the run model", async () => {
  const upstream = Bun.serve({
    port: 0,
    fetch: () => Response.json({ model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }),
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await project(ctx, session.user.id);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(session.key),
        "x-target-url": `http://localhost:${upstream.port}/v1/chat/completions`,
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "helicone-request-id": "helicone-req-1",
        "helicone-user-id": "customer-42",
        "helicone-session-id": "helicone-session",
        "helicone-session-path": "/support/refund",
      },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);
    const run = await ctx.repos.runs.getById("helicone-req-1", session.user.id);
    expect(run).toMatchObject({
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
      session_id: "helicone-session",
      end_user_id: "customer-42",
    });
    expect(run?.agent_name ?? null).toBeNull();
    expect(JSON.parse(run!.tags!)).toMatchObject({ session_path: "/support/refund" });
  } finally {
    await ctx.cleanup();
    upstream.stop(true);
  }
});

test("sampling skips successful calls but always keeps failures, streaming or not", async () => {
  let fail = false;
  const upstream = Bun.serve({
    port: 0,
    fetch: () =>
      fail
        ? Response.json({ error: { message: "boom" } }, { status: 500 })
        : Response.json({ model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }),
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await project(ctx, session.user.id);
    const call = () =>
      ctx.app.inject({
        method: "POST",
        url: "/proxy",
        headers: { ...bearer(session.key), "x-target-url": `http://localhost:${upstream.port}/v1/chat/completions`, "x-torrix-sample": "0" },
        payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
      });
    expect((await call()).statusCode).toBe(200);
    expect((await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 })).total).toBe(0);
    fail = true;
    expect((await call()).statusCode).toBe(500);
    const stored = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(stored.total).toBe(1);
    expect(stored.runs[0].status).toBe(500);
  } finally {
    await ctx.cleanup();
    upstream.stop(true);
  }
});
