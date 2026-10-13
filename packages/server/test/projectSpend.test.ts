import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

async function seedProject(ctx: TestApp, userId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await ctx.repos.projects.create({ id, user_id: userId, name, created_at: new Date().toISOString() });
  return id;
}

async function seedRun(ctx: TestApp, userId: string, projectId: string, cost: number, name = "spend run", extra: Partial<Run> = {}): Promise<void> {
  await ctx.repos.runs.save({
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: projectId,
    name,
    provider: "openai",
    model: "gpt-4o-mini",
    status: 200,
    source: "proxy",
    cost_usd: cost,
    input_tokens: 10,
    output_tokens: 5,
    created_at: new Date().toISOString(),
    ...extra,
  } as unknown as Run);
}

test("the cost page scopes to one project and lists member projects", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const alpha = await seedProject(ctx, session.user.id, "Alpha");
    const beta = await seedProject(ctx, session.user.id, "Beta");
    await seedRun(ctx, session.user.id, alpha, 1.5);
    await seedRun(ctx, session.user.id, beta, 0.25);

    const other = await seedSession(ctx, "other@test.local");
    const shared = await seedProject(ctx, other.user.id, "Shared");
    await ctx.repos.projects.addMember(shared, session.user.id, "viewer");
    await seedRun(ctx, other.user.id, shared, 0.75);

    const all = await ctx.app.inject({ method: "GET", url: "/ui/cost", headers: bearer(session.key) });
    expect(all.statusCode).toBe(200);
    expect(all.body).toContain('id="co-project"');
    expect(all.body).toContain("Alpha");
    expect(all.body).toContain("Beta");
    expect(all.body).toContain("Shared");
    expect(all.body).toContain("Account (all projects)");
    expect(all.body).toContain("every project on this account in one table");

    const scoped = await ctx.app.inject({ method: "GET", url: `/ui/cost?project=${alpha}`, headers: bearer(session.key) });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.body).toContain("scoped to Alpha");
    expect(scoped.body).toContain("1.5");
    expect(scoped.body).toContain(`/ui/runs?project=${alpha}`);
    expect(scoped.body).toContain(`/ui/analytics?project=${alpha}`);
    expect(scoped.body).toContain("project budget");
    expect(scoped.body).not.toContain("Account (all projects)");

    const unknown = await ctx.app.inject({ method: "GET", url: `/ui/cost?project=${crypto.randomUUID()}`, headers: bearer(session.key) });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body).toContain("every project on this account in one table");
  } finally {
    await ctx.cleanup();
  }
});

test("the team page shows an admin all-projects spend table", async () => {
  const ctx = await createTestApp();
  try {
    const admin = await seedSession(ctx);
    const member = await seedSession(ctx, "member@test.local");
    await ctx.repos.users.setAdmin(member.user.id, 0);
    const owned = await seedProject(ctx, member.user.id, "Member project");
    await seedRun(ctx, member.user.id, owned, 2.5);

    const adminPage = await ctx.app.inject({ method: "GET", url: "/ui/team", headers: bearer(admin.key) });
    expect(adminPage.statusCode).toBe(200);
    expect(adminPage.body).toContain("All projects (admin)");
    expect(adminPage.body).toContain("Member project");
    expect(adminPage.body).toContain("member@test.local");
    expect(adminPage.body).toContain("2.5");
    expect(adminPage.body).toContain(`/ui/runs?project=${owned}`);

    const memberPage = await ctx.app.inject({ method: "GET", url: "/ui/team", headers: bearer(member.key) });
    expect(memberPage.statusCode).toBe(200);
    expect(memberPage.body).not.toContain("All projects (admin)");
  } finally {
    await ctx.cleanup();
  }
});

test("the dashboard header names the scoped project", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const project = await seedProject(ctx, session.user.id, "Scoped project");
    await seedRun(ctx, session.user.id, project, 0.5);

    const all = await ctx.app.inject({ method: "GET", url: "/ui/dashboard", headers: bearer(session.key) });
    expect(all.statusCode).toBe(200);
    expect(all.body).toContain("all projects");

    const scoped = await ctx.app.inject({ method: "GET", url: `/ui/dashboard?project=${project}`, headers: bearer(session.key) });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.body).toContain("project Scoped project");
  } finally {
    await ctx.cleanup();
  }
});

