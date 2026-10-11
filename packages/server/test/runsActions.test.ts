import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(ctx: TestApp, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Default", created_at: new Date().toISOString() });
  return id;
}

async function seedRun(ctx: TestApp, userId: string, projectId: string, fields: Partial<Run> = {}): Promise<Run> {
  const now = new Date().toISOString();
  const run = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name: "actions run",
    provider: "openai",
    model: "gpt-4o-mini",
    input_tokens: 100,
    output_tokens: 25,
    cost_usd: 0.002,
    latency_ms: 150,
    status: 200,
    source: "proxy",
    request_body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello there" }] }),
    created_at: now,
    ...fields,
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  await ctx.repos.events.addMany([
    { id: crypto.randomUUID(), run_id: run.id, type: "request", message: run.request_body ?? "", created_at: now },
    { id: crypto.randomUUID(), run_id: run.id, type: "response", message: "general kenobi", created_at: now },
  ]);
  return run;
}

test("run list filters and sort", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await seedRun(ctx, session.user.id, projectId, { name: "cheap", cost_usd: 0.001, provider: "openai", tags: JSON.stringify({ team: "core" }), end_user_id: "user-42" });
    await seedRun(ctx, session.user.id, projectId, { name: "expensive", cost_usd: 0.5, provider: "anthropic", tags: JSON.stringify({ team: "growth" }) });
    await seedRun(ctx, session.user.id, projectId, { name: "boom", status: 500, is_golden: 1 });

    const byProvider = await ctx.app.inject({ method: "GET", url: "/api/runs?provider=anthropic", headers: bearer(session.key) });
    expect(byProvider.json().runs.map((r: Run) => r.name)).toEqual(["expensive"]);

    const errors = await ctx.app.inject({ method: "GET", url: "/api/runs?status=error", headers: bearer(session.key) });
    expect(errors.json().runs.map((r: Run) => r.name)).toEqual(["boom"]);

    const golden = await ctx.app.inject({ method: "GET", url: "/api/runs?is_golden=1", headers: bearer(session.key) });
    expect(golden.json().runs.map((r: Run) => r.name)).toEqual(["boom"]);

    const byTag = await ctx.app.inject({ method: "GET", url: "/api/runs?tag=growth", headers: bearer(session.key) });
    expect(byTag.json().runs.map((r: Run) => r.name)).toEqual(["expensive"]);

    const byEndUser = await ctx.app.inject({ method: "GET", url: "/api/runs?end_user=user-42", headers: bearer(session.key) });
    expect(byEndUser.json().runs.map((r: Run) => r.name)).toEqual(["cheap"]);

    const sorted = await ctx.app.inject({ method: "GET", url: "/api/runs?sort=cost&dir=asc", headers: bearer(session.key) });
    expect(sorted.json().runs.map((r: Run) => r.name)).toEqual(["cheap", "boom", "expensive"]);
    const sortedDesc = await ctx.app.inject({ method: "GET", url: "/api/runs?sort=cost&dir=desc", headers: bearer(session.key) });
    expect(sortedDesc.json().runs[0].name).toBe("expensive");
  } finally {
    await ctx.cleanup();
  }
});

test("bulk score and delete with caps", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    const a = await seedRun(ctx, session.user.id, projectId, { name: "a" });
    const b = await seedRun(ctx, session.user.id, projectId, { name: "b" });

    const scored = await ctx.app.inject({
      method: "POST",
      url: "/api/runs/bulk",
      headers: bearer(session.key),
      payload: { action: "score", ids: [a.id, b.id], score: "good", note: "batch" },
    });
    expect(scored.statusCode).toBe(200);
    expect(scored.json().updated).toBe(2);
    expect((await ctx.repos.runs.getById(a.id, session.user.id))?.score).toBe(1);

    const tooMany = await ctx.app.inject({
      method: "POST",
      url: "/api/runs/bulk",
      headers: bearer(session.key),
      payload: { action: "delete", ids: Array.from({ length: 501 }, () => crypto.randomUUID()) },
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toBe("too_many_ids");

    const deleted = await ctx.app.inject({
      method: "POST",
      url: "/api/runs/bulk",
      headers: bearer(session.key),
      payload: { action: "delete", ids: [a.id] },
    });
    expect(deleted.json().deleted).toBe(1);
    expect(await ctx.repos.runs.getById(a.id, session.user.id)).toBeNull();
    expect(await ctx.repos.events.listByRun(a.id)).toHaveLength(0);
  } finally {
    await ctx.cleanup();
  }
});

