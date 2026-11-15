import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

function runRow(overrides: Partial<Run> & { id: string; user_id: string; project_id: string }): Run {
  return {
    name: "first prompt",
    status: 200,
    source: "sdk",
    provider: "anthropic",
    model: "claude-sonnet",
    input_tokens: 10,
    output_tokens: 5,
    latency_ms: 100,
    cost_usd: 0.001,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Run;
}

async function addEvent(ctx: TestApp, runId: string, type: string, message: string, createdAt = new Date().toISOString()) {
  await ctx.repos.events.add({ id: crypto.randomUUID(), run_id: runId, type, message, created_at: createdAt });
}

async function projectFor(ctx: TestApp, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Console clarity", created_at: new Date().toISOString() });
  return id;
}

test("the runs API carries step labels and chooses trace grouping for multi-run traffic", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await projectFor(ctx, session.user.id);
    const traceId = "trace-labels";
    const base = Date.parse("2026-10-25T10:00:00.000Z");
    const specs = [
      { tool: { name: "Edit", arguments: { file_path: "packages/server/src/lib/x.ts" } }, extra: { name: "Bash", arguments: { command: "bun run typecheck" } } },
      { tool: { name: "Bash", arguments: { command: "bun test" } } },
      { tool: { name: "Read", arguments: { file_path: "engine.ts" } } },
    ];
    for (let i = 0; i < specs.length; i += 1) {
      const id = crypto.randomUUID();
      const run = runRow({
        id,
        user_id: session.user.id,
        project_id: projectId,
        trace_id: traceId,
        created_at: new Date(base + i * 1000).toISOString(),
      });
      await ctx.repos.runs.save(run);
      await addEvent(ctx, id, "request", JSON.stringify({ messages: [{ role: "user", content: "first prompt" }] }), run.created_at);
      await addEvent(ctx, id, "tool_call", JSON.stringify([specs[i].tool]), run.created_at);
      if (specs[i].extra) {
        await addEvent(ctx, id, "tool_call", JSON.stringify([specs[i].extra]), new Date(base + 500).toISOString());
      }
    }

    const grouped = await ctx.app.inject({ method: "GET", url: "/api/runs?limit=50", headers: bearer(session.key) });
    expect(grouped.statusCode).toBe(200);
    const groupedBody = grouped.json() as { group: string; run_total: number; groups?: Array<{ id: string; runs: number }>; firstTools?: Array<{ runId: string; message: string }> };
    expect(groupedBody.group).toBe("trace");
    expect(groupedBody.run_total).toBe(3);
    expect(groupedBody.groups?.[0]?.id).toBe(traceId);
    expect(groupedBody.groups?.[0]?.runs).toBe(3);
    expect(groupedBody.firstTools?.length).toBe(3);
    expect(groupedBody.firstTools?.find((entry) => entry.message.includes("Edit"))?.message).toContain("packages/server/src/lib/x.ts");

    const flat = await ctx.app.inject({ method: "GET", url: "/api/runs?group=none&limit=50", headers: bearer(session.key) });
    expect(flat.statusCode).toBe(200);
    expect((flat.json() as { group: string }).group).toBe("none");
    expect((flat.json() as { firstTools?: unknown[] }).firstTools?.length).toBe(3);

    const group = await ctx.app.inject({ method: "GET", url: `/api/runs/group/trace/${traceId}?limit=2`, headers: bearer(session.key) });
    expect(group.statusCode).toBe(200);
    const groupBody = group.json() as { runs: Run[]; total: number; totals?: { runs: number; cost: number; tokens: number; errors: number }; firstTools?: unknown[] };
    expect(groupBody.runs.length).toBe(2);
    expect(groupBody.total).toBe(3);
    expect(groupBody.totals?.runs).toBe(3);
    expect(groupBody.totals?.cost).toBeCloseTo(0.003, 6);
    expect(groupBody.totals?.tokens).toBe(45);
    expect(groupBody.firstTools?.length).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

test("a single-run dataset stays flat without an explicit group", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await projectFor(ctx, session.user.id);
    await ctx.repos.runs.save(runRow({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      trace_id: "single-trace",
    }));
    const res = await ctx.app.inject({ method: "GET", url: "/api/runs?limit=50", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { group: string; runs: Run[]; run_total: number };
    expect(body.group).toBe("none");
    expect(body.runs.length).toBe(1);
    expect(body.run_total).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
