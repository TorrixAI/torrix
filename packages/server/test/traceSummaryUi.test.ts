import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession } from "./helpers";

const SVG_PATH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 6.399L21.979 16.754L24.561 12.283L22.095 13.706L21.283 12.299L29 7.843L21.979 20.004L16 9.649L10.021 20.004L3 7.843L10.717 12.299L9.905 13.706L7.439 12.283L10.021 16.754Z"/></svg>`;

function run(id: string, userId: string, projectId: string, traceId: string, createdAt: string, requestBody: string): Run {
  return {
    id,
    user_id: userId,
    project_id: projectId,
    trace_id: traceId,
    session_id: traceId,
    name: "loop step",
    status: 200,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 10,
    output_tokens: 5,
    cost_usd: 0.001,
    latency_ms: 100,
    request_body: requestBody,
    created_at: createdAt,
  } as Run;
}

test.skipIf(!browserPath)("turn summary keeps the human prompt and clamps long answers", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Prompt fixtures", created_at: new Date().toISOString() });
    const base = Date.parse("2026-10-25T10:00:00.000Z");
    for (const [traceId, , second] of [
      ["anthropic-loop", "Review the supplier order before it is sent.", JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "Review the supplier order before it is sent." }] }, { role: "assistant", content: [{ type: "tool_use", name: "read", input: { path: "orders.json" } }] }, { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: SVG_PATH }] }] }] })],
      ["openai-loop", "Check the Northwind order total.", JSON.stringify({ messages: [{ role: "user", content: "Check the Northwind order total." }, { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "shell", arguments: "{\"command\":\"cat orders.json\"}" } }] }, { role: "tool", tool_call_id: "c1", content: SVG_PATH }] })],
      ["plain", "Summarize this run.", JSON.stringify({ messages: [{ role: "user", content: "Summarize this run." }] })],
    ] as const) {
      const firstId = crypto.randomUUID();
      await ctx.repos.runs.save(run(firstId, session.user.id, projectId, traceId, new Date(base).toISOString(), second));
      await ctx.repos.events.add({ id: crypto.randomUUID(), run_id: firstId, type: "request", message: second, created_at: new Date(base).toISOString() });
      if (traceId === "plain") {
        const answer = Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of the readable answer.`).join("\n");
        await ctx.repos.events.add({ id: crypto.randomUUID(), run_id: firstId, type: "response", message: answer, created_at: new Date(base + 100).toISOString() });
      }
      // The second loop step carries the tool-result blob, which must never win.
      const secondId = crypto.randomUUID();
      await ctx.repos.runs.save(run(secondId, session.user.id, projectId, traceId, new Date(base + 1000).toISOString(), second));
    }

    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);

    for (const [traceId, prompt] of [
      ["anthropic-loop", "Review the supplier order before it is sent."],
      ["openai-loop", "Check the Northwind order total."],
      ["plain", "Summarize this run."],
    ] as const) {
      await page.goto(`${origin}/ui/traces/${traceId}`, "!!document.querySelector('[data-test=turn-summary]')", `${traceId} summary`);
      const shown = await page.eval<string>("document.querySelector('[data-test=turn-prompt]').innerText");
      expect(shown).toContain(prompt);
      expect(shown).not.toContain("svg");
      expect(shown).not.toContain("M16 6.399");
    }

    await page.waitFor("!!document.querySelector('[data-test=turn-answer] .clamp-toggle')", "clamped answer");
    const toggle = await page.eval<boolean>("!!document.querySelector('[data-test=turn-answer] .clamp-toggle')");
    expect(toggle).toBe(true);
    await page.eval("document.querySelector('[data-test=turn-answer] .clamp-toggle').click()");
    expect(await page.eval<string>("document.querySelector('[data-test=turn-answer] .clamp-toggle').getAttribute('aria-expanded')")).toBe("true");
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
