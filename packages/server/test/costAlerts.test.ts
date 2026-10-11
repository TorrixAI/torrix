import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { checkHardCap, evaluateRunCost, runWeeklyDigest } from "../src/lib/costGate";
import { generateApiKey, hashKey, keyPrefix } from "../src/lib/auth";
import { createTestApp, seedSession, type TestApp } from "./helpers";

interface CapturedPayload {
  event?: string;
  [key: string]: unknown;
}

function webhookServer() {
  const payloads: CapturedPayload[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      payloads.push((await req.json()) as CapturedPayload);
      return new Response("ok");
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/hook`,
    payloads,
    stop: () => server.stop(true),
  };
}

async function waitFor(assert: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assert()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("timed out waiting for condition");
}

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
    name: "alert run",
    model: "gpt-4o",
    provider: "openai",
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.01,
    latency_ms: 100,
    status: 200,
    source: "proxy",
    created_at: new Date().toISOString(),
    ...fields,
  } as unknown as Run;
  await ctx.repos.runs.save(run);
  return run;
}

test("budget alert reports the highest crossed level and refires only on a new level or day", async () => {
  const hook = webhookServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await ctx.repos.alerts.update(session.user.id, {
      enabled: 1,
      webhook_url: hook.url,
      budget_usd: 1,
    });
    await seedRun(ctx, session.user.id, projectId, { cost_usd: 0.6 });
    const costCtx = { userId: session.user.id, projectId, apiKeyId: null };

    await evaluateRunCost({ repos: ctx.repos }, costCtx, 0, { model: "gpt-4o" });
    await waitFor(() => hook.payloads.length === 1);
    expect(hook.payloads[0].event).toBe("cost.budget");
    expect(hook.payloads[0].level).toBe(0.5);

    await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.25, { model: "gpt-4o" });
    await waitFor(() => hook.payloads.length === 2);
    expect(hook.payloads[1].level).toBe(0.8);
    expect(hook.payloads[1].usage_pct).toBe(80);

    await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.01, { model: "gpt-4o" });
    await Bun.sleep(50);
    expect(hook.payloads.length).toBe(2);
  } finally {
    hook.stop();
    await ctx.cleanup();
  }
});

test("anomaly detection uses the 30-day p95 with a ten-run minimum and an hourly per-model cooldown", async () => {
  const hook = webhookServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await ctx.repos.alerts.update(session.user.id, {
      enabled: 1,
      webhook_url: hook.url,
      anomaly_enabled: 1,
      anomaly_multiplier: 3,
    });
    for (let i = 0; i < 10; i += 1) {
      await seedRun(ctx, session.user.id, projectId, { model: "claude-x", cost_usd: 0.01 });
    }
    for (let i = 0; i < 3; i += 1) {
      await seedRun(ctx, session.user.id, projectId, { model: "rare-model", cost_usd: 0.01 });
    }
    const costCtx = { userId: session.user.id, projectId, apiKeyId: null };

    const first = await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.05, { model: "claude-x", runId: "run-anomaly-1" });
    expect(first.isAnomaly).toBe(true);
    await waitFor(() => hook.payloads.some((p) => p.event === "cost.anomaly"));
    const anomaly = hook.payloads.find((p) => p.event === "cost.anomaly")!;
    expect(anomaly.baseline_p95_usd).toBe(0.01);
    expect(anomaly.factor).toBe(5);

    const second = await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.06, { model: "claude-x", runId: "run-anomaly-2" });
    expect(second.isAnomaly).toBe(true);
    await Bun.sleep(50);
    expect(hook.payloads.filter((p) => p.event === "cost.anomaly")).toHaveLength(1);

    const rare = await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.9, { model: "rare-model", runId: "run-rare" });
    expect(rare.isAnomaly).toBe(false);
  } finally {
    hook.stop();
    await ctx.cleanup();
  }
});

test("error alerts fire for failed runs when notify_on_error is on", async () => {
  const hook = webhookServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await ctx.repos.alerts.update(session.user.id, {
      enabled: 1,
      webhook_url: hook.url,
      notify_on_error: 1,
    });
    const costCtx = { userId: session.user.id, projectId, apiKeyId: null };

    const failed = await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.001, {
      runId: "run-error-1",
      model: "gpt-4o",
      status: 500,
      error: "upstream exploded",
    });
    expect(failed.alertSent).toBe(true);
    await waitFor(() => hook.payloads.some((p) => p.event === "run.error"));
    const payload = hook.payloads.find((p) => p.event === "run.error")!;
    expect(payload.http_status).toBe(500);
    expect(payload.detail).toBe("upstream exploded");
    expect(payload.run_id).toBe("run-error-1");

    const ok = await evaluateRunCost({ repos: ctx.repos }, costCtx, 0.001, { runId: "run-ok", model: "gpt-4o", status: 200 });
    expect(ok.alertSent).toBe(false);
    await Bun.sleep(50);
    expect(hook.payloads.filter((p) => p.event === "run.error")).toHaveLength(1);
  } finally {
    hook.stop();
    await ctx.cleanup();
  }
});

test("hard caps compare each scope against its own spend", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectA = await seedProject(ctx, session.user.id);
    const projectB = await seedProject(ctx, session.user.id);
    await ctx.repos.projects.updateBudget(projectA, { hard_cap_usd: 1 });
    await seedRun(ctx, session.user.id, projectA, { cost_usd: 1.5 });

    const overA = await checkHardCap({ repos: ctx.repos }, { userId: session.user.id, projectId: projectA, apiKeyId: null });
    expect(overA.blocked).toBe(true);
    expect(overA.cap).toBe(1);
    expect(overA.spend).toBeCloseTo(1.5, 6);

    const underB = await checkHardCap({ repos: ctx.repos }, { userId: session.user.id, projectId: projectB, apiKeyId: null });
    expect(underB.blocked).toBe(false);

    const keyId = crypto.randomUUID();
    const key = generateApiKey();
    await ctx.repos.apiKeys.create({
      id: keyId,
      user_id: session.user.id,
      name: "scoped-key",
      key_hash: hashKey(key),
      key_prefix: keyPrefix(key),
      scope: "full",
      projects: null,
      permission: "read_write",
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      budget_usd: null,
      hard_cap_usd: 0.5,
    });
    await seedRun(ctx, session.user.id, projectA, { cost_usd: 0.6, api_key_id: keyId });

    const overKey = await checkHardCap({ repos: ctx.repos }, { userId: session.user.id, projectId: projectB, apiKeyId: keyId });
    expect(overKey.blocked).toBe(true);
    expect(overKey.cap).toBe(0.5);

    const noKey = await checkHardCap({ repos: ctx.repos }, { userId: session.user.id, projectId: projectB, apiKeyId: null });
    expect(noKey.blocked).toBe(false);
  } finally {
    await ctx.cleanup();
  }
});

test("project budget alerts use project spend and name the scope", async () => {
  const hook = webhookServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await ctx.repos.alerts.update(session.user.id, { enabled: 1, webhook_url: hook.url });
    await ctx.repos.projects.updateBudget(projectId, { budget_usd: 0.01 });
    await seedRun(ctx, session.user.id, projectId, { cost_usd: 0.006 });

    const outcome = await evaluateRunCost({ repos: ctx.repos }, { userId: session.user.id, projectId, apiKeyId: null }, 0, { model: "gpt-4o" });
    expect(outcome.alertSent).toBe(true);
    await waitFor(() => hook.payloads.some((p) => p.event === "cost.budget"));
    const payload = hook.payloads.find((p) => p.event === "cost.budget")!;
    expect(payload.scope).toBe("project");
    expect(payload.scope_name).toBe("Default");
    expect(payload.budget_usd).toBe(0.01);
    expect(payload.level).toBe(0.5);
  } finally {
    hook.stop();
    await ctx.cleanup();
  }
});

test("weekly digest includes week-over-week deltas", async () => {
  const hook = webhookServer();
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    await ctx.repos.alerts.update(session.user.id, {
      enabled: 1,
      webhook_url: hook.url,
      digest_enabled: 1,
    });
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await seedRun(ctx, session.user.id, projectId, { cost_usd: 1, created_at: tenDaysAgo });
    await seedRun(ctx, session.user.id, projectId, { cost_usd: 1 });
    await seedRun(ctx, session.user.id, projectId, { cost_usd: 1 });

    const result = await runWeeklyDigest({ repos: ctx.repos }, session.user.id, true);
    expect(result.sent).toBe(true);
    const vsPrior = result.payload?.vs_prior_week as { cost_change_pct: number | null; runs_change_pct: number | null };
    expect(vsPrior.cost_change_pct).toBe(100);
    expect(vsPrior.runs_change_pct).toBe(100);
    expect(result.payload?.period_start).toBeTruthy();
    expect(hook.payloads[0].event).toBe("cost.weekly_digest");
  } finally {
    hook.stop();
    await ctx.cleanup();
  }
});
