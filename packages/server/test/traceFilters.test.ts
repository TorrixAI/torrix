import { expect, test } from "bun:test";
import type { Run, RunData } from "../src/core/domain";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp } from "./helpers";

function seedRun(userId: string, projectId: string, overrides: Partial<RunData> & { id: string; created_at: string }): Run {
  return buildRunRow({
    user_id: userId,
    project_id: projectId,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o",
    status: 200,
    ...overrides,
  });
}

test("trace groups filter on the same run fields as the Runs list", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "traces@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("traces@torrix.test"))!;
    const project = (await ctx.repos.projects.findDefault(user.id))!;

    const runs: Run[] = [
      seedRun(user.id, project.id, {
        id: "run_a",
        name: "refund alpha",
        created_at: "2026-01-01T10:00:00.000Z",
        trace_id: "trc_a",
        session_id: "ses_a",
        agent_name: "build",
        model: "gpt-4o",
        source: "sdk",
      }),
      seedRun(user.id, project.id, {
        id: "run_a2",
        name: "refund follow-up",
        created_at: "2026-01-01T10:05:00.000Z",
        trace_id: "trc_a",
        session_id: "ses_a",
        agent_name: "build",
        model: "gpt-4o",
      }),
      seedRun(user.id, project.id, {
        id: "run_b",
        name: "refund beta",
        created_at: "2026-01-02T10:00:00.000Z",
        trace_id: "trc_b",
        session_id: "ses_b",
        agent_name: "review",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        source: "playground",
        status: 500,
      }),
      seedRun(user.id, project.id, {
        id: "run_c",
        name: "checkout gamma",
        created_at: "2026-01-03T10:00:00.000Z",
        trace_id: "trc_c",
        session_id: "ses_c",
        agent_name: "build",
        model: "gpt-4o",
        source: "proxy",
      }),
    ];
    for (const run of runs) await ctx.repos.runs.save(run);

    const load = async (query: string) => {
      const response = await ctx.app.inject({ method: "GET", url: `/api/traces?${query}`, headers: bearer(key) });
      expect(response.statusCode, query).toBe(200);
      const body = response.json() as {
        sessions: Array<{ id: string }>;
        traces: Array<{ id: string }>;
        totals?: { sessions: number; traces: number };
      };
      return { traces: body.traces.map((group) => group.id).sort(), sessions: body.sessions.map((group) => group.id).sort(), totals: body.totals };
    };

    expect((await load("model=gpt-4o")).traces).toEqual(["trc_a", "trc_c"]);
    expect((await load("model=gpt-4o")).totals?.traces).toBe(2);
    expect((await load("agent=review")).traces).toEqual(["trc_b"]);
    expect((await load("agent=review")).sessions).toEqual(["ses_b"]);
    expect((await load("source=playground")).traces).toEqual(["trc_b"]);
    expect((await load("status=error")).traces).toEqual(["trc_b"]);
    expect((await load("errors=1")).traces).toEqual(["trc_b"]);
    expect((await load("status=200")).traces).toEqual(["trc_a", "trc_c"]);
    expect((await load("from=2026-01-03T00%3A00%3A00.000Z")).traces).toEqual(["trc_c"]);
    expect((await load("from=2026-01-02T00%3A00%3A00.000Z&agent=build")).traces).toEqual(["trc_c"]);
    expect((await load("q=refund")).traces).toEqual(["trc_a", "trc_b"]);
    expect((await load("status=200&model=gpt-4o")).traces).toEqual(["trc_a", "trc_c"]);
    // Only trc_a/ses_a has more than one run, so multi=1 hides the rest.
    const multi = await load("multi=1");
    expect(multi.traces).toEqual(["trc_a"]);
    expect(multi.sessions).toEqual(["ses_a"]);
    expect(multi.totals).toEqual({ sessions: 1, traces: 1 });

    // Groups page independently; the newest group is page 1, the next is page 2.
    const pageTwo = await load("limit=1&spage=2&tpage=2");
    expect(pageTwo.traces).toEqual(["trc_b"]);
    expect(pageTwo.sessions).toEqual(["ses_b"]);
    expect(pageTwo.totals).toEqual({ sessions: 3, traces: 3 });
  } finally {
    await ctx.cleanup();
  }
});