test("run export formats", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await seedRun(ctx, session.user.id, projectId, { name: "export me" });

    const csv = await ctx.app.inject({ method: "GET", url: "/api/runs/export?format=csv", headers: bearer(session.key) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\n")[0]).toContain("id,created_at,name");
    expect(csv.body).toContain("export me");

    const ndjson = await ctx.app.inject({ method: "GET", url: "/api/runs/export?format=ndjson&include_events=1", headers: bearer(session.key) });
    const nd = JSON.parse(ndjson.body.trim().split("\n")[0]);
    expect(nd.events).toHaveLength(2);

    const jsonl = await ctx.app.inject({ method: "GET", url: "/api/runs/export?format=jsonl", headers: bearer(session.key) });
    const ft = JSON.parse(jsonl.body.trim().split("\n")[0]);
    expect(ft.messages[0]).toEqual({ role: "user", content: "hello there" });
    expect(ft.messages[1]).toEqual({ role: "assistant", content: "general kenobi" });

    const slm = await ctx.app.inject({ method: "GET", url: "/api/runs/export?format=slm", headers: bearer(session.key) });
    const slmRow = JSON.parse(slm.body.trim().split("\n")[0]);
    expect(slmRow.input).toBe("hello there");
    expect(slmRow.output).toBe("general kenobi");
    expect(slmRow.model).toBe("gpt-4o-mini");
  } finally {
    await ctx.cleanup();
  }
});

