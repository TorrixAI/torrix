import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { calculateCost } from "../src/lib/pricing";
import { recommendSavings } from "../src/lib/savings";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(
  ctx: TestApp,
  userId: string,
  fields: { name?: string; prompt_compression?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({
    id,
    user_id: userId,
    name: fields.name ?? "Savings project",
    created_at: new Date().toISOString(),
    prompt_compression: fields.prompt_compression ?? null,
  });
  return id;
}

async function seedRun(ctx: TestApp, userId: string, projectId: string, fields: Partial<Run> = {}): Promise<Run> {
  const run = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name: "savings seed",
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 1_000,
    output_tokens: 100,
    cost_usd: calculateCost("gpt-4o", 1_000, 100),
    latency_ms: 200,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
    ...fields,
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  return run;
}

test("prompt cache and model switch estimates rank by monthly impact", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    for (let i = 0; i < 4; i += 1) {
      await seedRun(ctx, session.user.id, projectId, {
        prompt_hash: "shared-prompt-hash",
        model: "gpt-4o",
        input_tokens: 5_000,
        output_tokens: 50,
        cost_usd: calculateCost("gpt-4o", 5_000, 50),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }

    const recs = await recommendSavings(ctx.repos, session.user.id, { days: 30 });
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < recs.length; i += 1) {
      expect(recs[i - 1].monthly_usd).toBeGreaterThanOrEqual(recs[i].monthly_usd);
    }
    expect(recs.every((item) => item.monthly_usd > 0.01)).toBe(true);
    expect(recs.length).toBeLessThanOrEqual(10);

    const cache = recs.find((item) => item.kind === "prompt_cache");
    expect(cache).toBeTruthy();
    // 3 repeat calls x 5000 input tokens x $2.50/M x 50% cache discount
    expect(cache!.monthly_usd).toBeCloseTo(0.0188, 3);
    expect(cache!.confidence).toBe("medium");
    expect(cache!.evidence.runs).toBe(4);
    expect(cache!.evidence.run_ids).toHaveLength(4);
    expect(cache!.detail).toContain("50% cached-input discount");

    const modelSwitch = recs.find((item) => item.kind === "model_switch");
    expect(modelSwitch).toBeTruthy();
    // 4 runs x $0.013 recorded vs 4 x gpt-4o-mini list price ($0.00078)
    expect(modelSwitch!.monthly_usd).toBeCloseTo(0.0489, 3);
    expect(modelSwitch!.confidence).toBe("low");
    expect(modelSwitch!.detail).toContain("Estimate only");

    expect(recs[0].id).toBe(modelSwitch!.id);
    expect(recs[0].monthly_usd).toBeGreaterThanOrEqual(cache!.monthly_usd);
  } finally {
    await ctx.cleanup();
  }
});

