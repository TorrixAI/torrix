import { expect, test } from "bun:test";
import { bearer, createTestApp } from "./helpers";

test("API keys can be listed, created, used and revoked", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "keys@test.local", password: "password123" },
    });
    expect(signup.statusCode).toBe(201);
    const sessionKey = (signup.json() as { api_key: string }).api_key;

    const list = await ctx.app.inject({ method: "GET", url: "/api/keys", headers: bearer(sessionKey) });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as { keys: Array<{ id: string; key_prefix: string; key_hash?: string }>; active_key_id: string | null };
    expect(listed.keys).toHaveLength(1);
    expect(listed.keys[0].key_prefix).toBe(sessionKey.slice(0, 8));
    expect("key_hash" in listed.keys[0]).toBe(false);
    expect(listed.active_key_id).toBe(listed.keys[0].id);

    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: bearer(sessionKey),
      payload: { name: "readonly bot", permission: "read_only" },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { key: string; record: { id: string; key_prefix: string } };
    expect(createdBody.key.startsWith("trxk_")).toBe(true);
    expect(createdBody.record.key_prefix).toBe(createdBody.key.slice(0, 8));

    const readings = await ctx.app.inject({ method: "GET", url: "/api/runs", headers: bearer(createdBody.key) });
    expect(readings.statusCode).toBe(200);

    const writeAttempt = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: { ...bearer(createdBody.key), "x-target-url": "https://api.openai.com/v1/chat/completions" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(writeAttempt.statusCode).toBe(403);
    expect((writeAttempt.json() as { reason?: string }).reason).toBe("read_only_key");

    const revokeActive = await ctx.app.inject({
      method: "DELETE",
      url: `/api/keys/${listed.active_key_id}`,
      headers: bearer(sessionKey),
    });
    expect(revokeActive.statusCode).toBe(400);
    expect((revokeActive.json() as { error?: string }).error).toBe("cannot_revoke_active_key");

    const revokeOther = await ctx.app.inject({
      method: "DELETE",
      url: `/api/keys/${createdBody.record.id}`,
      headers: bearer(sessionKey),
    });
    expect(revokeOther.statusCode).toBe(200);

    const after = await ctx.app.inject({ method: "GET", url: "/api/keys", headers: bearer(sessionKey) });
    expect((after.json() as { keys: unknown[] }).keys).toHaveLength(1);

    const withRevoked = await ctx.app.inject({ method: "GET", url: "/api/runs", headers: bearer(createdBody.key) });
    expect(withRevoked.statusCode).toBe(401);

    const page = await ctx.app.inject({ method: "GET", url: "/ui/keys", headers: bearer(sessionKey) });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("API keys");
    expect(page.body).toContain("Copy key");
  } finally {
    await ctx.cleanup();
  }
});
