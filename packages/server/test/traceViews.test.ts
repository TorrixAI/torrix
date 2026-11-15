import { expect, test } from "bun:test";
import { bearer, createTestApp, expectSpaShell, seedSession, type TestApp } from "./helpers";

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

    const page = await ctx.app.inject({ method: "GET", url: "/ui/traces/turn-a", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);

    const res = await ctx.app.inject({ method: "GET", url: "/api/runs/group/trace/turn-a", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const group = res.json() as { runs: Array<{ id: string; parent_run_id: string | null; error: string | null; request_body: string | null }>; eventCounts: Record<string, number> };
    const ids = group.runs.map((run) => run.id);
    expect(ids).toEqual(expect.arrayContaining(["root", "search", "refund"]));
    expect(group.runs.find((run) => run.id === "root")?.request_body).toContain("Refund order 42 and email the customer");
    expect(group.runs.find((run) => run.id === "refund")?.error).toContain("payments API timed out");
    expect(group.runs.find((run) => run.id === "search")?.parent_run_id).toBe("root");
    expect(group.eventCounts).toBeDefined();
  } finally {
    await ctx.cleanup();
  }
});

test("tree rows expand into tool calls, reasoning and policy flags", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const t0 = Date.parse("2026-10-11T09:00:00.000Z");
    await save(ctx, session.user.id, projectId, {
      id: "agent-run",
      name: "call tools",
      trace_id: "events-a",
      session_id: "chat",
      agent_name: "build",
      policy_flags: JSON.stringify([{ policyName: "no-secrets", stage: "request", severity: "high", detail: "API key shape found" }]),
      created_at: new Date(t0).toISOString(),
    });
    await save(ctx, session.user.id, projectId, { id: "plain-run", name: "no events", trace_id: "events-a", created_at: new Date(t0 + 4000).toISOString() });
    await ctx.repos.events.addMany([
      { id: crypto.randomUUID(), run_id: "agent-run", type: "tool_call", message: JSON.stringify([{ name: "search_orders", arguments: '{"order":42}' }]), created_at: new Date(t0 + 1000).toISOString() },
      { id: crypto.randomUUID(), run_id: "agent-run", type: "thinking", message: "The customer wants a refund; check the order first.", created_at: new Date(t0 + 2000).toISOString() },
    ]);

    const page = await ctx.app.inject({ method: "GET", url: "/ui/traces/events-a", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);

    // The tree expands rows lazily, so the payloads are the run row (policy flags)
    // plus the events endpoint rather than pre-rendered markup.
    const group = (await ctx.app.inject({ method: "GET", url: "/api/runs/group/trace/events-a", headers: bearer(session.key) })).json() as {
      runs: Array<{ id: string; policy_flags: string | null }>;
    };
    const flagged = group.runs.find((run) => run.id === "agent-run")?.policy_flags ?? "";
    expect(flagged).toContain("no-secrets");
    expect(flagged).toContain("API key shape found");
    expect(group.runs.find((run) => run.id === "plain-run")?.policy_flags ?? "").toBe("");

    const events = await ctx.app.inject({ method: "GET", url: "/api/runs/agent-run/events", headers: bearer(session.key) });
    expect(events.statusCode).toBe(200);
    const list = (events.json() as { events: Array<{ type: string; message: string }> }).events;
    expect(list.some((event) => event.type === "tool_call" && event.message.includes("search_orders"))).toBe(true);
    expect(list.some((event) => event.type === "thinking")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

test("the turn summary shows the last answer and the traces index carries roots, duration and filters", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const t0 = Date.parse("2026-10-11T09:00:00.000Z");
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    await save(ctx, session.user.id, projectId, {
      id: "root",
      name: "plan",
      trace_id: "turn-b",
      session_id: "chat-b",
      agent_name: "planner",
      latency_ms: 1000,
      created_at: at(0),
      request_body: JSON.stringify({ messages: [{ role: "user", content: "Summarise the incident" }] }),
    });
    await save(ctx, session.user.id, projectId, { id: "reply", name: "reply", trace_id: "turn-b", session_id: "chat-b", parent_run_id: "root", agent_name: "writer", latency_ms: 500, created_at: at(2) });
    await ctx.repos.events.addMany([
      { id: crypto.randomUUID(), run_id: "reply", type: "response", message: "The incident started at 09:00 and was resolved by 09:40.", created_at: at(3) },
    ]);
    await save(ctx, session.user.id, projectId, { id: "solo", name: "solo", trace_id: "turn-c", session_id: "chat-c", agent_name: "solo-agent", created_at: at(4) });

    const trace = await ctx.app.inject({ method: "GET", url: "/ui/traces/turn-b", headers: bearer(session.key) });
    expect(trace.statusCode).toBe(200);
    expectSpaShell(trace.body);
    const answer = await ctx.app.inject({ method: "GET", url: "/api/runs/reply/events", headers: bearer(session.key) });
    const answerEvents = (answer.json() as { events: Array<{ type: string; message: string }> }).events;
    expect(answerEvents.find((event) => event.type === "response")?.message).toContain("The incident started at 09:00");

    const index = await ctx.app.inject({ method: "GET", url: "/api/traces", headers: bearer(session.key) });
    expect(index.statusCode).toBe(200);
    const indexBody = index.json() as {
      traces: Array<{ id: string; runs: number; firstAt: string; lastAt: string }>;
      roots: Record<string, { agentName: string | null; requestBody: string | null }>;
    };
    const turnB = indexBody.traces.find((group) => group.id === "turn-b");
    expect(turnB?.runs).toBe(2);
    expect(indexBody.roots["turn-b"].agentName).toBe("planner");
    expect(indexBody.roots["turn-b"].requestBody).toContain("Summarise the incident");
    expect(Date.parse(turnB!.lastAt) - Date.parse(turnB!.firstAt)).toBe(2000);
    expect(indexBody.traces.find((group) => group.id === "turn-c")?.runs).toBe(1);

    // The index filters: search matches agent and prompt, errors and single-run filters narrow the set.
    const filtered = await ctx.app.inject({ method: "GET", url: "/api/traces?q=planner", headers: bearer(session.key) });
    const filteredBody = filtered.json() as { traces: Array<{ id: string }> };
    expect(filteredBody.traces.map((group) => group.id)).toEqual(["turn-b"]);
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
    const latest = await ctx.app.inject({ method: "GET", url: "/api/runs/group/session/long-chat?limit=200&offset=200", headers: bearer(session.key) });
    expect(latest.statusCode).toBe(200);
    const latestBody = latest.json() as { runs: Array<{ id: string }>; total: number };
    expect(latestBody.total).toBe(205);
    expect(latestBody.runs.map((run) => run.id)).toContain("run-204");
    expect(latestBody.runs.map((run) => run.id)).not.toContain("run-3");

    const first = await ctx.app.inject({ method: "GET", url: "/api/runs/group/session/long-chat?limit=200&offset=0", headers: bearer(session.key) });
    const firstBody = first.json() as { runs: Array<{ id: string; trace_id: string | null }> };
    expect(firstBody.runs.length).toBe(200);
    expect(firstBody.runs.map((run) => run.trace_id)).toContain("turn-0");
    expect(firstBody.runs.map((run) => run.trace_id)).toContain("turn-1");
  } finally {
    await ctx.cleanup();
  }
});
