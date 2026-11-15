import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

test("group totals cover every run in a session, not just the loaded page", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Group totals", created_at: new Date().toISOString() });
    const base = Date.parse("2026-10-01T00:00:00.000Z");
    for (let i = 0; i < 250; i += 1) {
      const run = {
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
      } as Run;
      await ctx.repos.runs.save(run);
    }

    const res = await ctx.app.inject({ method: "GET", url: "/api/runs/group/session/long-session?limit=50", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      runs: Run[];
      total: number;
      totals?: { runs: number; cost: number; tokens: number; errors: number; agents: number; subagents: number };
    };
    expect(body.runs.length).toBe(50);
    expect(body.total).toBe(250);
    expect(body.totals?.runs).toBe(250);
    expect(body.totals?.cost).toBeCloseTo(0.25, 6);
    expect(body.totals?.tokens).toBe(3_750);
    expect(body.totals?.errors).toBe(1);
    expect(body.totals?.subagents).toBe(0);
  } finally {
    await ctx.cleanup();
  }
});
