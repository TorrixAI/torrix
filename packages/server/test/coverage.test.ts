import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
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
    name: "coverage run",
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

test("runs repo: filters, updates, groups, share tokens and retention", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const projectId = await seedProject(ctx, session.user.id);
    const good = await seedRun(ctx, session.user.id, projectId, {
      name: "alpha question",
      model: "gpt-4o-mini",
      score: 1,
      is_golden: 1,
      trace_id: "trace-cov-1",
      session_id: "session-cov-1",
      share_token: "shr_coverage_token_123456",
    });
    await seedRun(ctx, session.user.id, projectId, { name: "beta question", model: "claude-3-5-sonnet", score: 0 });
    await seedRun(ctx, session.user.id, projectId, { name: "gamma question", status: 500, source: "otel" });

    const all = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(all.total).toBe(3);
    const scoredGood = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, score: "good" });
    expect(scoredGood.runs.map((r) => r.name)).toEqual(["alpha question"]);
    const searched = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, search: "beta" });
    expect(searched.runs).toHaveLength(1);
    const bySource = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0, source: "otel" });
    expect(bySource.runs).toHaveLength(1);

    await ctx.repos.runs.update(good.id, { run_note: "looks right", review_state: "approved" });
    const reloaded = await ctx.repos.runs.getById(good.id, session.user.id);
    expect(reloaded?.run_note).toBe("looks right");
    expect(reloaded?.review_state).toBe("approved");
    expect(await ctx.repos.runs.countGolden(session.user.id)).toBe(1);

    const groups = await ctx.repos.runs.listGroups(session.user.id, "trace", 10);
    expect(groups).toHaveLength(1);
    expect(groups[0].runs).toBe(1);
    const grouped = await ctx.repos.runs.listGroup(session.user.id, { kind: "session", id: "session-cov-1", limit: 10, offset: 0 });
    expect(grouped.runs.map((r) => r.id)).toEqual([good.id]);

    const shared = await ctx.repos.runs.getByShareToken("shr_coverage_token_123456");
    expect(shared?.id).toBe(good.id);

    const deleted = await ctx.repos.runs.deleteOld(session.user.id, -1);
    expect(deleted).toBe(2);
    const remaining = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    expect(remaining.total).toBe(1);
    expect(remaining.runs[0].id).toBe(good.id);
    expect(await ctx.repos.runs.listGolden(session.user.id, 10)).toHaveLength(1);
  } finally {
    await ctx.cleanup();
  }
});

test("proxy masks PII on the stored run", async () => {
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model?: string };
      return Response.json({
        id: "chatcmpl-cov",
        model: body.model ?? "gpt-4o",
        choices: [{ index: 0, message: { role: "assistant", content: "noted" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
      });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);
    await ctx.repos.governance.updateSettings(session.user.id, {
      pii_enabled: 1,
      pii_mask_input: 1,
      pii_types: JSON.stringify(["email"]),
    });

    const masked = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        ...bearer(session.key),
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/chat/completions`,
        "x-upstream-authorization": "Bearer upstream",
      },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "contact jane@corp.example about it" }] },
    });
    expect(masked.statusCode).toBe(200);
    const runs = await ctx.repos.runs.list(session.user.id, { limit: 10, offset: 0 });
    const stored = runs.runs[0];
    expect(stored.pii_masked).toBe(1);
    expect(stored.request_body ?? "").not.toContain("jane@corp.example");
    expect(stored.name ?? "").not.toContain("jane@corp.example");
    expect(JSON.parse(stored.pii_findings ?? "[]")[0].type).toBe("email");
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});

test("ingest masks PII in the auto-derived run name", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);
    await ctx.repos.governance.updateSettings(session.user.id, {
      pii_enabled: 1,
      pii_mask_input: 1,
      pii_types: JSON.stringify(["email"]),
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            id: "pii-name-1",
            model: "gpt-4o-mini",
            request: { body: { messages: [{ role: "user", content: "contact jane@corp.example for details" }] } },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = await ctx.repos.runs.getById("pii-name-1", session.user.id);
    expect(stored?.name ?? "").not.toContain("jane@corp.example");
    expect(stored?.name ?? "").toContain("[redacted]");
    expect(stored?.pii_masked).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

test("masking enabled with no selected types masks every type", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await seedProject(ctx, session.user.id);
    const put = await ctx.app.inject({
      method: "PUT",
      url: "/api/governance/settings",
      headers: bearer(session.key),
      payload: { pii_enabled: 1, pii_mask_input: 1, pii_mask_output: 1 },
    });
    expect(put.statusCode).toBe(200);
    const settings = (JSON.parse(put.body) as { settings: { pii_types: string } }).settings;
    expect(settings.pii_types).toContain("email");
    expect(settings.pii_types).toContain("card");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [
          {
            id: "pii-default-1",
            model: "gpt-4o-mini",
            request: { body: { messages: [{ role: "user", content: "mail jane@corp.example today" }] } },
            response: { body: { choices: [{ message: { role: "assistant", content: "sent to jane@corp.example" } }] } },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = await ctx.repos.runs.getById("pii-default-1", session.user.id);
    expect(stored?.request_body ?? "").not.toContain("jane@corp.example");
    expect(stored?.name ?? "").not.toContain("jane@corp.example");
    expect(stored?.pii_masked).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});
