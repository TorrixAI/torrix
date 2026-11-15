import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { generateApiKey, hashKey, keyPrefix } from "../src/lib/auth";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp } from "./helpers";

test("a capped key returns 429 and reports the same spend on the cost endpoint", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "caps@torrix.test", password: "password123" },
    });
    const sessionKey = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("caps@torrix.test"))!;
    const project = (await ctx.repos.projects.findDefault(user.id))!;

    const keyId = crypto.randomUUID();
    const cappedKey = generateApiKey();
    await ctx.repos.apiKeys.create({
      id: keyId,
      user_id: user.id,
      name: "capped-ui",
      key_hash: hashKey(cappedKey),
      key_prefix: keyPrefix(cappedKey),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      budget_usd: null,
      hard_cap_usd: 0.5,
    });

    const run: Run = buildRunRow({
      id: "run_cap_spend",
      user_id: user.id,
      project_id: project.id,
      api_key_id: keyId,
      source: "sdk",
      provider: "openai",
      model: "gpt-4o",
      cost_usd: 0.6,
      status: 200,
      created_at: new Date().toISOString(),
    });
    await ctx.repos.runs.save(run);

    const blocked = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(cappedKey),
        "x-target-url": "https://api.openai.com/v1/chat/completions",
        "x-upstream-authorization": "Bearer upstream",
        "x-torrix-source": "playground",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: string }).error).toBe("hard_cap_reached");

    const cost = await ctx.app.inject({ method: "GET", url: "/api/cost/settings", headers: bearer(sessionKey) });
    expect(cost.statusCode).toBe(200);
    const usage = (cost.json() as { usage: Array<{ scope: string; id: string | null; spend: number; hard_cap_usd: number | null }> }).usage;
    const row = usage.find((entry) => entry.scope === "api_key" && entry.id === keyId);
    expect(row?.spend).toBeCloseTo(0.6, 6);
    expect(row?.hard_cap_usd).toBe(0.5);
  } finally {
    await ctx.cleanup();
  }
});
