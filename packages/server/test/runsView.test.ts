import { expect, test } from "bun:test";
import type { Run, RunData } from "../src/core/domain";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp, expectSpaShell, seedSession } from "./helpers";

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

    const plain = await ctx.app.inject({ method: "GET", url: "/api/runs", headers: bearer(session.key) });
    expect(plain.statusCode).toBe(200);
    const plainBody = plain.json() as { runs: Array<{ id: string }>; summary: { agents: number; subagents: number; sessions: number; traces: number } };
    expect(plainBody.summary).toMatchObject({ agents: 2, subagents: 1, sessions: 2, traces: 3 });
    expect(plainBody.runs.map((run) => run.id)).toEqual(expect.arrayContaining(["run_root", "run_child", "run_other"]));

    const grouped = await ctx.app.inject({ method: "GET", url: "/api/runs?group=session", headers: bearer(session.key) });
    expect(grouped.statusCode).toBe(200);
    const groupedBody = grouped.json() as { groups: Array<{ id: string; runs: number; agents: string[] }>; runs: Array<{ id: string; session_id: string | null }> };
    expect(groupedBody.groups.find((group) => group.id === "ses_1")).toMatchObject({ runs: 2 });
    expect(groupedBody.runs.map((run) => run.id)).toEqual(expect.arrayContaining(["run_root", "run_child"]));

    const byTrace = await ctx.app.inject({ method: "GET", url: "/api/runs?group=trace", headers: bearer(session.key) });
    const byTraceBody = byTrace.json() as { groups: Array<{ id: string }> };
    expect(byTraceBody.groups.map((group) => group.id)).toEqual(expect.arrayContaining(["trc_1", "trc_2"]));

    const traces = await ctx.app.inject({ method: "GET", url: "/api/traces", headers: bearer(session.key) });
    expect(traces.statusCode).toBe(200);
    const tracesBody = traces.json() as { sessions: Array<{ id: string; subagents: number }>; traces: Array<{ id: string }> };
    expect(tracesBody.sessions.map((group) => group.id)).toContain("ses_1");
    expect(tracesBody.sessions.find((group) => group.id === "ses_1")?.subagents).toBe(1);
    expect(tracesBody.traces.map((group) => group.id)).toContain("trc_1");

    const sessionGroup = await ctx.app.inject({ method: "GET", url: "/api/runs/group/session/ses_1", headers: bearer(session.key) });
    expect(sessionGroup.statusCode).toBe(200);
    const groupBody = sessionGroup.json() as { runs: Array<{ id: string; parent_run_id: string | null; agent_name: string | null }>; total: number };
    expect(groupBody.total).toBe(2);
    expect(groupBody.runs.find((run) => run.id === "run_child")?.parent_run_id).toBe("run_root");
    expect(groupBody.runs.find((run) => run.id === "run_child")?.agent_name).toBe("explore");
    expect(groupBody.runs.find((run) => run.id === "run_root")?.parent_run_id).toBeNull();

    // The list, grouped list and drill-in all serve the one SPA shell.
    for (const url of ["/ui/runs", "/ui/runs?group=session", "/ui/runs?group=trace", "/ui/traces", "/ui/sessions/ses_1"]) {
      const page = await ctx.app.inject({ method: "GET", url, headers: bearer(session.key) });
      expect(page.statusCode, url).toBe(200);
      expectSpaShell(page.body);
    }
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

    // The breadcrumb and stepper read the run plus its trace group, oldest first.
    const middle = (await ctx.app.inject({ method: "GET", url: "/api/runs/step-2", headers: bearer(session.key) })).json() as { trace_id: string; children: Array<{ id: string }> };
    expect(middle.trace_id).toBe("trc_x");
    expect(middle.children.map((run) => run.id)).toEqual(["step-3"]);
    const group = (await ctx.app.inject({ method: "GET", url: "/api/runs/group/trace/trc_x?descendants=0", headers: bearer(session.key) })).json() as {
      runs: Array<{ id: string; name: string; parent_run_id: string | null; created_at: string }>;
    };
    const ordered = [...group.runs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    expect(ordered.map((run) => run.id)).toEqual(["step-1", "step-2", "step-3"]);
    expect(ordered.findIndex((run) => run.id === "step-2")).toBe(1);
    expect(ordered[ordered.findIndex((run) => run.id === "step-2") + 1].name).toBe("issue refund");
    expect(ordered[ordered.findIndex((run) => run.id === "step-3") - 1].name).toBe("look up order");

    const page = await ctx.app.inject({ method: "GET", url: "/ui/runs/step-2", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);
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

    type Grouped = { groups: Array<{ id: string; runs: number; subagents: number }>; runs: unknown[]; group_total: number; group_page: number; group_limit: number };
    const first = (await ctx.app.inject({ method: "GET", url: "/api/runs?group=session", headers: bearer(session.key) })).json() as Grouped;
    expect(first.group_total).toBe(12);
    expect(first.groups).toHaveLength(10);
    expect(first.runs).toHaveLength(50);
    expect(first.groups[0]).toMatchObject({ runs: 5, subagents: 4 });
    expect(first.groups.map((group) => group.id)).toContain("ses_11");
    expect(first.groups.map((group) => group.id)).not.toContain("ses_1");

    const second = (await ctx.app.inject({ method: "GET", url: "/api/runs?group=session&gpage=1", headers: bearer(session.key) })).json() as Grouped;
    expect(second.group_page).toBe(1);
    expect(second.groups).toHaveLength(2);
    expect(second.runs).toHaveLength(10);
    expect(second.groups.map((group) => group.id)).toEqual(expect.arrayContaining(["ses_1", "ses_0"]));
    expect(second.groups.map((group) => group.id)).not.toContain("ses_11");

    const filtered = (await ctx.app.inject({ method: "GET", url: "/api/runs?group=session&agent=explore", headers: bearer(session.key) })).json() as Grouped;
    expect(filtered.group_total).toBe(6);
    expect(filtered.runs).toHaveLength(30);
    expect(filtered.groups.map((group) => group.id)).toContain("ses_1");
    expect(filtered.groups.map((group) => group.id)).not.toContain("ses_0");

    const clamped = (await ctx.app.inject({ method: "GET", url: "/api/runs?group=session&gpage=99", headers: bearer(session.key) })).json() as Grouped;
    expect(clamped.group_page).toBe(1);
    expect(clamped.groups).toHaveLength(2);
    expect(clamped.runs).toHaveLength(10);

    const narrowed = (await ctx.app.inject({ method: "GET", url: "/api/runs?group=session&gpage=1&agent=explore", headers: bearer(session.key) })).json() as Grouped;
    expect(narrowed.group_page).toBe(0);
    expect(narrowed.group_total).toBe(6);
    expect(narrowed.groups).toHaveLength(6);
  } finally {
    await ctx.cleanup();
  }
});
