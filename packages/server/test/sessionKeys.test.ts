import { expect, test } from "bun:test";
import { generateApiKey, hashKey, keyPrefix } from "../src/lib/auth";
import { bearer, createTestApp } from "./helpers";

const cookieValue = (response: { headers: Record<string, unknown> }): string => {
  const raw = String(response.headers["set-cookie"] ?? "");
  const match = /torrix_auth=([^;]+)/.exec(raw);
  return match ? decodeURIComponent(match[1]) : "";
};

test("sign-out revokes the browser session key but keeps a manual key", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "sessions@torrix.test", password: "password123" },
    });
    const defaultKey = (signup.json() as { api_key: string }).api_key;

    // The default key is a manual credential: logging out of the cookie it set
    // must not revoke it.
    const defaultLogout = await ctx.app.inject({
      method: "GET",
      url: "/ui/logout",
      headers: { cookie: `torrix_auth=${encodeURIComponent(defaultKey)}` },
    });
    expect(defaultLogout.statusCode).toBe(302);
    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(defaultKey) })).statusCode).toBe(200);

    // A password sign-in without a cookie creates a session key.
    const login = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "sessions@torrix.test", password: "password123" },
    });
    const sessionKey = (login.json() as { api_key: string }).api_key;
    const sessionCookie = cookieValue(login);
    expect(sessionCookie).toBe(sessionKey);

    const keys = await ctx.app.inject({ method: "GET", url: "/api/keys", headers: bearer(sessionKey) });
    const body = keys.json() as { keys: Array<{ id: string; session?: number }>; active_key_id: string | null };
    expect(body.keys.find((key) => key.id === body.active_key_id)?.session).toBe(1);

    const logout = await ctx.app.inject({
      method: "GET",
      url: "/ui/logout",
      headers: { cookie: `torrix_auth=${encodeURIComponent(sessionKey)}` },
    });
    expect(logout.statusCode).toBe(302);
    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(sessionKey) })).statusCode).toBe(401);
  } finally {
    await ctx.cleanup();
  }
});

test("a sign-in sweeps session keys idle for a month and leaves manual keys alone", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "sweep@torrix.test", password: "password123" },
    });
    const signupKey = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("sweep@torrix.test"))!;
    const stale = new Date(Date.now() - 31 * 86_400_000).toISOString();

    const staleSession = generateApiKey();
    await ctx.repos.apiKeys.create({
      id: crypto.randomUUID(),
      user_id: user.id,
      name: "Session key 2026-01-01",
      key_hash: hashKey(staleSession),
      key_prefix: keyPrefix(staleSession),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: stale,
      last_used_at: stale,
      revoked_at: null,
      session: 1,
    });
    const staleManual = generateApiKey();
    await ctx.repos.apiKeys.create({
      id: crypto.randomUUID(),
      user_id: user.id,
      name: "CI automation",
      key_hash: hashKey(staleManual),
      key_prefix: keyPrefix(staleManual),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: stale,
      last_used_at: stale,
      revoked_at: null,
      session: 0,
    });

    const login = await ctx.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "sweep@torrix.test", password: "password123" },
    });
    expect(login.statusCode).toBe(200);

    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(staleSession) })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(signupKey) })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "GET", url: "/api/whoami", headers: bearer(staleManual) })).statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});
