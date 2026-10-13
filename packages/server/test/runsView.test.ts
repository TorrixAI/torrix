import { expect, test } from "bun:test";
import type { Run, RunData } from "../src/core/domain";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp, seedSession } from "./helpers";

function seedRun(userId: string, projectId: string, overrides: Partial<RunData> & { id: string; created_at: string }): Run {
  return buildRunRow({
    user_id: userId,
    project_id: projectId,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o-mini",
    status: 200,
    ...overrides,
  });
}

test("runs view summarizes and groups sessions, traces, agents and subagents", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({
      id: projectId,
      user_id: session.user.id,
      name: "Default",
      created_at: new Date().toISOString(),
    });
    const runs: Run[] = [
      seedRun(session.user.id, projectId, {
        id: "run_root",
        name: "root turn",
        created_at: "2026-01-01T10:00:00.000Z",
        session_id: "ses_1",
        trace_id: "trc_1",
        agent_name: "build",
        cost_usd: 0.01,
        input_tokens: 10,
        output_tokens: 5,
      }),
      seedRun(session.user.id, projectId, {
        id: "run_child",
        name: "child turn",
        created_at: "2026-01-01T10:01:00.000Z",
        session_id: "ses_1",
        trace_id: "trc_2",
        parent_run_id: "run_root",
        agent_name: "explore",
        cost_usd: 0.02,
        input_tokens: 20,
        output_tokens: 7,
      }),
      seedRun(session.user.id, projectId, {
        id: "run_other",
        name: "other session turn",
        created_at: "2026-01-01T10:02:00.000Z",
        session_id: "ses_2",
        trace_id: "trc_3",
        agent_name: "build",
      }),
    ];
    for (const run of runs) {
      await ctx.repos.runs.save(run);
    }

    const plain = await ctx.app.inject({ method: "GET", url: "/ui/runs", headers: bearer(session.key) });
    expect(plain.statusCode).toBe(200);
    expect(plain.body).toContain("2 agents");
    expect(plain.body).toContain("1 subagent run");
    expect(plain.body).toContain("2 sessions");
    expect(plain.body).toContain("3 traces");
    expect(plain.body).toContain("agent-chip");
    expect(plain.body).toContain("/ui/sessions/ses_1");
    expect(plain.body).toContain("torrix-auto-refresh");
    expect(plain.body).toContain("1 sub</span>");

    const grouped = await ctx.app.inject({ method: "GET", url: "/ui/runs?group=session", headers: bearer(session.key) });
    expect(grouped.statusCode).toBe(200);
    expect(grouped.body).toContain("group-row");
    expect(grouped.body).toContain("/ui/sessions/ses_1");
    expect(grouped.body).toContain("2 agents");
    expect(grouped.body).toContain("1 subagent");
    expect(grouped.body).toContain("grouped by session");

    const byTrace = await ctx.app.inject({ method: "GET", url: "/ui/runs?group=trace", headers: bearer(session.key) });
    expect(byTrace.statusCode).toBe(200);
    expect(byTrace.body).toContain("/ui/traces/trc_1");
    expect(byTrace.body).toContain("/ui/traces/trc_2");

    const traces = await ctx.app.inject({ method: "GET", url: "/ui/traces", headers: bearer(session.key) });
    expect(traces.statusCode).toBe(200);
    expect(traces.body).toContain("Subagents");
    expect(traces.body).toContain("torrix-auto-refresh");

    const sessionPage = await ctx.app.inject({ method: "GET", url: "/ui/sessions/ses_1", headers: bearer(session.key) });
    expect(sessionPage.statusCode).toBe(200);
    expect(sessionPage.body).toContain("1 child call");
    expect(sessionPage.body).toContain("torrix-auto-refresh");
    expect(sessionPage.body).toContain('data-view="flow"');
    expect(sessionPage.body).toContain("view-flow");
    expect(sessionPage.body).toContain("torrix_trace_view");
    expect(sessionPage.body).toContain("window.torrixRenderFlow");
    expect(sessionPage.body).toContain("flow-edge");

    const flowPayloadMatch = sessionPage.body.match(/var DATA=(\{.*?\});\s*var wrap=/s);
    expect(flowPayloadMatch).toBeTruthy();
    const flowPayload = JSON.parse(flowPayloadMatch![1].replace(/\\u003c/g, "<"));
    expect(flowPayload.total).toBe(2);
    const child = flowPayload.runs.find((entry: { id: string }) => entry.id === "run_child");
    expect(child.parent).toBe("run_root");
    expect(child.agent).toBe("explore");
    expect(child.url).toBe("/ui/runs/run_child");
    expect(flowPayload.runs.find((entry: { id: string }) => entry.id === "run_root").parent).toBeNull();
  } finally {
    await ctx.cleanup();
  }
});

