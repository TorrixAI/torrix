import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { bearer, createTestApp, seedSession, type TestApp } from "./helpers";

const githubSecret = `github_pat_${"A".repeat(30)}`;
const bearerSecret = `Authorization: Bearer ${"B".repeat(24)}`;

async function seedRuns(ctx: TestApp, userId: string): Promise<void> {
  const project = (await ctx.repos.projects.findDefault(userId)) ?? {
    id: crypto.randomUUID(),
    user_id: userId,
    name: "Secrets",
    created_at: new Date().toISOString(),
  };
  if (!(await ctx.repos.projects.findDefault(userId))) {
    await ctx.repos.projects.create(project);
  }
  const now = new Date().toISOString();
  const first: Run = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: project!.id,
    name: `debug ${githubSecret}`,
    request_body: JSON.stringify({ messages: [{ role: "user", content: `token ${githubSecret}` }] }),
    source: "sdk",
    status: 200,
    created_at: now,
  } as Run;
  await ctx.repos.runs.save(first);
  const second: Run = {
    id: crypto.randomUUID(),
    user_id: userId,
    project_id: project!.id,
    name: "second run",
    source: "sdk",
    status: 200,
    created_at: now,
  } as Run;
  await ctx.repos.runs.save(second);
  await ctx.repos.events.add({
    id: crypto.randomUUID(),
    run_id: second.id,
    type: "request",
    message: bearerSecret,
    created_at: now,
  });
}

test("the secret notice endpoint returns a count and never the value", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await seedRuns(ctx, session.user.id);
    await ctx.repos.governance.updateSettings(session.user.id, { pii_enabled: 0, updated_at: new Date().toISOString() });

    const res = await ctx.app.inject({ method: "GET", url: "/api/security/secret-notice", headers: bearer(session.key) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; masking: boolean };
    expect(body.count).toBe(2);
    expect(body.masking).toBe(false);
    expect(JSON.stringify(body)).not.toContain(githubSecret);
    expect(JSON.stringify(body)).not.toContain(bearerSecret);

    await ctx.repos.governance.updateSettings(session.user.id, { pii_enabled: 1, updated_at: new Date().toISOString() });
    const masked = await ctx.app.inject({ method: "GET", url: "/api/security/secret-notice", headers: bearer(session.key) });
    expect(masked.statusCode).toBe(200);
    expect((masked.json() as { count: number; masking: boolean }).count).toBe(0);
    expect((masked.json() as { masking: boolean }).masking).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

test.skipIf(!browserPath)("the secret warning shows a count, never the secret, and stays dismissed", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    await seedRuns(ctx, session.user.id);
    await ctx.repos.governance.updateSettings(session.user.id, { pii_enabled: 0, updated_at: new Date().toISOString() });
    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);
    await page.goto(`${origin}/ui/runs`, "!!document.querySelector('[data-test=\"secret-notice\"]')", "secret notice");
    const text = await page.eval<string>("document.querySelector('[data-test=\"secret-notice\"]').innerText");
    expect(text).toContain("2 runs contain what looks like an access token");
    expect(text).toContain("Turn on masking or delete them");
    expect(text).not.toContain(githubSecret);
    await page.eval("document.querySelector('[data-test=\"secret-notice\"] button').click()");
    await page.goto(`${origin}/ui/runs`, "document.readyState==='complete' && !!document.querySelector('.content')", "runs after dismissal");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await page.eval("!!document.querySelector('[data-test=\"secret-notice\"]')")).toBe(false);
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
