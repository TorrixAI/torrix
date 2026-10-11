import { expect, test } from "bun:test";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function saveRun(ctx: TestApp, userId: string, fields: Record<string, unknown>): Promise<void> {
  await ctx.repos.runs.save(
    buildRunRow({ id: crypto.randomUUID(), user_id: userId, project_id: "p", model: "m", status: 200, ...fields } as never),
  );
}

test("integrations page shows every card with this instance's URL and a key placeholder", async () => {
  const ctx = await createTestApp({ TORRIX_PLUGIN_MARKETPLACE: "acme/torrix-plugins" });
  try {
    const session = await seedSession(ctx);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/ui/integrations",
      headers: { ...bearer(session.key), host: "torrix.internal:9000", "x-forwarded-proto": "https" },
    });
    expect(res.statusCode).toBe(200);
    for (const id of ["claude-code", "opencode", "sdk", "proxy", "otel"]) {
      expect(res.body).toContain(`data-int="${id}"`);
    }
    expect(res.body).toContain("claude plugin install torrix --marketplace acme/torrix-plugins --config api_key=trxk_YOUR_KEY --config base_url=https://torrix.internal:9000");
    expect(res.body).toContain("https://torrix.internal:9000/v1/traces");
    expect(res.body).toContain('href="/ui/integrations"');
    expect(res.body).toContain("Waiting for first run");
    expect(res.body).not.toContain("—");
  } finally {
    await ctx.cleanup();
  }
});

test("without a configured marketplace the Claude Code card still offers an install command", async () => {
  const ctx = await createTestApp({ TORRIX_PLUGIN_MARKETPLACE: "" });
  try {
    const session = await seedSession(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/ui/integrations", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/--marketplace (\S+)/);
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
    expect(page.body).toContain("Connected · last run");
    expect(page.body).toContain("2 runs in 24h");
  } finally {
    await ctx.cleanup();
  }
});

test("commands come in macOS/Linux and Windows PowerShell variants, defaulting to the visitor's OS", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const page = async (userAgent: string) =>
      (await ctx.app.inject({ method: "GET", url: "/ui/integrations", headers: { ...bearer(session.key), "user-agent": userAgent } })).body;

    const windows = await page("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(windows).toContain('class="int-page" data-shell="powershell"');
    expect(windows).toContain("Invoke-RestMethod -Method Post");
    expect(windows).toContain("setx TORRIX_API_KEY &quot;trxk_YOUR_KEY&quot;");
    expect(windows).toContain("$env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
    expect(windows).toContain("curl http://localhost:80/proxy/chat/completions");

    const mac = await page("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
    expect(mac).toContain('class="int-page" data-shell="posix"');
    expect(mac.match(/int-code" data-variant="posix"/g)?.length).toBe(mac.match(/int-code" data-variant="powershell"/g)?.length);
    expect(windows).toContain("irm https://claude.ai/install.ps1 | iex");
    expect(windows).toContain("Open Windows PowerShell, not Command Prompt.");
  } finally {
    await ctx.cleanup();
  }
});
