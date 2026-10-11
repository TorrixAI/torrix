import { expect, test } from "bun:test";
import { calculateCost, loadFetchedPricing, removePricingOverride, setPricingOverride } from "../src/lib/pricing";
import { bearer, createTestApp, seedSession } from "./helpers";

test("Claude cache reads and writes are priced; OpenAI cached tokens are not double counted", () => {
  setPricingOverride("claude-cache-test", 10, 20);
  setPricingOverride("gpt-cache-test", 10, 20);
  try {
    expect(calculateCost("claude-cache-test", 100, 10, { read: 1000, write: 400 })).toBeCloseTo(
      (100 * 10 + 10 * 20 + (1000 * 0.1 + 400 * 1.25) * 10) / 1e6,
      12,
    );
    expect(calculateCost("gpt-cache-test", 100, 10, { read: 1000, write: 400 })).toBeCloseTo((100 * 10 + 10 * 20) / 1e6, 12);
    expect(calculateCost("claude-cache-test", 100, 10)).toBeCloseTo((100 * 10 + 10 * 20) / 1e6, 12);
  } finally {
    removePricingOverride("claude-cache-test");
    removePricingOverride("gpt-cache-test");
  }
});

test("synced prices match model ids across dot, dash and date-suffix spellings", () => {
  loadFetchedPricing([
    { model: "anthropic/claude-spelling-9.1", input: 3, output: 15 },
    { model: "claude-dated-2-0-20990101", input: 1, output: 5 },
  ]);
  try {
    expect(calculateCost("claude-spelling-9-1", 1_000_000, 0)).toBeCloseTo(3, 9);
    expect(calculateCost("claude-dated-2-0", 1_000_000, 0)).toBeCloseTo(1, 9);
  } finally {
    loadFetchedPricing([]);
  }
});

test("ingest parses Anthropic message bodies and treats repeated ids as already accepted", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
    const record = {
      id: "anthropic-shape-1",
      provider: "anthropic",
      model: "claude-shape",
      request: { body: { model: "claude-shape", messages: [{ role: "user", content: "hi" }] } },
      response: {
        body: {
          model: "claude-shape",
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "consider" },
            { type: "text", text: "hello there" },
            { type: "tool_use", id: "t1", name: "Read", input: { path: "a" } },
          ],
          usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 40, cache_creation_input_tokens: 9 },
        },
      },
    };
    const first = await ctx.app.inject({ method: "POST", url: "/api/ingest", headers: bearer(session.key), payload: { records: [record] } });
    expect(first.json()).toMatchObject({ accepted: 1, ids: ["anthropic-shape-1"] });
    const run = await ctx.repos.runs.getById("anthropic-shape-1", session.user.id);
    expect(run).toMatchObject({ input_tokens: 3, output_tokens: 7, cache_read_tokens: 40, cache_creation_tokens: 9, finish_reason: "end_turn" });
    const events = await ctx.repos.events.listByRun("anthropic-shape-1");
    expect(events.find((e) => e.type === "response")?.message).toContain("hello there");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["thinking", "tool_call"]));

    const retry = await ctx.app.inject({ method: "POST", url: "/api/ingest", headers: bearer(session.key), payload: { records: [record] } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ accepted: 1, ids: ["anthropic-shape-1"] });
    expect((await ctx.repos.events.listByRun("anthropic-shape-1")).length).toBe(events.length);
  } finally {
    await ctx.cleanup();
  }
});
