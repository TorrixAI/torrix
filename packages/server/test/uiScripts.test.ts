import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession } from "./helpers";

test("every core page's inline scripts compile", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const user = session.user;
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: user.id, name: "Scan project", created_at: new Date().toISOString() });

    const runId = crypto.randomUUID();
    await ctx.repos.runs.save({
      id: runId,
      user_id: user.id,
      project_id: projectId,
      name: "Scan run",
      model: "gpt-4o",
      provider: "openai",
      status: 200,
      source: "proxy",
      session_id: "scan-session",
      trace_id: "scan-trace",
      parent_run_id: null,
      created_at: new Date().toISOString(),
    } as never);

    const promptId = crypto.randomUUID();
    await ctx.repos.prompts.create({ id: promptId, project_id: projectId, user_id: user.id, name: "scan-prompt", description: null, tags: null, latest_revision: 1, active_revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const datasetId = crypto.randomUUID();
    await ctx.repos.datasets.create({ id: datasetId, project_id: projectId, user_id: user.id, name: "scan-dataset", description: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await ctx.repos.datasets.addRow({ id: crypto.randomUUID(), dataset_id: datasetId, idx: 0, input: "scan input", expected: "scan output", tags: null, created_at: new Date().toISOString() });

    const pages: Array<[string, string]> = [
      ["dashboard", "/ui/dashboard"],
      ["analytics", "/ui/analytics"],
      ["runs", "/ui/runs"],
      ["run-detail", `/ui/runs/${runId}`],
      ["traces", "/ui/traces"],
      ["trace-detail", "/ui/traces/scan-trace"],
      ["session-detail", "/ui/sessions/scan-session"],
      ["live", "/ui/live"],
      ["insights", "/ui/insights"],
      ["agents-observed", "/ui/agents/observed"],
      ["prompts", "/ui/prompts"],
      ["prompt-detail", `/ui/prompts/${promptId}`],
      ["datasets", "/ui/datasets"],
      ["dataset-detail", `/ui/datasets/${datasetId}`],
      ["cost", "/ui/cost"],
      ["projects", "/ui/projects"],
      ["team", "/ui/team"],
      ["keys", "/ui/keys"],
      ["integrations", "/ui/integrations"],
      ["governance", "/ui/governance"],
      ["playground", "/ui/playground"],
      ["settings", "/ui/settings"],
      ["query", "/ui/query"],
      ["compare", `/ui/compare?ids=${runId},${runId}`],
    ];

    const failures: string[] = [];
    for (const [name, url] of pages) {
      const res = await ctx.app.inject({ method: "GET", url, headers: bearer(session.key) });
      const scripts = [...res.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
      scripts.forEach((source, index) => {
        try {
          new Function(source);
        } catch (err) {
          failures.push(`${name} script#${index}: ${(err as Error).message}`);
        }
      });
    }
    expect(failures).toEqual([]);
  } finally {
    await ctx.cleanup();
  }
});
