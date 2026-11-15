import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

test("dashboard daily series fills quiet days in the requested window", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Series", created_at: new Date().toISOString() });
    await ctx.repos.runs.save({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      name: "one active day",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.001,
      latency_ms: 120,
      status: 200,
      source: "sdk",
      is_anomaly: 1,
      created_at: "2026-11-05T12:00:00.000Z",
    } as unknown as Run);
    await ctx.repos.runs.save({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      name: "previous window",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.002,
      latency_ms: 120,
      status: 200,
      source: "sdk",
      created_at: "2026-10-27T12:00:00.000Z",
    } as unknown as Run);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/dashboard?from=2026-11-01T00:00:00.000Z&to=2026-11-10T23:59:59.999Z",
      headers: bearer(session.key),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      perDay: Array<{ date: string; runs: number; anomalies: number; cost: number }>;
      perDayPrevious: Array<{ date: string; cost: number }>;
    };
    const perDay = body.perDay;
    expect(perDay).toHaveLength(10);
    expect(perDay[0]).toMatchObject({ date: "2026-11-01", runs: 0 });
    expect(perDay[4]).toMatchObject({ date: "2026-11-05", runs: 1, anomalies: 1 });
    expect(perDay[9]).toMatchObject({ date: "2026-11-10", runs: 0 });
    expect(body.perDayPrevious).toHaveLength(10);
    expect(body.perDayPrevious.map((day) => day.date)).toEqual(perDay.map((day) => day.date));
    expect(body.perDayPrevious.reduce((sum, day) => sum + day.cost, 0)).toBeCloseTo(0.002, 6);
  } finally {
    await ctx.cleanup();
  }
});
