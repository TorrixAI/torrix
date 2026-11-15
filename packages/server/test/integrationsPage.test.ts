import { expect, test } from "bun:test";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp, expectSpaShell, seedSession, type TestApp } from "./helpers";

async function saveRun(ctx: TestApp, userId: string, fields: Record<string, unknown>): Promise<void> {
  await ctx.repos.runs.save(
    buildRunRow({ id: crypto.randomUUID(), user_id: userId, project_id: "p", model: "m", status: 200, ...fields } as never),
  );
}

test("integrations page serves the console and the API carries the instance URL and key placeholder", async () => {
  const ctx = await createTestApp({ TORRIX_PLUGIN_MARKETPLACE: "acme/torrix-plugins" });
  try {
    const session = await seedSession(ctx);
    const headers = { ...bearer(session.key), host: "torrix.internal:9000", "x-forwarded-proto": "https" };
    const res = await ctx.app.inject({ method: "GET", url: "/ui/integrations", headers });
    expect(res.statusCode).toBe(200);
    expectSpaShell(res.body);

    // Cards and commands are rendered client-side; the data they need comes
    // from /api/integrations.
    const api = await ctx.app.inject({ method: "GET", url: "/api/integrations", headers });
    expect(api.statusCode).toBe(200);
    const data = api.json() as { base_url: string; plugin_marketplace: string; integrations: Array<{ id: string }> };
    expect(data.base_url).toBe("https://torrix.internal:9000");
    expect(data.plugin_marketplace).toBe("acme/torrix-plugins");
    expect(data.integrations.map((i) => i.id)).toEqual(expect.arrayContaining(["claude-code", "opencode", "sdk", "proxy", "otel"]));
  } finally {
    await ctx.cleanup();
  }
});

test("without a configured marketplace the API still offers an install source", async () => {
  const ctx = await createTestApp({ TORRIX_PLUGIN_MARKETPLACE: "" });
  try {
    const session = await seedSession(ctx);
    const api = await ctx.app.inject({ method: "GET", url: "/api/integrations", headers: bearer(session.key) });
    expect(api.statusCode).toBe(200);
    const data = api.json() as { plugin_marketplace: string };
    expect(data.plugin_marketplace.length).toBeGreaterThan(0);
  } finally {
    await ctx.cleanup();
  }
});

test("connect installers are served with the instance URL and configured marketplace", async () => {
  const ctx = await createTestApp({ TORRIX_PLUGIN_MARKETPLACE: "acme/torrix-plugins" });
  try {
    const headers = { host: "torrix.internal:9000", "x-forwarded-proto": "https" };
    const opencode = await ctx.app.inject({ method: "GET", url: "/api/connect/opencode.sh", headers });
    expect(opencode.statusCode).toBe(200);
    expect(String(opencode.headers["content-type"])).toContain("shellscript");
    expect(opencode.body).toContain("https://torrix.internal:9000");
    expect(opencode.body).not.toMatch(/trxk_[0-9a-f]{32}/);

    const claude = await ctx.app.inject({ method: "GET", url: "/api/connect/claude-code.sh", headers });
    expect(claude.statusCode).toBe(200);
    expect(claude.body).toContain("acme/torrix-plugins");
    expect(claude.body).toContain("claude plugin install torrix");

    const powershell = await ctx.app.inject({ method: "GET", url: "/api/connect/opencode.ps1", headers });
    expect(powershell.statusCode).toBe(200);
    expect(powershell.body).toContain("opencode.json");
  } finally {
    await ctx.cleanup();
  }
});

test("integration status reflects which client delivered runs and how recently", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const unauth = await ctx.app.inject({ method: "GET", url: "/api/integrations" });
    expect(unauth.statusCode).toBe(401);

    const now = new Date().toISOString();
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await saveRun(ctx, session.user.id, { source: "sdk", tags: { client: "claude-code" }, created_at: now });
    await saveRun(ctx, session.user.id, { source: "sdk", tags: { client: "claude-code" }, created_at: now });
    await saveRun(ctx, session.user.id, { source: "sdk", tags: { app: "opencode", agent: "build" }, created_at: old });
    await saveRun(ctx, session.user.id, { source: "sdk", created_at: now });
    await saveRun(ctx, session.user.id, { source: "proxy", created_at: now });

    const res = await ctx.app.inject({ method: "GET", url: "/api/integrations", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(
      (res.json() as { integrations: Array<{ id: string; last_at: string | null; runs_24h: number }> }).integrations.map((i) => [i.id, i]),
    );
    expect(byId["claude-code"]).toMatchObject({ runs_24h: 2, last_at: now });
    expect(byId.opencode).toMatchObject({ runs_24h: 0, last_at: old });
    expect(byId.sdk).toMatchObject({ runs_24h: 1 });
    expect(byId.proxy).toMatchObject({ runs_24h: 1 });
    expect(byId.otel).toMatchObject({ runs_24h: 0, last_at: null });

    const page = await ctx.app.inject({ method: "GET", url: "/ui/integrations", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);
  } finally {
    await ctx.cleanup();
  }
});

test("the integrations page serves the console for any visitor OS", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    for (const userAgent of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    ]) {
      const res = await ctx.app.inject({ method: "GET", url: "/ui/integrations", headers: { ...bearer(session.key), "user-agent": userAgent } });
      expect(res.statusCode).toBe(200);
      expectSpaShell(res.body);
    }
  } finally {
    await ctx.cleanup();
  }
});
