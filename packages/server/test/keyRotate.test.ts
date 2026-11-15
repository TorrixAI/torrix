import { expect, test } from "bun:test";
import { generateApiKey, hashKey, keyPrefix } from "../src/lib/auth";
import { bearer, createTestApp } from "./helpers";

test("rotating a manual key copies its settings and invalidates the old secret", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "rotate@torrix.test", password: "password123" },
    });
    const authKey = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("rotate@torrix.test"))!;
    const project = (await ctx.repos.projects.findDefault(user.id))!;

    const oldSecret = generateApiKey();
    const keyId = crypto.randomUUID();
    await ctx.repos.apiKeys.create({
      id: keyId,
      user_id: user.id,
      name: "CI automation",
      key_hash: hashKey(oldSecret),
      key_prefix: keyPrefix(oldSecret),
      scope: "projects",
      projects: JSON.stringify([project.id]),
      permission: "read_only",
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      budget_usd: 4,
      hard_cap_usd: 2,
      session: 0,
    });

    const rotated = await ctx.app.inject({
      method: "POST",
      url: `/api/keys/${keyId}/rotate`,
      headers: bearer(authKey),
    });
    expect(rotated.statusCode).toBe(201);
    const body = rotated.json() as { key: string; record: { name: string; scope: string; permission: string; projects: string[]; budget_usd: number; hard_cap_usd: number; session: number } };
    expect(body.key.startsWith("trxk_")).toBe(true);
    expect(body.record).toMatchObject({ name: "CI automation", scope: "projects", permission: "read_only", budget_usd: 4, hard_cap_usd: 2, session: 0 });
    expect(body.record.projects).toEqual([project.id]);

    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(oldSecret) })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(body.key) })).statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("the active key and session keys cannot be rotated", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "rotate-guard@torrix.test", password: "password123" },
    });
    const authKey = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("rotate-guard@torrix.test"))!;
    const keys = (await ctx.app.inject({ method: "GET", url: "/api/keys", headers: bearer(authKey) })).json() as { active_key_id: string };

    const active = await ctx.app.inject({
      method: "POST",
      url: `/api/keys/${keys.active_key_id}/rotate`,
      headers: bearer(authKey),
    });
    expect(active.statusCode).toBe(400);
    expect((active.json() as { error: string }).error).toBe("cannot_rotate_active_key");

    const sessionId = crypto.randomUUID();
    const sessionSecret = generateApiKey();
    await ctx.repos.apiKeys.create({
      id: sessionId,
      user_id: user.id,
      name: "Session key 2026-01-01",
      key_hash: hashKey(sessionSecret),
      key_prefix: keyPrefix(sessionSecret),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      session: 1,
    });
    const session = await ctx.app.inject({
      method: "POST",
      url: `/api/keys/${sessionId}/rotate`,
      headers: bearer(authKey),
    });
    expect(session.statusCode).toBe(400);
    expect((session.json() as { error: string }).error).toBe("cannot_rotate_session_key");
  } finally {
    await ctx.cleanup();
  }
});
