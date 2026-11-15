import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession, type TestApp } from "./helpers";

function runRow(overrides: Partial<Run> & { id: string; user_id: string; project_id: string }): Run {
  return {
    name: "first prompt",
    status: 200,
    source: "sdk",
    provider: "openai",
    model: "gpt-4o",
    input_tokens: 10,
    output_tokens: 5,
    latency_ms: 100,
    cost_usd: 0.001,
    created_at: new Date().toISOString(),
    ...overrides,
  } as Run;
}

async function addEvent(ctx: TestApp, runId: string, type: string, message: string, createdAt = new Date().toISOString()) {
  await ctx.repos.events.add({ id: crypto.randomUUID(), run_id: runId, type, message, created_at: createdAt });
}

test.skipIf(!browserPath)("the React console labels steps, groups by trace, and leads run detail with a conversation", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Console clarity", created_at: new Date().toISOString() });
    const traceId = "trace-labels";
    const base = Date.parse("2026-10-25T10:00:00.000Z");
    const specs = [
      { tool: { name: "Edit", arguments: { file_path: "packages/server/src/lib/x.ts" } }, extra: { name: "Bash", arguments: { command: "bun run typecheck" } } },
      { tool: { name: "Bash", arguments: { command: "bun test" } } },
      { tool: { name: "Read", arguments: { file_path: "engine.ts" } } },
    ];
    for (let i = 0; i < specs.length; i += 1) {
      const id = crypto.randomUUID();
      const run = runRow({ id, user_id: session.user.id, project_id: projectId, trace_id: traceId, created_at: new Date(base + i * 1000).toISOString() });
      await ctx.repos.runs.save(run);
      await addEvent(ctx, id, "request", JSON.stringify({ messages: [{ role: "user", content: "first prompt" }] }), run.created_at);
      await addEvent(ctx, id, "tool_call", JSON.stringify([specs[i].tool]), run.created_at);
      if (specs[i].extra) await addEvent(ctx, id, "tool_call", JSON.stringify([specs[i].extra]), new Date(base + 500).toISOString());
    }
    const answerId = crypto.randomUUID();
    await ctx.repos.runs.save(runRow({ id: answerId, user_id: session.user.id, project_id: projectId, trace_id: traceId, created_at: new Date(base + 4000).toISOString() }));
    await addEvent(ctx, answerId, "response", "The final answer is ready.", new Date(base + 4000).toISOString());
    const thinkingId = crypto.randomUUID();
    await ctx.repos.runs.save(runRow({ id: thinkingId, user_id: session.user.id, project_id: projectId, trace_id: traceId, created_at: new Date(base + 5000).toISOString() }));
    await addEvent(ctx, thinkingId, "thinking", "I am checking the next step.", new Date(base + 5000).toISOString());

    const detailId = crypto.randomUUID();
    await ctx.repos.runs.save(runRow({
      id: detailId,
      user_id: session.user.id,
      project_id: projectId,
      name: "first prompt",
      request_body: JSON.stringify({ messages: [{ role: "user", content: "Fix D:\\Project\\x\nNext line" }] }),
      created_at: new Date(base + 6000).toISOString(),
    }));
    await addEvent(ctx, detailId, "response", JSON.stringify({
      choices: [{ message: { content: "", reasoning_content: "I need to inspect the file first.", tool_calls: [{ function: { name: "Read", arguments: "{\"file_path\":\"engine.ts\"}" } }] } }],
    }), new Date(base + 6000).toISOString());

    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);

    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('Edit packages/server/src/lib/x.ts')", "runs step labels");
    const runsText = await page.eval<string>("document.body.innerText");
    expect(runsText).toContain("Edit packages/server/src/lib/x.ts");
    expect(runsText).toContain("Bash bun test");
    expect(runsText).toContain("Read engine.ts");
    expect(runsText).toContain("Answer");
    expect(runsText).toContain("Thinking");
    expect(runsText).toContain("grouped by trace");

    await page.eval("document.querySelector('[aria-label=\"Group runs\"]').click()");
    await page.waitFor("!!document.querySelector('[role=listbox]')", "group menu");
    await page.eval("Array.from(document.querySelectorAll('[role=option]')).find(function(option){return option.textContent.trim()==='None'})?.click()");
    await page.waitFor("!!localStorage.getItem('torrix_run_group') && localStorage.getItem('torrix_run_group')==='none'", "flat group remembered");
    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('Edit packages/server/src/lib/x.ts')", "runs after grouping choice");
    expect(await page.eval("document.querySelector('[aria-label=\"Group runs\"]')?.textContent")).toContain("None");

    await page.goto(`${origin}/ui/traces/${traceId}`, "document.body.innerText.includes('Turn summary') && document.body.innerText.includes('The final answer is ready.')", "trace turn summary");
    const traceText = await page.eval<string>("document.body.innerText");
    expect(traceText).toContain("Edit packages/server/src/lib/x.ts");
    expect(traceText).toContain("commit-style rail");
    expect(traceText.toUpperCase()).toContain("TOOL CALL");
    expect(await page.eval("document.querySelectorAll('.trace-rail-row[role=treeitem]').length >= 5")).toBe(true);
    expect(traceText).toContain("The final answer is ready.");
    expect(await page.eval("document.body.innerText.includes('{\"choices\"')")).toBe(false);

    await page.goto(`${origin}/ui/runs/${detailId}`, "document.body.innerText.includes('Conversation')", "run conversation");
    const detailText = await page.eval<string>("document.body.innerText");
    const conversationText = await page.eval<string>("document.querySelector('[data-test=\"conversation\"]').innerText");
    expect(detailText).toContain("Fix D:\\Project\\x");
    expect(detailText).toContain("Next line");
    expect(conversationText).toContain("I need to inspect the file first.");
    expect(detailText.indexOf("Conversation")).toBeLessThan(detailText.indexOf("Raw request"));
    expect(conversationText).not.toContain('{"choices"');
    expect(conversationText).not.toContain("\\\\");
    expect(await page.eval("document.querySelector('[data-test=\"raw-request\"]').open")).toBe(false);
    expect(await page.eval("document.querySelector('[data-test=\"raw-response\"]').open")).toBe(false);
    expect(await page.eval("!!document.querySelector('[data-meta-group=\"Identity\"]')")).toBe(true);
    expect(await page.eval("!!document.querySelector('[data-meta-group=\"Tokens\"]')")).toBe(true);
    expect(await page.eval("document.body.innerText.includes('Target')")).toBe(false);
    expect(await page.eval("document.body.innerText.includes('Media')")).toBe(false);
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
