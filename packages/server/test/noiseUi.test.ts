import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession, type TestApp } from "./helpers";

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

async function project(ctx: TestApp, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Noise", created_at: new Date().toISOString() });
  return id;
}

test.skipIf(!browserPath)("cost hides unused keys until asked and the runs KPI waits for ten scores", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const projectId = await project(ctx, session.user.id);
    const now = new Date().toISOString();
    for (const entry of [
      { name: "small-key", cost: 0.5 },
      { name: "large-key", cost: 2.5 },
      { name: "unused-key", cost: 0 },
    ]) {
      const id = crypto.randomUUID();
      await ctx.repos.apiKeys.create({
        id, user_id: session.user.id, name: entry.name, key_hash: `hash-${id}`, key_prefix: `trxk_${id.slice(0, 6)}`,
        scope: "full", projects: null, permission: "read_write", created_at: now, last_used_at: null, revoked_at: null,
        budget_usd: null, hard_cap_usd: null,
      });
      if (entry.cost > 0) {
        await ctx.repos.runs.save(run({ id: crypto.randomUUID(), user_id: session.user.id, project_id: projectId, api_key_id: id, cost_usd: entry.cost }));
      }
    }
    for (let i = 0; i < 3; i += 1) {
      await ctx.repos.runs.save(run({ id: crypto.randomUUID(), user_id: session.user.id, project_id: projectId, score: 1, scored_at: now, cost_usd: 0.01 }));
    }

    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);
    await page.goto(`${origin}/ui/cost`, "document.body.innerText.includes('Spend by scope')", "cost page");
    let text = await page.eval<string>("document.body.innerText");
    expect(text).not.toContain("unused-key");
    expect(text).toContain("small-key");
    expect(text).toContain("$0.5000");
    expect(text).toContain("$2.50");
    await page.eval("document.getElementById('co-show-unused').click()");
    await page.waitFor("document.body.innerText.includes('unused-key')", "unused key shown");
    text = await page.eval<string>("document.body.innerText");
    expect(text).toContain("unused-key");

    await page.goto(`${origin}/ui/runs`, "document.body.innerText.toLowerCase().includes('scored runs')", "runs scored KPI");
    text = await page.eval<string>("document.body.innerText");
    expect(text.toLowerCase()).toContain("scored runs");
    expect(text).toContain("3 scored");
    expect(text.toLowerCase()).not.toContain("mean eval score");

    for (let i = 0; i < 7; i += 1) {
      await ctx.repos.runs.save(run({ id: crypto.randomUUID(), user_id: session.user.id, project_id: projectId, score: 1, scored_at: now }));
    }
    await page.goto(`${origin}/ui/runs`, "document.body.innerText.toLowerCase().includes('mean eval score')", "runs mean KPI");
    text = await page.eval<string>("document.body.innerText");
    expect(text.toLowerCase()).toContain("mean eval score");
    expect(text).not.toContain("3 scored");
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
