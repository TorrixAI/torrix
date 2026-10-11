import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession } from "./helpers";

async function seedProject(ctx: Awaited<ReturnType<typeof createTestApp>>, userId: string): Promise<void> {
  await ctx.repos.projects.create({
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Default",
    created_at: new Date().toISOString(),
  });
}

test("ingest persists reasoning and tool calls, and the session tree renders them", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            agent_name: "opencode",
            session_id: "ses_root",
            trace_id: "ses_root",
            start_time: "2026-01-01T10:00:00.000Z",
            request: { body: { messages: [{ role: "user", content: "plan the refactor" }] } },
            response: {
              body: {
                model: "deepseek-v4",
                choices: [
                  {
                    message: {
                      content: "I will delegate this to a subagent",
                      reasoning_content: "The parent decided a subagent is cheaper for this subtask",
                      tool_calls: [
                        {
                          id: "call_1",
                          type: "function",
                          function: { name: "task", arguments: '{"prompt":"do the refactor"}' },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
              },
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);

    const { runs } = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(runs).toHaveLength(1);
    const parent = runs[0];
    expect(parent.created_at).toBe("2026-01-01T10:00:00.000Z");
    expect(parent.thinking_tokens).toBeGreaterThan(0);
    expect(parent.finish_reason).toBe("tool_calls");
    expect(parent.agent_name).toBe("opencode");

    const events = await ctx.repos.events.listByRun(parent.id);
    const thinking = events.find((e) => e.type === "thinking");
    const toolCall = events.find((e) => e.type === "tool_call");
    expect(thinking?.message).toContain("subagent is cheaper");
    expect(toolCall?.message).toContain("task");
    expect(toolCall?.message).toContain("do the refactor");

    const counts = await ctx.repos.events.countByRunIds([parent.id]);
    const byType = new Map(counts.map((c) => [c.type, c.count]));
    expect(byType.get("thinking")).toBe(1);
    expect(byType.get("tool_call")).toBe(1);

    const childRes = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            agent_name: "build",
            session_id: "ses_root",
            trace_id: "ses_child",
            parent_run_id: parent.id,
            start_time: "2026-01-01T10:05:00.000Z",
            request: { body: { messages: [{ role: "user", content: "do the refactor" }] } },
            response: { body: { choices: [{ message: { content: "done" } }] } },
          },
        ],
      },
    });
    expect(childRes.statusCode).toBe(200);

    const children = await ctx.repos.runs.listByParents(session.user.id, [parent.id], 10);
    expect(children).toHaveLength(1);
    expect(children[0].agent_name).toBe("build");
    expect(children[0].created_at).toBe("2026-01-01T10:05:00.000Z");

    const observed = await ctx.repos.runs.listObservedAgents(session.user.id, 10);
    expect(observed.map((a) => a.name).sort()).toEqual(["build", "opencode"]);
    expect(observed.every((a) => a.runs === 1)).toBe(true);

    const observedPage = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: bearer(session.key) });
    expect(observedPage.statusCode).toBe(200);
    expect(observedPage.body).toContain("Observed agents");
    expect(observedPage.body).toContain("build");

    const agentRuns = await ctx.app.inject({ method: "GET", url: "/ui/runs?agent=build", headers: bearer(session.key) });
    expect(agentRuns.statusCode).toBe(200);
    expect(agentRuns.body).toContain("do the refactor");
    expect(agentRuns.body).not.toContain("plan the refactor");

    const page = await ctx.app.inject({ method: "GET", url: "/ui/sessions/ses_root", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("tree-cell");
    expect(page.body).toContain("tree-guides");
    expect(page.body).toContain("agent-chip");
    expect(page.body).toContain("run-tree");

    const parentPage = await ctx.app.inject({ method: "GET", url: `/ui/runs/${parent.id}`, headers: bearer(session.key) });
    expect(parentPage.statusCode).toBe(200);
    expect(parentPage.body).toContain("Reasoning");
    expect(parentPage.body).toContain("Tool calls");
    expect(parentPage.body).toContain("Subagent runs");
    expect(parentPage.body).toContain("task");

    const childPage = await ctx.app.inject({ method: "GET", url: `/ui/runs/${children[0].id}`, headers: bearer(session.key) });
    expect(childPage.statusCode).toBe(200);
    expect(childPage.body).toContain("Parent run");

    const index = await ctx.app.inject({ method: "GET", url: "/ui/traces", headers: bearer(session.key) });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("ses_root");
  } finally {
    await ctx.cleanup();
  }
});