test("replay reissues the stored request and logs a linked run", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model?: string };
      return Response.json({
        id: "chatcmpl-replay",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "replayed" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    const original = await seedRun(ctx, session.user.id, projectId, {
      target_url: `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
      trace_id: "trace-replay",
      session_id: "session-replay",
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/runs/${original.id}/replay`,
      headers: bearer(session.key),
      payload: { model: "gpt-4o-mini" },
    });
    expect(res.statusCode).toBe(201);
    const replayId = res.json().run_id;
    const replay = await ctx.repos.runs.getById(replayId, session.user.id);
    expect(replay?.name).toContain("replay:");
    expect(replay?.trace_id).toBe("trace-replay");
    expect(JSON.parse(replay?.tags ?? "{}").torrix_replay_of).toBe(original.id);
    expect(replay?.input_tokens).toBe(11);
    const events = await ctx.repos.events.listByRun(replayId);
    expect(events.find((event) => event.type === "response")?.message).toBe("replayed");

    const comparison = await ctx.app.inject({
      method: "GET",
      url: `/api/runs/${original.id}/cost-comparison`,
      headers: bearer(session.key),
    });
    expect(comparison.statusCode).toBe(200);
    const models = comparison.json().models as Array<{ model: string; estimatedCost: number }>;
    expect(models.length).toBeGreaterThan(1);
    expect(models[0].estimatedCost).toBeLessThanOrEqual(models[models.length - 1].estimatedCost);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("compare, analytics, search and insights endpoints", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    const a = await seedRun(ctx, session.user.id, projectId, { agent_name: "research", end_user_id: "u-1", score: 1 });
    const b = await seedRun(ctx, session.user.id, projectId, { agent_name: "builder", end_user_id: "u-2", status: 500, model: "gpt-4o", cost_usd: 0.4 });

    const compare = await ctx.app.inject({ method: "GET", url: `/api/runs/compare?ids=${a.id},${b.id}`, headers: bearer(session.key) });
    expect(compare.statusCode).toBe(200);
    expect(compare.json().runs).toHaveLength(2);
    expect(compare.json().runs[0].events.length).toBe(2);

    const leaderboard = await ctx.app.inject({ method: "GET", url: "/api/analytics/leaderboard?days=7", headers: bearer(session.key) });
    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json().models.length).toBe(2);

    const byAgent = await ctx.app.inject({ method: "GET", url: "/api/analytics/by-agent?days=7", headers: bearer(session.key) });
    expect(byAgent.json().agents.map((r: { key: string }) => r.key).sort()).toEqual(["builder", "research"]);

    const byUser = await ctx.app.inject({ method: "GET", url: "/api/analytics/by-user?days=7", headers: bearer(session.key) });
    expect(byUser.json().end_users).toHaveLength(2);

    const search = await ctx.app.inject({ method: "GET", url: "/api/search?q=actions", headers: bearer(session.key) });
    expect(search.statusCode).toBe(200);
    expect(search.json().total).toBe(2);

    const insights = await ctx.app.inject({ method: "GET", url: "/api/insights/generate?days=7", headers: bearer(session.key) });
    expect(insights.statusCode).toBe(200);
    expect(insights.json().runs).toBe(2);
    expect(Array.isArray(insights.json().highlights)).toBe(true);

    const caching = await ctx.app.inject({ method: "GET", url: "/api/insights/caching", headers: bearer(session.key) });
    expect(caching.statusCode).toBe(200);
    expect(caching.json().runsScanned).toBe(2);

    const slm = await ctx.app.inject({ method: "GET", url: "/api/insights/slm-savings", headers: bearer(session.key) });
    expect(slm.statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("dashboard, analytics and insights include agent and MCP rollups", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await seedRun(ctx, session.user.id, projectId, { agent_name: "research" });
    await seedRun(ctx, session.user.id, projectId, {
      name: "mcp: search_docs",
      provider: "mcp",
      model: null,
      source: "mcp_gateway",
      status: 403,
      cost_usd: 0,
      agent_name: "gateway-agent",
      tags: JSON.stringify({ tool: "search_docs" }),
    });
    await seedRun(ctx, session.user.id, projectId, {
      name: "mcp_proxy: read_file",
      provider: "mcp",
      model: null,
      source: "mcp_proxy",
      status: 202,
      cost_usd: 0,
      agent_name: "mcp-proxy",
    });
    await seedRun(ctx, session.user.id, projectId, {
      name: "mcp: fetch_url",
      provider: "mcp",
      model: null,
      source: "mcp",
      status: 200,
      cost_usd: 0,
      agent_name: "mcp-client",
    });

    const dashboard = await ctx.app.inject({ method: "GET", url: "/api/dashboard", headers: bearer(session.key) });
    expect(dashboard.statusCode).toBe(200);
    const stats = dashboard.json() as {
      byAgent: Array<{ agent: string; runs: number }>;
      mcp: { calls: number; denied: number; pending: number; tools: Array<{ tool: string }> };
    };
    expect(stats.byAgent.map((row) => row.agent)).toContain("gateway-agent");
    expect(stats.mcp.calls).toBe(3);
    expect(stats.mcp.denied).toBe(1);
    expect(stats.mcp.pending).toBe(1);
    expect(stats.mcp.tools.map((row) => row.tool).sort()).toEqual(["fetch_url", "read_file", "search_docs"]);

    const byTool = await ctx.app.inject({ method: "GET", url: "/api/analytics/by-tool?days=7", headers: bearer(session.key) });
    expect(byTool.statusCode).toBe(200);
    expect(byTool.json().tools.map((row: { key: string }) => row.key).sort()).toEqual(["fetch_url", "read_file", "search_docs"]);

    const insights = await ctx.app.inject({ method: "GET", url: "/api/insights/generate?days=7", headers: bearer(session.key) });
    expect(insights.statusCode).toBe(200);
    const report = insights.json() as {
      agents: Array<{ name: string; runs: number }>;
      mcp: { calls: number; denied: number; pending: number };
      highlights: string[];
      actions: Array<{ label: string; href: string }>;
    };
    expect(report.agents.map((row) => row.name)).toContain("gateway-agent");
    expect(report.mcp.calls).toBe(3);
    expect(report.mcp.denied).toBe(1);
    expect(report.mcp.pending).toBe(1);
    expect(report.highlights.some((line) => line.includes("MCP traffic"))).toBe(true);
    expect(report.actions.some((action) => action.href === "/ui/runs?status=error")).toBe(true);
    expect(report.actions.some((action) => action.href === "/ui/runs?source=mcp_gateway")).toBe(true);
    expect(report.actions.some((action) => action.href.startsWith("/ui/runs?agent="))).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

test("SQL console allows read-only and blocks writes", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await seedRun(ctx, session.user.id, projectId, { name: "query target" });

    const ok = await ctx.app.inject({
      method: "POST",
      url: "/api/query",
      headers: bearer(session.key),
      payload: { sql: "SELECT name, cost_usd FROM runs" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rowCount).toBe(1);
    expect(ok.json().columns).toEqual(["name", "cost_usd"]);

    const write = await ctx.app.inject({
      method: "POST",
      url: "/api/query",
      headers: bearer(session.key),
      payload: { sql: "DELETE FROM runs" },
    });
    expect(write.statusCode).toBe(400);
    expect(write.json().error).toBe("select_only");

    const multi = await ctx.app.inject({
      method: "POST",
      url: "/api/query",
      headers: bearer(session.key),
      payload: { sql: "SELECT 1; DROP TABLE runs" },
    });
    expect(multi.statusCode).toBe(400);

    const sneaky = await ctx.app.inject({
      method: "POST",
      url: "/api/query",
      headers: bearer(session.key),
      payload: { sql: "SELECT id FROM runs UNION SELECT id FROM runs" },
    });
    expect(sneaky.statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});
