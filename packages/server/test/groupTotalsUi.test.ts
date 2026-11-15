import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession } from "./helpers";

test.skipIf(!browserPath)("session headers use whole-group totals and label the loaded page", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Group totals", created_at: new Date().toISOString() });
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    for (let i = 0; i < 250; i += 1) {
      await ctx.repos.runs.save({
        id: crypto.randomUUID(),
        user_id: session.user.id,
        project_id: projectId,
        name: `turn ${i}`,
        session_id: "long-session",
        trace_id: `trace-${i}`,
        status: i === 249 ? 500 : 200,
        source: "sdk",
        input_tokens: 10,
        output_tokens: 5,
        cost_usd: 0.001,
        latency_ms: 100,
        created_at: new Date(base + i * 1000).toISOString(),
      } as Run);
    }
    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);
    await page.goto(`${origin}/ui/sessions/long-session`, "document.body.innerText.includes('this page: 50 of 250')", "session totals");
    const text = await page.eval<string>("document.body.innerText");
    expect(text).toContain("250 runs captured");
    expect(text).toContain("this page: 50 of 250");
    expect(text).toContain("$0.25");
    expect(text).toContain("3.8K");
    expect(text).toContain("1");
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
