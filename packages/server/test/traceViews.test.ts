import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function save(ctx: TestApp, userId: string, projectId: string, fields: Record<string, unknown>): Promise<void> {
  await ctx.repos.runs.save({ user_id: userId, project_id: projectId, status: 200, source: "sdk", ...fields } as never);
}

test("a trace opens with a turn summary, branch totals and the error text of failed steps", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const t0 = Date.parse("2026-10-11T09:00:00.000Z");
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    await save(ctx, session.user.id, projectId, {
      id: "root", name: "plan", trace_id: "turn-a", session_id: "chat", agent_name: "planner", cost_usd: 0.01, latency_ms: 2000, created_at: at(0),
      request_body: JSON.stringify({ messages: [{ role: "user", content: "Refund order 42 and email the customer" }] }),
    });
    await save(ctx, session.user.id, projectId, { id: "search", name: "lookup order", trace_id: "turn-a", parent_run_id: "root", agent_name: "search", cost_usd: 0.002, latency_ms: 1000, created_at: at(3) });
    await save(ctx, session.user.id, projectId, {
      id: "refund", name: "issue refund", trace_id: "turn-a", parent_run_id: "search", agent_name: "search", status: 502, error: "upstream_error: payments API timed out", latency_ms: 5000, created_at: at(5),
    });

    const res = await ctx.app.inject({ method: "GET", url: "/ui/traces/turn-a", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Refund order 42 and email the customer");
    expect(res.body).toContain("10.00s wall clock");
    expect(res.body).toContain("First failure:");
    expect(res.body).toContain("payments API timed out");
    expect(res.body).toContain("branch · 3 calls · $0.012 · 1 error");
    expect(res.body).toContain("<th class=\"num\">Duration</th>");
    expect(res.body).not.toContain("subagent · <a");
  } finally {
    await ctx.cleanup();
  }
});

test("a session lists one row per turn and opens on its latest page", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const t0 = Date.parse("2026-10-11T09:00:00.000Z");
    for (let i = 0; i < 205; i += 1) {
      await save(ctx, session.user.id, projectId, {
        id: `run-${i}`, name: `step ${i}`, session_id: "long-chat", trace_id: `turn-${Math.floor(i / 100)}`, created_at: new Date(t0 + i * 1000).toISOString(),
      });
    }
    const latest = await ctx.app.inject({ method: "GET", url: "/ui/sessions/long-chat", headers: bearer(session.key) });
    expect(latest.body).toContain("Showing runs 201 to 205 of 205");
    expect(latest.body).toContain("step 204");
    expect(latest.body).not.toContain(">step 3<");
    const first = await ctx.app.inject({ method: "GET", url: "/ui/sessions/long-chat?page=1", headers: bearer(session.key) });
    expect(first.body).toContain("Showing runs 1 to 200 of 205");
    expect(first.body).toContain("Turns");
    expect(first.body).toContain('href="/ui/traces/turn-0"');
    expect(first.body).toContain('href="/ui/traces/turn-1"');
  } finally {
    await ctx.cleanup();
  }
});
