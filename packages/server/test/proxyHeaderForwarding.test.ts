import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

const WATCHED = ["cookie", "set-cookie", "x-target-url", "x-upstream-api-key", "x-upstream-authorization", "authorization", "x-api-key", "openai-organization"] as const;

function capture(headers: Headers): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of WATCHED) out[name] = headers.get(name);
  return out;
}

async function project(ctx: TestApp, userId: string): Promise<void> {
  await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: userId, name: "Default", created_at: new Date().toISOString() });
}

test("the proxy does not forward Torrix's own session cookie or routing headers upstream", async () => {
  let seen: Record<string, string | null> = {};
  const upstream = Bun.serve({
    port: 0,
    fetch: (req) => {
      seen = capture(req.headers);
      return Response.json({ model: "gpt-4o-mini", choices: [{ message: { role: "assistant", content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
    },
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
        // What a browser sends automatically to a same-origin /proxy call.
        cookie: `torrix_auth=${session.key}; torrix_project=abc`,
        "x-target-url": `http://localhost:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer sk-provider",
        "x-upstream-api-key": "sk-should-not-travel",
        // Provider-specific headers the proxy must keep forwarding.
        "x-api-key": "sk-ant-provider",
        "openai-organization": "org-123",
      },
      payload: { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.statusCode).toBe(200);

    expect(seen.cookie).toBeNull();
    expect(seen["set-cookie"]).toBeNull();
    expect(seen["x-target-url"]).toBeNull();
    expect(seen["x-upstream-api-key"]).toBeNull();
    expect(seen["x-upstream-authorization"]).toBeNull();

    // The provider credential and ordinary headers still travel.
    expect(seen.authorization).toBe("Bearer sk-provider");
    expect(seen["x-api-key"]).toBe("sk-ant-provider");
    expect(seen["openai-organization"]).toBe("org-123");
  } finally {
    await ctx.cleanup();
    upstream.stop(true);
  }
});
