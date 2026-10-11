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
