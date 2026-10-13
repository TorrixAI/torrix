import { expect, test } from "bun:test";
import { EDITION_CONFIG, loadConfig } from "../src/core/config";
import type { Run } from "../src/core/domain";
import { checkForUpdate } from "../src/lib/updateCheck";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(ctx: TestApp, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name: "Default", created_at: new Date().toISOString() });
  return id;
}

async function seedRun(ctx: TestApp, userId: string, projectId: string, fields: Partial<Run> = {}): Promise<Run> {
  const run = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name: "parity run",
    model: "gpt-4o",
    provider: "openai",
    input_tokens: 100,
    output_tokens: 20,
    cost_usd: 0.001,
    latency_ms: 120,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
    ...fields,
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  return run;
}

test("prompt active revision resolves refs and activation is explicit", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/prompts",
      headers: bearer(session.key),
      payload: { name: "active-test", template: "v1 template", project_id: projectId },
    });
    const promptId = created.json().prompt.id;
    expect(created.json().prompt.active_revision).toBe(1);

    await ctx.app.inject({
      method: "POST",
      url: `/api/prompts/${promptId}/versions`,
      headers: bearer(session.key),
      payload: { template: "v2 template" },
    });
    const beforeActive = await ctx.app.inject({ method: "GET", url: `/api/prompts/${promptId}/active`, headers: bearer(session.key) });
    expect(beforeActive.json().revision).toBe(1);

    const activated = await ctx.app.inject({
      method: "PUT",
      url: `/api/prompts/${promptId}/versions/2/activate`,
      headers: bearer(session.key),
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().prompt.active_revision).toBe(2);

    const afterActive = await ctx.app.inject({ method: "GET", url: `/api/prompts/${promptId}/active`, headers: bearer(session.key) });
    expect(afterActive.json().revision).toBe(2);
    expect(afterActive.json().version.template).toBe("v2 template");

    const stats = await ctx.app.inject({ method: "GET", url: `/api/prompts/${promptId}/stats`, headers: bearer(session.key) });
    expect(stats.json().stats.active_revision).toBe(2);
  } finally {
    await ctx.cleanup();
  }
});

test("metrics expose legacy series names", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await seedRun(ctx, session.user.id, projectId, { model: "gpt-4o-mini", latency_ms: 120 });
    const res = await ctx.app.inject({ method: "GET", url: "/metrics", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("torrix_requests_total 1");
    expect(res.body).toContain("torrix_cost_usd_total");
    expect(res.body).toContain("torrix_latency_p95_ms");
    expect(res.body).toContain('torrix_requests_by_model{model="gpt-4o-mini"}');
  } finally {
    await ctx.cleanup();
  }
});

test("update check stores the latest release and env overrides apply", async () => {
  const ctx = await createTestApp();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ tag_name: "v9.9.9" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const latest = await checkForUpdate(ctx.repos, "acme/torrix");
    expect(latest).toBe("9.9.9");
    expect(await ctx.repos.instance.get("update_available")).toBe("9.9.9");
    expect(await checkForUpdate(ctx.repos, "")).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    await ctx.cleanup();
  }

  const config = loadConfig({ TORRIX_EDITION: "pro", TORRIX_USER_LIMIT: "5", TORRIX_DEMO: "true" } as NodeJS.ProcessEnv);
  expect(config.edition).toBe("community");
  config.license.override("pro");
  expect(config.edition).toBe("pro");
  expect(config.editionConfig.userLimit).toBe(5);
  expect(config.isDemo).toBe(true);
  expect(EDITION_CONFIG.pro.userLimit).toBeNull();
});
