import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession, type TestApp } from "./helpers";

function runRow(overrides: Partial<Run> & { id: string; user_id: string; project_id: string }): Run {
  return {
    name: "table row",
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

async function seed(ctx: TestApp, userId: string): Promise<{ projectId: string; traceId: string }> {
  const projectId = crypto.randomUUID();
  await ctx.repos.projects.create({ id: projectId, user_id: userId, name: "Tables", created_at: new Date().toISOString() });
  const traceId = "table-trace";
  for (let i = 0; i < 3; i += 1) {
    const id = crypto.randomUUID();
    const run = runRow({ id, user_id: userId, project_id: projectId, trace_id: traceId, created_at: new Date(Date.now() + i * 1000).toISOString() });
    await ctx.repos.runs.save(run);
    await ctx.repos.events.add({ id: crypto.randomUUID(), run_id: id, type: "tool_call", message: JSON.stringify([{ name: "Bash", arguments: { command: "bun test" } }]), created_at: run.created_at });
  }
  return { projectId, traceId };
}

test.skipIf(!browserPath)("wide React tables show all columns at 1440 and hide low-priority columns at 1024", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const { traceId } = await seed(ctx, session.user.id);
    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('Bash bun test')", "runs table");
    expect(await page.eval("!!document.querySelector('.table-wrap.is-scrollable') || document.querySelectorAll('table.wide-table').length > 0")).toBe(true);
    expect(await page.eval("getComputedStyle(document.querySelector('table.wide-table td[data-priority=\"low\"]')).display")).not.toBe("none");
    expect(await page.eval("getComputedStyle(document.querySelector('table.wide-table td:first-child')).position")).toBe("sticky");
    expect(await page.eval("Array.from(document.querySelectorAll('table.wide-table thead th')).some(function(th){return th.textContent.trim()==='Status' && getComputedStyle(th).display!=='none'})")).toBe(true);

    await page.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('Bash bun test')", "runs table narrow desktop");
    expect(await page.eval("getComputedStyle(document.querySelector('table.wide-table td[data-priority=\"low\"]')).display")).toBe("none");
    expect(await page.eval("document.documentElement.scrollWidth - window.innerWidth")).toBeLessThanOrEqual(1);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await page.goto(`${origin}/ui/traces`, "document.body.innerText.includes('table-trace')", "traces table");
    // One boundary for every wide table: above 1400px nothing is hidden, so a
    // trace row reads the same as a run row at the audited 1440px width.
    expect(await page.eval("getComputedStyle(document.querySelector('table.wide-table td[data-priority=\"low\"]')).display")).not.toBe("none");
    expect(await page.eval("Array.from(document.querySelectorAll('table.wide-table thead th')).some(function(th){return th.textContent.trim()==='Runs' && getComputedStyle(th).display!=='none'})")).toBe(true);

    await page.goto(`${origin}/ui/traces/${traceId}`, "!!document.querySelector('.trace-rail-scroll')", "trace graph rail");
    expect(await page.eval("document.querySelector('.trace-rail-scroll').scrollWidth - document.querySelector('.trace-rail-scroll').clientWidth")).toBeLessThanOrEqual(1);
    expect(await page.eval("!!document.querySelector('.trace-rail-svg .trace-rail-node-shape')")).toBe(true);
    expect(await page.eval("!!document.querySelector('.trace-rail-row[role=treeitem] .trace-status')")).toBe(true);

    await page.send("Emulation.setDeviceMetricsOverride", { width: 500, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('Bash bun test')", "runs table narrow");
    expect(await page.eval("Array.from(document.querySelectorAll('.table-wrap')).some(function(w){return w.scrollWidth > w.clientWidth + 1 && w.classList.contains('is-scrollable')})")).toBe(true);
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
