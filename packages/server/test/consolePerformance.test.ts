import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession, type TestApp } from "./helpers";

function run(overrides: Partial<Run> & { id: string; user_id: string; project_id: string; i: number }): Run {
  const { i, ...rest } = overrides;
  return {
    name: `probe ${i}`,
    status: i % 40 === 0 ? 500 : 200,
    source: "sdk",
    provider: "openai",
    model: i % 3 === 0 ? "gpt-4o" : "gpt-4o-mini",
    input_tokens: 100 + (i % 50),
    output_tokens: 40 + (i % 20),
    cost_usd: 0.001 + (i % 7) * 0.0001,
    latency_ms: 100 + (i % 900),
    agent_name: `agent-${i % 6}`,
    session_id: `session-${i % 50}`,
    trace_id: `trace-${i}`,
    request_body: JSON.stringify({ messages: [{ role: "user", content: `probe question ${i}` }] }),
    created_at: new Date(Date.now() - (4000 - i) * 60_000).toISOString(),
    ...rest,
  } as Run;
}

async function seed(ctx: TestApp, userId: string): Promise<void> {
  const projectId = crypto.randomUUID();
  await ctx.repos.projects.create({ id: projectId, user_id: userId, name: "Probe", created_at: new Date().toISOString() });
  for (let i = 0; i < 4000; i += 1) {
    await ctx.repos.runs.save(run({ id: crypto.randomUUID(), user_id: userId, project_id: projectId, i }));
  }
}

test.skipIf(!browserPath)(
  "four data-heavy React pages reach load under the 5 second bound on 4,000 runs",
  async () => {
    const ctx = await createTestApp();
    let page: Cdp | null = null;
    try {
      const session = await seedSession(ctx);
      await seed(ctx, session.user.id);
      const paths = ["/ui/datasets", "/ui/insights", "/ui/prompts", "/ui/agents/observed"];
      for (const path of paths) {
        const start = performance.now();
        const res = await ctx.app.inject({ method: "GET", url: path, headers: { authorization: `Bearer ${session.key}` } });
        expect(res.statusCode, path).toBe(200);
        expect(res.body, path).toContain('id="root"');
        expect(performance.now() - start, path).toBeLessThan(3000);
      }
      const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
      page = await Cdp.launch();
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `window.__long=[];try{new PerformanceObserver(function(list){for(var i=0;i<list.getEntries().length;i++){var e=list.getEntries()[i];window.__long.push({start:Math.round(e.startTime),dur:Math.round(e.duration)})}}).observe({entryTypes:["longtask"]})}catch(e){}`,
      });
      await page.signIn(origin, session.key);
      for (const path of paths) {
        await page.eval("performance.clearResourceTimings()");
        const start = Date.now();
        await page.goto(`${origin}${path}`, "document.readyState==='complete' && !!document.querySelector('.content')", path);
        const wall = Date.now() - start;
        const info = await page.eval<{ load: number; dom: number; resources: Array<{ duration: number }>; long: Array<{ dur: number }> }>(`(function(){
          var nav=performance.getEntriesByType('navigation')[0]||{};
          return {
            load:Math.round(nav.loadEventEnd||0),
            dom:Math.round(nav.domContentLoadedEventEnd||0),
            resources:performance.getEntriesByType('resource').map(function(r){return {duration:Math.round(r.duration)}}),
            long:window.__long||[]
          };
        })()`);
        expect(wall, path).toBeLessThan(5000);
        expect(info.load, path).toBeLessThan(5000);
        expect(info.dom, path).toBeLessThan(5000);
        expect(info.resources.every((resource) => resource.duration < 3000), path).toBe(true);
        expect(info.long.every((task) => task.dur < 1000), path).toBe(true);
      }
    } finally {
      page?.close();
      await ctx.cleanup();
    }
  },
  180_000,
);
