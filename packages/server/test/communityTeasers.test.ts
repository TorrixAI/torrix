import { expect, test } from "bun:test";
import type { TorrixExtension } from "../src/core/extensions";
import { lockedFeatures } from "../src/core/lockedFeatures";
import { bearer, createTestApp, expectSpaShell, seedSession } from "./helpers";

// The console is a React SPA. Gated /ui pages serve the same shell; the React
// app renders the upgrade card from /api/locked/:feature and /api/config, so
// these tests assert on those endpoints plus the shell document.
const uiStub: TorrixExtension = {
  id: "uistub",
  version: "0.0.1",
  minEdition: "pro",
  features: [{ id: "sso", label: "SSO", minEdition: "enterprise" }],
  async register(app, ctx) {
    app.get("/ui/stub-page", async (_request, reply) => reply.type("text/html").send("<p>real page</p>"));
    app.get("/ui/stub-sso", { preHandler: ctx.requireFeature("sso") }, async (_request, reply) =>
      reply.type("text/html").send("<p>sso page</p>"),
    );
    app.get("/api/stub-data", async () => ({ ok: true }));
  },
};

test("every catalogued paid feature has an upgrade page", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    for (const feature of lockedFeatures()) {
      const page = await ctx.app.inject({ method: "GET", url: `/ui/locked/${feature.id}`, headers: bearer(session.key) });
      expect(page.statusCode).toBe(200);
      expectSpaShell(page.body);
      const api = await ctx.app.inject({ method: "GET", url: `/api/locked/${feature.id}`, headers: bearer(session.key) });
      expect(api.statusCode).toBe(200);
      const info = (api.json() as { feature: { label: string; pitch: string } }).feature;
      expect(info.label).toBe(feature.label);
      expect(info.pitch).not.toContain("—");
    }
    const unknown = await ctx.app.inject({ method: "GET", url: "/api/locked/nope", headers: bearer(session.key) });
    expect(unknown.statusCode).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

test("a licensed Community build reports its edition and locked features", async () => {
  const ctx = await createTestApp({ TORRIX_EDITION: "pro" });
  try {
    const session = await seedSession(ctx);
    const judge = await ctx.app.inject({ method: "GET", url: "/api/locked/judge", headers: bearer(session.key) });
    expect(judge.statusCode).toBe(200);
    expect((judge.json() as { feature: { label: string } }).feature.label).toContain("judge");
    const config = await ctx.app.inject({ method: "GET", url: "/api/config", headers: bearer(session.key) });
    expect(config.json()).toMatchObject({ edition: "pro" });
    const page = await ctx.app.inject({ method: "GET", url: "/ui/locked/sso", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);
  } finally {
    await ctx.cleanup();
  }
});

test("a licensed Community build points to the paid image instead of asking for a license", async () => {
  const ctx = await createTestApp({ TORRIX_EDITION: "pro" });
  try {
    const session = await seedSession(ctx);
    const config = await ctx.app.inject({ method: "GET", url: "/api/config", headers: bearer(session.key) });
    const body = config.json() as { edition: string; features: string[] };
    // Licensed Pro, but the paid extension is not installed: the SPA reads these
    // two fields and renders "not in this build" instead of "Activate a license".
    expect(body.edition).toBe("pro");
    expect(body.features).not.toContain("judge");
    const info = await ctx.app.inject({ method: "GET", url: "/api/locked/judge", headers: bearer(session.key) });
    expect(info.statusCode).toBe(200);
    expect((info.json() as { feature: { edition: string } }).feature.edition).toBe("pro");
    const page = await ctx.app.inject({ method: "GET", url: "/ui/locked/judge", headers: bearer(session.key) });
    expectSpaShell(page.body);
    const sso = await ctx.app.inject({ method: "GET", url: "/api/locked/sso", headers: bearer(session.key) });
    expect((sso.json() as { feature: { edition: string } }).feature.edition).toBe("enterprise");
  } finally {
    await ctx.cleanup();
  }
});

test("unlicensed extension pages serve the console while APIs answer 402 JSON", async () => {
  const ctx = await createTestApp({}, { extensions: [uiStub] });
  try {
    // A gated /ui page serves the SPA shell with 200; the React app shows the
    // upgrade card. The API still refuses with 402.
    const page = await ctx.app.inject({ method: "GET", url: "/ui/stub-page" });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);

    const api = await ctx.app.inject({ method: "GET", url: "/api/stub-data" });
    expect(api.statusCode).toBe(402);
    expect(api.json()).toMatchObject({ error: "license_required" });

    ctx.config.license.override("pro");
    expect((await ctx.app.inject({ method: "GET", url: "/ui/stub-page" })).body).toContain("real page");
    const sso = await ctx.app.inject({ method: "GET", url: "/ui/stub-sso" });
    expect(sso.statusCode).toBe(200);
    expectSpaShell(sso.body);

    ctx.config.license.override("enterprise");
    expect((await ctx.app.inject({ method: "GET", url: "/ui/stub-sso" })).body).toContain("sso page");
  } finally {
    await ctx.cleanup();
  }
});

test("observed agents stay available in the community edition", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expectSpaShell(res.body);
    const api = await ctx.app.inject({ method: "GET", url: "/api/v1/observed-agents", headers: bearer(session.key) });
    expect(api.statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("community builds offer observed agents only: no registry, agent MCP tools or agent metrics", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const registry = await ctx.app.inject({ method: "GET", url: "/ui/agents", headers: bearer(session.key) });
    expect(registry.statusCode).toBe(302);
    expect(registry.headers.location).toBe("/ui/agents/observed");

    const observed = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: bearer(session.key) });
    expect(observed.statusCode).toBe(200);
    expectSpaShell(observed.body);

    const tools = await ctx.app.inject({
      method: "POST",
      url: "/mcp",
      headers: bearer(session.key),
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const names = (tools.json() as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    expect(names).toContain("list_runs");
    expect(names).not.toContain("list_agents");

    const metrics = await ctx.app.inject({ method: "GET", url: "/metrics", headers: bearer(session.key) });
    expect(metrics.body).not.toContain("torrix_agents");
    expect((await ctx.app.inject({ method: "POST", url: "/api/v1/agents", headers: bearer(session.key), payload: { name: "x" } })).statusCode).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

test("community governance keeps PII masking and gates the paid controls", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const page = await ctx.app.inject({ method: "GET", url: "/ui/governance", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expectSpaShell(page.body);

    const compliance = await ctx.app.inject({ method: "GET", url: "/ui/compliance", headers: bearer(session.key) });
    expect(compliance.statusCode).toBe(200);
    expectSpaShell(compliance.body);

    for (const url of ["/api/policies", "/api/routing/rules", "/api/audit", "/api/exports", "/api/compliance/summary"]) {
      expect((await ctx.app.inject({ method: "GET", url, headers: bearer(session.key) })).statusCode).toBe(404);
    }
    expect((await ctx.app.inject({ method: "GET", url: "/api/governance/settings", headers: bearer(session.key) })).statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("community shows judge and online evals as upgrade cards, without the judge APIs", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const datasets = await ctx.app.inject({ method: "GET", url: "/ui/datasets", headers: bearer(session.key) });
    expect(datasets.statusCode).toBe(200);
    expectSpaShell(datasets.body);

    await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const projects = await ctx.app.inject({ method: "GET", url: "/ui/projects", headers: bearer(session.key) });
    expect(projects.statusCode).toBe(200);
    expectSpaShell(projects.body);

    for (const [method, url] of [
      ["GET", "/api/judge/settings"],
      ["GET", "/api/online-evals"],
    ] as const) {
      expect((await ctx.app.inject({ method, url, headers: bearer(session.key) })).statusCode).toBe(404);
    }
    const bulk = await ctx.app.inject({
      method: "POST",
      url: "/api/runs/bulk",
      headers: bearer(session.key),
      payload: { action: "judge", ids: ["x"] },
    });
    expect(bulk.statusCode).toBe(402);
  } finally {
    await ctx.cleanup();
  }
});

test("every community page serves the console shell", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const runId = crypto.randomUUID();
    await ctx.repos.runs.save({
      id: runId,
      user_id: session.user.id,
      project_id: projectId,
      name: "scan",
      model: "gpt-4o",
      provider: "openai",
      status: 200,
      source: "proxy",
      session_id: "s",
      trace_id: "t",
      created_at: new Date().toISOString(),
    } as never);
    const pages = [
      "/ui/dashboard", "/ui/analytics", "/ui/runs", `/ui/runs/${runId}`, "/ui/traces", "/ui/traces/t", "/ui/sessions/s",
      "/ui/live", "/ui/insights", "/ui/playground", "/ui/agents/observed", "/ui/prompts", "/ui/datasets", "/ui/cost",
      "/ui/projects", "/ui/team", "/ui/keys", "/ui/integrations", "/ui/governance", "/ui/compliance", "/ui/settings", "/ui/query",
    ];
    for (const url of pages) {
      const res = await ctx.app.inject({ method: "GET", url, headers: bearer(session.key) });
      expect(res.statusCode, url).toBe(200);
      expectSpaShell(res.body);
    }
  } finally {
    await ctx.cleanup();
  }
});
