import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(ctx: TestApp, userId: string): Promise<void> {
  await ctx.repos.projects.create({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Default",
    created_at: new Date().toISOString(),
  });
}

function upstreamOk(): Response {
  return Response.json({
    model: "gpt-4o-mini",
    choices: [{ message: { role: "assistant", content: "ok" } }],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  });
}

test("every Helicone alias maps to the run model and is stripped before the provider", async () => {
  let forwarded: Headers | null = null;
  const upstream = Bun.serve({
    port: 0,
    fetch(req) {
      forwarded = req.headers;
      return upstreamOk();
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy/v1/chat/completions",
      headers: {
        ...bearer(session.key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer provider-key",
        "helicone-request-id": "helicone-run-1",
        "helicone-session-id": "helicone-session-1",
        "helicone-user-id": "end-user-1",
        "helicone-property-name": "refund-flow",
        "helicone-property-team": "billing",
        "helicone-property-region": "eu",
        "helicone-session-path": "/support/refund",
      },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);

    const run = await ctx.repos.runs.getById("helicone-run-1", session.user.id);
    expect(run).not.toBeNull();
    expect(run).toMatchObject({
      session_id: "helicone-session-1",
      end_user_id: "end-user-1",
      name: "refund-flow",
    });
    expect(JSON.parse(run!.tags!)).toMatchObject({
      session_path: "/support/refund",
      team: "billing",
      region: "eu",
    });

    expect(forwarded).not.toBeNull();
    expect(forwarded!.get("authorization")).toBe("Bearer provider-key");
    expect(forwarded!.get("helicone-request-id")).toBeNull();
    expect(forwarded!.get("helicone-session-id")).toBeNull();
    expect(forwarded!.get("helicone-user-id")).toBeNull();
    expect(forwarded!.get("helicone-property-name")).toBeNull();
    expect(forwarded!.get("helicone-property-team")).toBeNull();
    expect(forwarded!.get("helicone-session-path")).toBeNull();
  } finally {
    await ctx.cleanup();
    upstream.stop(true);
  }
});

test("Torrix headers win over the Helicone aliases", async () => {
  const upstream = Bun.serve({ port: 0, fetch: upstreamOk });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy/v1/chat/completions",
      headers: {
        ...bearer(session.key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-run-id": "torrix-run-1",
        "helicone-request-id": "helicone-run-2",
        "x-torrix-session": "torrix-session",
        "helicone-session-id": "helicone-session-2",
        "x-torrix-user-id": "torrix-user",
        "helicone-user-id": "end-user-2",
        "x-torrix-name": "torrix-name",
        "helicone-property-name": "helicone-name",
        "x-torrix-tags": "team=platform",
        "helicone-property-team": "billing",
      },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);

    const run = await ctx.repos.runs.getById("torrix-run-1", session.user.id);
    expect(run).toMatchObject({
      session_id: "torrix-session",
      end_user_id: "torrix-user",
      name: "torrix-name",
    });
    expect(JSON.parse(run!.tags!)).toMatchObject({ team: "platform" });
    expect(await ctx.repos.runs.getById("helicone-run-2", session.user.id)).toBeNull();
  } finally {
    await ctx.cleanup();
    upstream.stop(true);
  }
});
