import { expect, test } from "bun:test";
import {
  bearer,
  createTestApp,
  seedSession,
  type TestApp,
} from "@torrix/server/testing";

async function seedRun(ctx: TestApp, userId: string, projectId: string, agentName: string): Promise<void> {
  await ctx.repos.runs.save({
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name: `${agentName} run`,
    agent_name: agentName,
    model: "gpt-4o",
    provider: "openai",
    status: 200,
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.001,
    latency_ms: 100,
    created_at: new Date().toISOString(),
  });
}

async function seedAgent(ctx: TestApp, userId: string, name: string, slug: string, status: "active" | "suspended" = "active"): Promise<void> {
  const now = new Date().toISOString();
  await ctx.repos.agents.create({
    id: crypto.randomUUID(),
    user_id: userId,
    slug,
    name,
    description: null,
    owner_user_id: null,
    business_owner: null,
    purpose: null,
    environment: "production",
    status,
    model: null,
    provider: null,
    identity_provider: null,
    external_subject: null,
    tags: null,
    risk_level: null,
    expires_at: null,
    revoked_at: null,
    revoked_reason: null,
    created_at: now,
    updated_at: now,
  });
}

test("governed coverage joins observed traffic with the active registry", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Coverage", created_at: new Date().toISOString() });
    await seedRun(ctx, session.user.id, projectId, "Procurement Agent");
    await seedRun(ctx, session.user.id, projectId, "Shadow Agent");
    await seedRun(ctx, session.user.id, projectId, "Shadow Agent");
    await seedAgent(ctx, session.user.id, "Procurement Agent", "procurement-agent");
    await seedAgent(ctx, session.user.id, "Idle Agent", "idle-agent");
    await seedAgent(ctx, session.user.id, "Suspended Agent", "suspended-agent", "suspended");

    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/coverage", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const coverage = (res.json() as { coverage: {
      observed: number;
      governed: number;
      covered: number;
      coverage_percent: number;
      uncovered: Array<{ name: string; runs: number }>;
      registered_without_traffic: Array<{ name: string }>;
    } }).coverage;
    expect(coverage.observed).toBe(2);
    expect(coverage.governed).toBe(2);
    expect(coverage.covered).toBe(1);
    expect(coverage.coverage_percent).toBe(50);
    expect(coverage.uncovered).toEqual([expect.objectContaining({ name: "Shadow Agent", runs: 2 })]);
    expect(coverage.registered_without_traffic.map((agent) => agent.name)).toEqual(["Idle Agent"]);
  } finally {
    await ctx.cleanup();
  }
});

test("coverage is zero when there is no agent-attributed traffic", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/coverage", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { coverage: { observed: number; covered: number; coverage_percent: number; uncovered: unknown[] } }).coverage).toMatchObject({
      observed: 0,
      covered: 0,
      coverage_percent: 0,
      uncovered: [],
    });
  } finally {
    await ctx.cleanup();
  }
});
