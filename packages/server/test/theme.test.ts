import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

function runFixture(userId: string): Run {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    name: "theme contract run",
    model: "gpt-4o",
    provider: "openai",
    input_tokens: 10,
    output_tokens: 4,
    cost_usd: 0.001,
    latency_ms: 120,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
  } as unknown as Run;
}

test("theme toggle contract: login, console and public share expose the one-click switch", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const run = runFixture(session.user.id);
    await ctx.repos.runs.save(run);

    const login = await ctx.app.inject({ method: "GET", url: "/ui/login" });
    expect(login.statusCode).toBe(200);
    const loginHtml = login.body;
    expect(loginHtml).toContain('data-theme-toggle');
    expect(loginHtml).toContain("torrix_theme");
    expect(loginHtml).toContain('torrixApplyTheme');
    expect(loginHtml).toContain('[data-theme="dark"]');
    expect(loginHtml).toContain("prefers-color-scheme: dark");
    expect(loginHtml).toContain('name="color-scheme" content="light dark"');

    const dashboard = await ctx.app.inject({ method: "GET", url: "/ui/dashboard", headers: bearer(session.key) });
    expect(dashboard.statusCode).toBe(200);
    const consoleHtml = dashboard.body;
    expect(consoleHtml).toContain('class="theme-toggle"');
    expect(consoleHtml).toContain('class="theme-toggle side-theme"');
    expect(consoleHtml).toContain("torrixToggleTheme");
    expect(consoleHtml).toContain("--heading:#f4f7ff");
    expect(consoleHtml).toContain("color-scheme:dark");

    const share = await ctx.app.inject({ method: "POST", url: `/api/runs/${run.id}/share`, headers: bearer(session.key), payload: {} });
    expect(share.statusCode).toBe(200);
    const token = (share.json() as { share_token: string }).share_token;
    const sharePage = await ctx.app.inject({ method: "GET", url: `/share/${token}` });
    expect(sharePage.statusCode).toBe(200);
    expect(sharePage.body).toContain('data-theme-toggle');
    expect(sharePage.body).toContain("torrixToggleTheme");
    expect(sharePage.body).toContain('noindex,nofollow');
    expect(sharePage.body).toContain('[data-theme="dark"]');
  } finally {
    await ctx.cleanup();
  }
});