test("the project scope sticks across pages through the cookie", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const alpha = await seedProject(ctx, session.user.id, "Alpha");
    const beta = await seedProject(ctx, session.user.id, "Beta");
    await seedRun(ctx, session.user.id, alpha, 1.5, "alpha run", { trace_id: "trc-alpha", session_id: "ses-alpha", agent_name: "alpha-agent" });
    await seedRun(ctx, session.user.id, beta, 0.25, "beta run", { trace_id: "trc-beta", session_id: "ses-beta", agent_name: "beta-agent" });

    // Picking a project sets the sticky cookie.
    const setScope = await ctx.app.inject({ method: "GET", url: `/ui/dashboard?project=${alpha}`, headers: bearer(session.key) });
    expect(setScope.statusCode).toBe(200);
    expect(String(setScope.headers["set-cookie"])).toContain(`torrix_project=${alpha}`);
    expect(setScope.body).toContain("project Alpha");

    // Every project-aware page follows the cookie without a query param.
    const cookie = { ...bearer(session.key), cookie: `torrix_project=${alpha}` };
    const dashboard = await ctx.app.inject({ method: "GET", url: "/ui/dashboard", headers: cookie });
    expect(dashboard.body).toContain("project Alpha");
    const runs = await ctx.app.inject({ method: "GET", url: "/ui/runs", headers: cookie });
    expect(runs.body).toContain("alpha run");
    expect(runs.body).not.toContain("beta run");
    expect(runs.body).toContain("$1.5");
    expect(runs.body).not.toContain("$1.75");
    const analytics = await ctx.app.inject({ method: "GET", url: "/ui/analytics", headers: cookie });
    expect(analytics.body).toContain("project Alpha");
    const cost = await ctx.app.inject({ method: "GET", url: "/ui/cost", headers: cookie });
    expect(cost.body).toContain("scoped to Alpha");
    const traces = await ctx.app.inject({ method: "GET", url: "/ui/traces", headers: cookie });
    expect(traces.body).toContain("Project Alpha");
    expect(traces.body).toContain("trc-alpha");
    expect(traces.body).not.toContain("trc-beta");
    const agents = await ctx.app.inject({ method: "GET", url: "/ui/agents/observed", headers: cookie });
    expect(agents.body).toContain("alpha-agent");
    expect(agents.body).not.toContain("beta-agent");
    const live = await ctx.app.inject({ method: "GET", url: "/ui/live", headers: cookie });
    expect(live.body).toContain("project Alpha");
    expect(live.body).toContain(`var scope=${JSON.stringify(alpha)}`);
    const insights = await ctx.app.inject({ method: "GET", url: "/ui/insights", headers: cookie });
    expect(insights.body).toContain("Project Alpha");
    const report = await ctx.app.inject({ method: "GET", url: "/api/insights/generate", headers: cookie });
    expect(report.statusCode).toBe(200);
    expect(report.json().spendUsd).toBeCloseTo(1.5, 5);
    expect(report.json().runs).toBe(1);

    // An explicit empty param means all projects and clears the cookie.
    const cleared = await ctx.app.inject({ method: "GET", url: "/ui/dashboard?project=", headers: cookie });
    expect(cleared.body).toContain("all projects");
    expect(String(cleared.headers["set-cookie"])).toContain("torrix_project=;");

    // An explicit project wins over the cookie and re-sets it.
    const override = await ctx.app.inject({ method: "GET", url: `/ui/dashboard?project=${beta}`, headers: cookie });
    expect(override.body).toContain("project Beta");
    expect(String(override.headers["set-cookie"])).toContain(`torrix_project=${beta}`);

    // An unknown project id falls back to all projects.
    const unknown = await ctx.app.inject({ method: "GET", url: "/ui/dashboard?project=nope", headers: cookie });
    expect(unknown.body).toContain("all projects");
  } finally {
    await ctx.cleanup();
  }
});
