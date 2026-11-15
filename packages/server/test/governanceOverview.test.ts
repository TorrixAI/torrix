import { expect, test } from "bun:test";
import type { Policy, ReviewItem, Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession } from "./helpers";

test("governance overview reports the last seven days for the status strip", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Governance", created_at: new Date().toISOString() });
    const now = new Date().toISOString();
    const policy: Policy = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      name: "No secrets",
      enabled: 1,
      action: "flag",
      stage: "request",
      match_kind: "keyword",
      match_value: "secret",
      severity: "high",
      hit_count: 3,
      last_hit_at: now,
      created_at: now,
      updated_at: now,
    };
    await ctx.repos.governance.createPolicy(policy);
    const review: ReviewItem = {
      id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      state: "pending",
      reviewer_user_id: null,
      note: null,
      created_at: now,
      decided_at: null,
    };
    await ctx.repos.governance.enqueueReview(review);
    for (let i = 0; i < 2; i += 1) {
      await ctx.repos.runs.save({
        id: crypto.randomUUID(),
        user_id: session.user.id,
        project_id: projectId,
        name: `masked ${i}`,
        status: 200,
        source: "sdk",
        pii_masked: 1,
        policy_flags: i === 0 ? JSON.stringify([{ policy: "No secrets" }]) : null,
        created_at: now,
      } as Run);
    }

    const res = await ctx.app.inject({ method: "GET", url: "/api/governance/overview", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { window_days: number; overview: { rules: number; hits: number; reviews: number; masked: number } };
    expect(body.window_days).toBe(7);
    expect(body.overview.rules).toBe(1);
    expect(body.overview.hits).toBe(1);
    expect(body.overview.reviews).toBe(1);
    expect(body.overview.masked).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});
