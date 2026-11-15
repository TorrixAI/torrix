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

test("run list filters map onto the query options the UI writes", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "filters@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("filters@torrix.test"))!;
    const project = (await ctx.repos.projects.findDefault(user.id))!;

    const runs: Run[] = [
      seedRun(user.id, project.id, {
        id: "run_alpha",
        name: "refund alpha",
        created_at: "2026-01-01T10:00:00.000Z",
        source: "sdk",
        provider: "openai",
        model: "gpt-4o",
        status: 200,
        tags: { team: "alpha" },
        is_golden: true,
        end_user_id: "cust_1",
        score: 1,
      }),
      seedRun(user.id, project.id, {
        id: "run_beta",
        name: "refund beta",
        created_at: "2026-01-02T10:00:00.000Z",
        source: "playground",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        status: 200,
        tags: { team: "beta" },
        is_golden: false,
        end_user_id: "cust_2",
        score: 0,
        is_anomaly: true,
      }),
      seedRun(user.id, project.id, {
        id: "run_gamma",
        name: "checkout gamma",
        created_at: "2026-01-03T10:00:00.000Z",
        source: "proxy",
        provider: "openai",
        model: "gpt-4o",
        status: 500,
        tags: { team: "alpha" },
      }),
    ];
    for (const run of runs) await ctx.repos.runs.save(run);

    const list = async (query: string) => {
      const response = await ctx.app.inject({ method: "GET", url: `/api/runs?${query}&limit=50`, headers: bearer(key) });
      expect(response.statusCode, query).toBe(200);
      const body = response.json() as { runs: Array<{ id: string }>; total: number };
      return body.runs.map((run) => run.id);
    };

    expect(await list("model=gpt-4o")).toEqual(expect.arrayContaining(["run_alpha", "run_gamma"]));
    expect(await list("model=gpt-4o")).toHaveLength(2);
    expect(await list("provider=anthropic")).toEqual(["run_beta"]);
    expect(await list("source=playground")).toEqual(["run_beta"]);
    expect(await list("status=error")).toEqual(["run_gamma"]);
    expect(await list("tag=beta")).toEqual(["run_beta"]);
    expect(await list("is_golden=1")).toEqual(["run_alpha"]);
    expect(await list("is_golden=0")).toEqual(expect.arrayContaining(["run_beta", "run_gamma"]));
    expect(await list("anomaly=1")).toEqual(["run_beta"]);
    expect(await list("end_user=cust_2")).toEqual(["run_beta"]);
    expect(await list("score=good")).toEqual(["run_alpha"]);
    expect(await list("score=bad")).toEqual(["run_beta"]);
    expect(await list("score=unscored")).toEqual(["run_gamma"]);
    expect(await list("from=2026-01-02T00%3A00%3A00.000Z&to=2026-01-02T23%3A59%3A59.999Z")).toEqual(["run_beta"]);
    expect(await list("q=refund&source=sdk")).toEqual(["run_alpha"]);
    expect(await list("q=run_alpha")).toEqual(["run_alpha"]);
    expect(await list("q=run_")).toEqual(expect.arrayContaining(["run_alpha", "run_beta", "run_gamma"]));
    expect(await list("model=gpt-4o&status=error")).toEqual(["run_gamma"]);
  } finally {
    await ctx.cleanup();
  }
});