test("run detail carries a breadcrumb path and a previous/next stepper inside the trace", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const runs: Run[] = [
      seedRun(session.user.id, projectId, { id: "step-1", name: "plan the refund", created_at: "2026-01-01T10:00:00.000Z", session_id: "ses_x", trace_id: "trc_x", agent_name: "planner" }),
      seedRun(session.user.id, projectId, { id: "step-2", name: "look up order", created_at: "2026-01-01T10:00:05.000Z", session_id: "ses_x", trace_id: "trc_x", parent_run_id: "step-1", agent_name: "search" }),
      seedRun(session.user.id, projectId, { id: "step-3", name: "issue refund", created_at: "2026-01-01T10:00:09.000Z", session_id: "ses_x", trace_id: "trc_x", parent_run_id: "step-2", agent_name: "search" }),
    ];
    for (const run of runs) {
      await ctx.repos.runs.save(run);
    }

    const middle = await ctx.app.inject({ method: "GET", url: "/ui/runs/step-2", headers: bearer(session.key) });
    expect(middle.statusCode).toBe(200);
    expect(middle.body).toContain("rd-breadcrumb");
    expect(middle.body).toContain("plan the refund");
    expect(middle.body).toContain("2 of 3 in trace");
    expect(middle.body).toContain('href="/ui/runs/step-1"');
    expect(middle.body).toContain('href="/ui/runs/step-3"');

    const last = await ctx.app.inject({ method: "GET", url: "/ui/runs/step-3", headers: bearer(session.key) });
    expect(last.statusCode).toBe(200);
    expect(last.body).toContain("3 of 3 in trace");
    expect(last.body).toContain("look up order");
    expect(last.body).toContain("← Previous");
    expect(last.body).not.toContain("Next →");
  } finally {
    await ctx.cleanup();
  }
});

test("grouped runs list pages by group with full group aggregates", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const t0 = Date.parse("2026-01-02T09:00:00.000Z");
    for (let g = 0; g < 12; g += 1) {
      for (let i = 0; i < 5; i += 1) {
        await ctx.repos.runs.save(
          seedRun(session.user.id, projectId, {
            id: `g${g}-r${i}`,
            name: `group ${g} run ${i}`,
            session_id: `ses_${g}`,
            trace_id: `trc_${g}_${i}`,
            parent_run_id: i > 0 ? `g${g}-r0` : undefined,
            agent_name: g % 2 === 0 ? "build" : "explore",
            cost_usd: 0.01,
            created_at: new Date(t0 + g * 3_600_000 + i * 60_000).toISOString(),
          }),
        );
      }
    }

    const first = await ctx.app.inject({ method: "GET", url: "/ui/runs?group=session", headers: bearer(session.key) });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain("Groups <b>1–10</b> of <b>12</b>");
    expect(first.body).toContain("showing <b>50</b> runs");
    expect(first.body).toContain("5 runs");
    expect(first.body).toContain("4 subagents");
    expect(first.body).toContain('href="/ui/sessions/ses_11"');
    expect(first.body).not.toContain('href="/ui/sessions/ses_1"');
    expect(first.body).toContain("gpage=1");

    const second = await ctx.app.inject({ method: "GET", url: "/ui/runs?group=session&gpage=1", headers: bearer(session.key) });
    expect(second.statusCode).toBe(200);
    expect(second.body).toContain("Groups <b>11–12</b> of <b>12</b>");
    expect(second.body).toContain("showing <b>10</b> runs");
    expect(second.body).toContain('href="/ui/sessions/ses_1"');
    expect(second.body).toContain('href="/ui/sessions/ses_0"');
    expect(second.body).not.toContain('href="/ui/sessions/ses_11"');
    expect(second.body).not.toContain("gpage=2");

    const filtered = await ctx.app.inject({ method: "GET", url: "/ui/runs?group=session&agent=explore", headers: bearer(session.key) });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.body).toContain("of <b>6</b>");
    expect(filtered.body).toContain("showing <b>30</b> runs");
    expect(filtered.body).toContain('href="/ui/sessions/ses_1"');
    expect(filtered.body).not.toContain('href="/ui/sessions/ses_0"');
  } finally {
    await ctx.cleanup();
  }
});