test("compression separates realized savings from the enablement opportunity", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const offProject = await seedProject(ctx, session.user.id, { name: "Compression off", prompt_compression: null });
    for (let i = 0; i < 5; i += 1) {
      await seedRun(ctx, session.user.id, offProject, {
        model: "gpt-4o",
        input_tokens: 10_000,
        output_tokens: 50,
        cost_usd: calculateCost("gpt-4o", 10_000, 50),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }
    const balancedProject = await seedProject(ctx, session.user.id, { name: "Compression on", prompt_compression: "balanced" });
    for (let i = 0; i < 2; i += 1) {
      await seedRun(ctx, session.user.id, balancedProject, {
        model: "gpt-4o",
        input_tokens: 10_000,
        output_tokens: 50,
        original_input_tokens: 20_000,
        cost_usd: calculateCost("gpt-4o", 10_000, 50),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }

    const recs = await recommendSavings(ctx.repos, session.user.id, { days: 30 });

    const opportunity = recs.find((item) => item.id === "compression-opportunity");
    expect(opportunity).toBeTruthy();
    // 5 x 10000 input tokens x $2.50/M x 10% conservative recovery
    expect(opportunity!.monthly_usd).toBeCloseTo(0.0125, 4);
    expect(opportunity!.confidence).toBe("low");
    expect(opportunity!.evidence.runs).toBe(5);
    expect(opportunity!.detail).toContain("10% input reduction");

    const realized = recs.find((item) => item.id === "compression-realized");
    expect(realized).toBeTruthy();
    // 2 x (20000 - 10000) input tokens x $2.50/M
    expect(realized!.monthly_usd).toBeCloseTo(0.05, 4);
    expect(realized!.confidence).toBe("high");
    expect(realized!.evidence.runs).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

test("insights page renders the savings panel and top figure", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    for (let i = 0; i < 4; i += 1) {
      await seedRun(ctx, session.user.id, projectId, {
        prompt_hash: "page-hash",
        model: "gpt-4o",
        input_tokens: 5_000,
        output_tokens: 50,
        cost_usd: calculateCost("gpt-4o", 5_000, 50),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }
    const res = await ctx.app.inject({ method: "GET", url: "/ui/insights", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Savings opportunities");
    expect(res.body).toContain("Savings found");
    expect(res.body).toContain("in-conf");
    expect(res.body).toMatch(/\$\d+(\.\d+)?\/mo/);
    expect(res.body).toContain("View runs");
  } finally {
    await ctx.cleanup();
  }
});

test("savings endpoint returns an empty report with no data", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const empty = await recommendSavings(ctx.repos, session.user.id);
    expect(empty).toEqual([]);

    const res = await ctx.app.inject({ method: "GET", url: "/api/insights/savings", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { window_days: number; total_monthly_usd: number; recommendations: unknown[] };
    expect(body.window_days).toBe(30);
    expect(body.total_monthly_usd).toBe(0);
    expect(body.recommendations).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});

test("savings endpoint returns ranked recommendations and honors the project filter", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectA = await seedProject(ctx, session.user.id, { name: "A" });
    const projectB = await seedProject(ctx, session.user.id, { name: "B" });
    for (let i = 0; i < 3; i += 1) {
      await seedRun(ctx, session.user.id, projectA, {
        prompt_hash: "endpoint-hash",
        model: "gpt-4o",
        input_tokens: 8_000,
        output_tokens: 100,
        cost_usd: calculateCost("gpt-4o", 8_000, 100),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }
    for (let i = 0; i < 5; i += 1) {
      await seedRun(ctx, session.user.id, projectB, {
        model: "claude-opus-4",
        input_tokens: 1_000,
        output_tokens: 100,
        cost_usd: calculateCost("claude-opus-4", 1_000, 100),
        created_at: new Date(Date.now() - i * 1_000).toISOString(),
      });
    }

    const all = await ctx.app.inject({ method: "GET", url: "/api/insights/savings?days=30", headers: bearer(session.key) });
    expect(all.statusCode).toBe(200);
    const body = all.json() as {
      window_days: number;
      total_monthly_usd: number;
      recommendations: Array<{
        id: string;
        kind: string;
        title: string;
        detail: string;
        monthly_usd: number;
        confidence: string;
        evidence: { runs?: number; models?: string[]; run_ids?: string[] };
      }>;
    };
    expect(body.window_days).toBe(30);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.total_monthly_usd).toBeGreaterThan(0);
    expect(body.total_monthly_usd).toBeCloseTo(
      body.recommendations.reduce((sum, item) => sum + item.monthly_usd, 0),
      3,
    );
    for (const item of body.recommendations) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(["slm_downshift", "prompt_cache", "compression", "model_switch"]).toContain(item.kind);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.monthly_usd).toBeGreaterThan(0.01);
      expect(["high", "medium", "low"]).toContain(item.confidence);
      expect(item.evidence).toBeTruthy();
    }

    const filtered = await ctx.app.inject({
      method: "GET",
      url: `/api/insights/savings?days=30&project=${projectB}`,
      headers: bearer(session.key),
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = filtered.json() as {
      window_days: number;
      recommendations: Array<{ evidence: { models?: string[] } }>;
    };
    expect(filteredBody.window_days).toBe(30);
    expect(filteredBody.recommendations.length).toBeGreaterThan(0);
    expect(filteredBody.recommendations.every((item) => item.evidence.models?.includes("claude-opus-4"))).toBe(true);

    const week = await ctx.app.inject({ method: "GET", url: "/api/insights/savings?days=7", headers: bearer(session.key) });
    expect(week.json().window_days).toBe(7);

    const bogus = await ctx.app.inject({
      method: "GET",
      url: "/api/insights/savings?project=not-a-project",
      headers: bearer(session.key),
    });
    expect(bogus.statusCode).toBe(200);
    expect(bogus.json().window_days).toBe(30);
    expect(bogus.json().recommendations.length).toBeGreaterThan(0);
  } finally {
    await ctx.cleanup();
  }
});
