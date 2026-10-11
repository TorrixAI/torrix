import { expect, test } from "bun:test";
import { bearer, createTestApp, seedSession } from "./helpers";

test("client-chosen run ids can never write into another user's run", async () => {
  const ctx = await createTestApp({ TORRIX_USER_LIMIT: "5" });
  try {
    const victim = await seedSession(ctx, "victim@test.local");
    const attacker = await seedSession(ctx, "attacker@test.local");
    for (const user of [victim.user.id, attacker.user.id]) {
      await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: user, name: "Default", created_at: new Date().toISOString() });
    }
    const victimIngest = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(victim.key),
      payload: { records: [{ id: "shared-run-id", model: "gpt-4o-mini", input_tokens: 10, output_tokens: 2 }] },
    });
    expect(victimIngest.json()).toMatchObject({ accepted: 1 });
    const before = await ctx.repos.events.listByRun("shared-run-id");

    const viaIngest = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(attacker.key),
      payload: { records: [{ id: "shared-run-id", model: "gpt-4o", input_tokens: 99999, response: { body: "injected" } }] },
    });
    expect(viaIngest.json()).toMatchObject({ accepted: 0, rejected: [{ id: "shared-run-id", error: "run_id_conflict" }] });

    const viaProxy = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: { ...bearer(attacker.key), "x-run-id": "shared-run-id", "x-target-url": "https://api.openai.com/v1/chat/completions" },
      payload: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    });
    expect(viaProxy.statusCode).toBe(409);

    const run = await ctx.repos.runs.getById("shared-run-id", victim.user.id);
    expect(run?.input_tokens).toBe(10);
    expect((await ctx.repos.events.listByRun("shared-run-id")).length).toBe(before.length);
  } finally {
    await ctx.cleanup();
  }
});
