import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { bearer, createTestApp, expectSpaShell, seedSession, type TestApp } from "./helpers";

// Project scoping is a server contract now that the console is a React SPA: the
// SPA sends ?project=, the API resolves it (or the sticky cookie) and echoes it
// back in the payload each page renders.

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

    const all = await ctx.app.inject({ method: "GET", url: "/api/cost/settings", headers: bearer(session.key) });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as {
      selected: unknown;
      projects: Array<{ id: string; name: string }>;
      usage: Array<{ scope: string; name: string }>;
    };
    expect(allBody.selected).toBeNull();
    expect(allBody.projects.map((entry) => entry.name).sort()).toEqual(["Alpha", "Beta", "Shared"]);
    expect(allBody.usage.map((row) => row.name)).toContain("Account (all projects)");

    const scoped = await ctx.app.inject({ method: "GET", url: `/api/cost/settings?project=${alpha}`, headers: bearer(session.key) });
    expect(scoped.statusCode).toBe(200);
    expect(String(scoped.headers["set-cookie"])).toContain(`torrix_project=${alpha}`);
    const scopedBody = scoped.json() as {
      selected: { id: string; name: string; budget_usd: number | null };
      selected_spend: number;
      usage: Array<{ scope: string; name: string }>;
    };
    expect(scopedBody.selected).toMatchObject({ id: alpha, name: "Alpha", budget_usd: null });
    expect(scopedBody.selected_spend).toBeCloseTo(1.5, 5);
    expect(scopedBody.usage.map((row) => row.name)).not.toContain("Account (all projects)");
    expect(scopedBody.usage.map((row) => row.name)).toContain("Alpha");

    const unknown = await ctx.app.inject({ method: "GET", url: `/api/cost/settings?project=${crypto.randomUUID()}`, headers: bearer(session.key) });
    expect(unknown.statusCode).toBe(200);
    expect((unknown.json() as { selected: unknown }).selected).toBeNull();
    const page = await ctx.app.inject({ method: "GET", url: `/ui/cost?project=${alpha}`, headers: bearer(session.key) });
    expectSpaShell(page.body);
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

    const adminRes = await ctx.app.inject({ method: "GET", url: "/api/team", headers: bearer(admin.key) });
    expect(adminRes.statusCode).toBe(200);
    const adminBody = adminRes.json() as {
      is_admin: boolean;
      projects: Array<{ name: string; role: string }>;
      users: Array<{ email: string }>;
      admin_projects: Array<{ id: string; name: string; owner_email: string | null; runs: number; spend: number }>;
    };
    expect(adminBody.is_admin).toBe(true);
    expect(adminBody.users.map((user) => user.email)).toContain("member@test.local");
    expect(adminBody.admin_projects.find((row) => row.id === owned)).toMatchObject({ name: "Member project", owner_email: "member@test.local", runs: 1 });
    expect(adminBody.admin_projects.find((row) => row.id === owned)?.spend).toBeCloseTo(2.5, 5);

    const memberRes = await ctx.app.inject({ method: "GET", url: "/api/team", headers: bearer(member.key) });
    expect(memberRes.statusCode).toBe(200);
    const memberBody = memberRes.json() as { is_admin: boolean; admin_projects: unknown[]; projects: Array<{ name: string }> };
    expect(memberBody.is_admin).toBe(false);
    expect(memberBody.admin_projects).toHaveLength(0);
    expect(memberBody.projects.map((project) => project.name)).toContain("Member project");
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

    const all = await ctx.app.inject({ method: "GET", url: "/api/dashboard", headers: bearer(session.key) });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { project_name: string | null }).project_name).toBeNull();

    const scoped = await ctx.app.inject({ method: "GET", url: `/api/dashboard?project=${project}`, headers: bearer(session.key) });
    expect(scoped.statusCode).toBe(200);
    expect((scoped.json() as { project_name: string | null }).project_name).toBe("Scoped project");
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
    const setScope = await ctx.app.inject({ method: "GET", url: `/api/dashboard?project=${alpha}`, headers: bearer(session.key) });
    expect(setScope.statusCode).toBe(200);
    expect(String(setScope.headers["set-cookie"])).toContain(`torrix_project=${alpha}`);

    // Every project-aware endpoint follows the cookie without a query param.
    const cookie = { ...bearer(session.key), cookie: `torrix_project=${alpha}` };
    const dashboard = await ctx.app.inject({ method: "GET", url: "/api/dashboard", headers: cookie });
    expect((dashboard.json() as { project_name: string | null }).project_name).toBe("Alpha");

    const runs = await ctx.app.inject({ method: "GET", url: "/api/runs", headers: cookie });
    const runBody = runs.json() as { runs: Array<{ name: string }>; total: number; summary: { traces: number } };
    expect(runBody.runs.map((run) => run.name)).toContain("alpha run");
    expect(runBody.runs.map((run) => run.name)).not.toContain("beta run");
    expect(runBody.total).toBe(1);
    expect(runBody.summary.traces).toBe(1);

    const analytics = await ctx.app.inject({ method: "GET", url: "/api/analytics/leaderboard", headers: cookie });
    expect(analytics.statusCode).toBe(200);

    const cost = await ctx.app.inject({ method: "GET", url: "/api/cost/settings", headers: cookie });
    expect((cost.json() as { selected: { name: string } | null }).selected?.name).toBe("Alpha");

    const traces = await ctx.app.inject({ method: "GET", url: "/api/traces", headers: cookie });
    const traceBody = traces.json() as { traces: Array<{ id: string }> };
    expect(traceBody.traces.map((group) => group.id)).toContain("trc-alpha");
    expect(traceBody.traces.map((group) => group.id)).not.toContain("trc-beta");

    const agents = await ctx.app.inject({ method: "GET", url: "/api/v1/observed-agents", headers: cookie });
    const agentBody = agents.json() as { agents: Array<{ name: string }> };
    expect(agentBody.agents.map((agent) => agent.name)).toContain("alpha-agent");
    expect(agentBody.agents.map((agent) => agent.name)).not.toContain("beta-agent");

    const report = await ctx.app.inject({ method: "GET", url: "/api/insights/generate", headers: cookie });
    expect(report.statusCode).toBe(200);
    expect(report.json().spendUsd).toBeCloseTo(1.5, 5);
    expect(report.json().runs).toBe(1);

    // An explicit empty param means all projects and clears the cookie.
    const cleared = await ctx.app.inject({ method: "GET", url: "/api/dashboard?project=", headers: cookie });
    expect((cleared.json() as { project_name: string | null }).project_name).toBeNull();
    expect(String(cleared.headers["set-cookie"])).toContain("torrix_project=;");
  } finally {
    await ctx.cleanup();
  }
});
