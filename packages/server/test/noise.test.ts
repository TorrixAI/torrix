import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

function run(overrides: Partial<Run> & { id: string; user_id: string; project_id: string }): Run {
  return {
    name: "noise fixture",
    status: 200,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 10,
    output_tokens: 5,
    latency_ms: 100,
    cost_usd: 0.001,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Run;
}

async function project(ctx: Awaited<ReturnType<typeof createTestApp>>, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Noise", created_at: new Date().toISOString() });
  return id;
}

test("login reuses the session key already held by the same browser", async () => {
  const ctx = await createTestApp();
  try {
    const email = "reuse@example.com";
    const password = "password123";
    const signup = await ctx.app.inject({ method: "POST", url: "/auth/signup", payload: { email, password } });
    expect(signup.statusCode).toBe(201);
    const first = await ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    expect(first.statusCode).toBe(200);
    const firstKey = (first.json() as { api_key: string }).api_key;
    const cookie = String(first.headers["set-cookie"] ?? "").split(";")[0];
    expect(cookie).toContain("=");
    const second = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { cookie },
      payload: { email, password },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { api_key: string }).api_key).toBe(firstKey);
    const user = (await ctx.repos.users.findByEmail(email))!;
    const keys = await ctx.repos.apiKeys.listByUser(user.id);
    expect(keys.filter((key) => key.name.startsWith("Session key ")).length).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

test("cost settings still carry keys with zero spend for the console to filter", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await project(ctx, session.user.id);
    const now = new Date().toISOString();
    const keyId = crypto.randomUUID();
    await ctx.repos.apiKeys.create({
      id: keyId,
      user_id: session.user.id,
      name: "unused-key",
      key_hash: `hash-${keyId}`,
      key_prefix: `trxk_${keyId.slice(0, 6)}`,
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: now,
      last_used_at: null,
      revoked_at: null,
      budget_usd: null,
      hard_cap_usd: null,
    });
    await ctx.repos.runs.save(run({ id: crypto.randomUUID(), user_id: session.user.id, project_id: projectId, api_key_id: keyId, cost_usd: 0 }));

    const res = await ctx.app.inject({ method: "GET", url: "/api/cost/settings", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const usage = (res.json() as { usage: Array<{ scope: string; name: string; spend: number }> }).usage;
    expect(usage.some((row) => row.scope === "api_key" && row.name === "unused-key" && row.spend === 0)).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});
