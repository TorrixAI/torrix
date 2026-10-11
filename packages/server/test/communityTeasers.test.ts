import { expect, test } from "bun:test";
import type { TorrixExtension } from "../src/core/extensions";
import { lockedFeatures } from "../src/core/lockedFeatures";
import { bearer, createTestApp, seedSession } from "./helpers";

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
      const res = await ctx.app.inject({ method: "GET", url: `/ui/locked/${feature.id}`, headers: bearer(session.key) });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(feature.label);
      expect(res.body).toContain("Activate a license");
      expect(res.body).not.toContain("—");
    }
    const unknown = await ctx.app.inject({ method: "GET", url: "/ui/locked/nope", headers: bearer(session.key) });
    expect(unknown.statusCode).toBe(404);
  } finally {
    await ctx.cleanup();
  }
});

test("a licensed Community build points to the paid image instead of asking for a license", async () => {
  const ctx = await createTestApp({ TORRIX_EDITION: "pro" });
  try {
    const session = await seedSession(ctx);
    const res = await ctx.app.inject({ method: "GET", url: "/ui/locked/judge", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("not in this build");
    expect(res.body).toContain("keep your data volume and license key");
    expect(res.body).not.toContain("Activate a license");
    const enterprise = await ctx.app.inject({ method: "GET", url: "/ui/locked/sso", headers: bearer(session.key) });
    expect(enterprise.body).toContain("Activate a license");
  } finally {
    await ctx.cleanup();
  }
});

test("unlicensed extension pages render an upgrade card while APIs answer 402 JSON", async () => {
  const ctx = await createTestApp({}, { extensions: [uiStub] });
  try {
    const page = await ctx.app.inject({ method: "GET", url: "/ui/stub-page" });
    expect(page.statusCode).toBe(402);
    expect(String(page.headers["content-type"])).toContain("text/html");
    expect(page.body).toContain("Activate a license");

    const api = await ctx.app.inject({ method: "GET", url: "/api/stub-data" });
    expect(api.statusCode).toBe(402);
    expect(api.json()).toMatchObject({ error: "license_required" });

    ctx.config.license.override("pro");
    expect((await ctx.app.inject({ method: "GET", url: "/ui/stub-page" })).body).toContain("real page");
    const sso = await ctx.app.inject({ method: "GET", url: "/ui/stub-sso" });
    expect(sso.statusCode).toBe(402);
    expect(sso.body).toContain("Single sign-on");

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
    expect(res.body).toContain("Observed agents");
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
    expect(observed.body).toContain('href="/ui/locked/agent-control"');
    expect(observed.body).toContain('href="/ui/agents/observed"');
    expect(observed.body).not.toContain("?register=");
    expect(observed.body).toContain("See what Enterprise adds");
    expect(observed.body).toContain("Enterprise adds agent governance");
    expect(observed.body).not.toContain("—");

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

test("community governance keeps PII masking and shows paid controls as upgrade cards", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const page = await ctx.app.inject({ method: "GET", url: "/ui/governance", headers: bearer(session.key) });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("PII masking");
    expect(page.body).toContain('id="gv-save"');
    expect(page.body).not.toContain('id="gv-pol-create"');
    expect(page.body).toContain('href="/ui/locked/policies"');
    expect(page.body).toContain('href="/ui/locked/routing"');
    expect(page.body).toContain('href="/ui/locked/external-exports"');

    const compliance = await ctx.app.inject({ method: "GET", url: "/ui/compliance", headers: bearer(session.key) });
    expect(compliance.body).toContain("EU AI Act compliance");
    expect(compliance.body).toContain("Activate a license");
    expect(compliance.body).toContain('href="/ui/locked/compliance"');

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
    expect(datasets.body).not.toContain('id="jd-save"');
    expect(datasets.body).toContain('href="/ui/locked/judge"');

    await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const projects = await ctx.app.inject({ method: "GET", url: "/ui/projects", headers: bearer(session.key) });
    expect(projects.body).toContain('href="/ui/locked/online-evals"');

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

test("every community page's inline scripts compile", async () => {
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
    const failures: string[] = [];
    for (const url of pages) {
      const res = await ctx.app.inject({ method: "GET", url, headers: bearer(session.key) });
      if (res.statusCode !== 200) {
        failures.push(`${url}: HTTP ${res.statusCode}`);
        continue;
      }
      [...res.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((match, index) => {
        try {
          new Function(match[1]);
        } catch (err) {
          failures.push(`${url} script#${index}: ${(err as Error).message}`);
        }
      });
    }
    expect(failures).toEqual([]);
    const runPage = await ctx.app.inject({ method: "GET", url: `/ui/runs/${runId}`, headers: bearer(session.key) });
    expect(runPage.body).toContain('id="rd-cost-panel"');
    expect(runPage.body).toContain('href="/ui/locked/judge"');
  } finally {
    await ctx.cleanup();
  }
});
