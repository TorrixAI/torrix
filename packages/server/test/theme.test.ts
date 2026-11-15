import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, expectSpaShell, seedSession } from "./helpers";

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

test("theme contract: the console shell boots the stored theme and the stylesheet carries both themes", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const run = runFixture(session.user.id);
    await ctx.repos.runs.save(run);

    // Every console surface serves the same SPA shell, whose inline boot reads
    // the stored theme before paint.
    for (const res of [
      await ctx.app.inject({ method: "GET", url: "/ui/login" }),
      await ctx.app.inject({ method: "GET", url: "/ui/dashboard", headers: bearer(session.key) }),
    ]) {
      expect(res.statusCode).toBe(200);
      expectSpaShell(res.body);
      expect(res.body).toContain("torrix_theme");
      expect(res.body).toContain("prefers-color-scheme: dark");
      expect(res.body).toContain('name="color-scheme" content="light dark"');
    }

    const share = await ctx.app.inject({ method: "POST", url: `/api/runs/${run.id}/share`, headers: bearer(session.key), payload: {} });
    expect(share.statusCode).toBe(200);
    const token = (share.json() as { share_token: string }).share_token;
    const sharePage = await ctx.app.inject({ method: "GET", url: `/share/${token}` });
    expect(sharePage.statusCode).toBe(200);
    expectSpaShell(sharePage.body);
    expect(sharePage.body).toContain("noindex,nofollow");

    // The one-click switch and the dark tokens live in the bundled stylesheet.
    const asset = /\/assets\/[^"]+\.css/.exec(sharePage.body)?.[0];
    expect(asset).toBeTruthy();
    const css = await ctx.app.inject({ method: "GET", url: asset! });
    expect(css.statusCode).toBe(200);
    expect(css.body).toMatch(/\[data-theme=("dark"|dark)\]/);
    expect(css.body).toContain("--heading:#f4f6f9");
    expect(css.body).toContain("--bg:#f6f5f1");
    expect(css.body).toContain("--bg:#0e1114");
    expect(css.body).toContain("color-scheme:dark");
  } finally {
    await ctx.cleanup();
  }
});
