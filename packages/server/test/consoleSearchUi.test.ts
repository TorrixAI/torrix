import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession } from "./helpers";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.skipIf(!browserPath)("slow typing keeps focus and characters in runs and traces search", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const projectId = crypto.randomUUID();
    await ctx.repos.projects.create({ id: projectId, user_id: session.user.id, name: "Search", created_at: new Date().toISOString() });
    const run = {
      id: crypto.randomUUID(),
      user_id: session.user.id,
      project_id: projectId,
      name: "slow search run",
      status: 200,
      source: "sdk",
      provider: "openai",
      model: "gpt-4o",
      input_tokens: 10,
      output_tokens: 5,
      latency_ms: 100,
      cost_usd: 0.001,
      session_id: "slow-search-session",
      trace_id: "slow-search-trace",
      created_at: new Date().toISOString(),
    } as Run;
    await ctx.repos.runs.save(run);

    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);

    await page.goto(`${origin}/ui/runs`, "document.body.innerText.includes('slow search run')", "runs list");
    await page.eval(`(function () {
      var input = document.querySelectorAll('input[aria-label="Search runs"]')[1];
      input.focus();
      return document.activeElement === input;
    })()`);
    await page.send("Input.dispatchKeyEvent", { type: "char", text: "z" });
    await wait(650);
    expect(await page.eval(`(function () {
      var input = document.querySelectorAll('input[aria-label="Search runs"]')[1];
      return { exists: Boolean(input), value: input ? input.value : null, focused: document.activeElement === input };
    })()`)).toEqual({ exists: true, value: "z", focused: true });

    await page.send("Input.dispatchKeyEvent", { type: "char", text: "z" });
    await wait(650);
    expect(await page.eval(`(function () {
      var input = document.querySelectorAll('input[aria-label="Search runs"]')[1];
      return { exists: Boolean(input), value: input ? input.value : null, focused: document.activeElement === input };
    })()`)).toEqual({ exists: true, value: "zz", focused: true });

    await page.goto(`${origin}/ui/traces?singles=1`, "document.body.innerText.includes('slow-search-trace')", "traces list");
    await page.eval(`(function () {
      var input = document.querySelector('input[aria-label="Filter groups"]');
      input.focus();
      return document.activeElement === input;
    })()`);
    await page.send("Input.dispatchKeyEvent", { type: "char", text: "z" });
    await wait(650);
    expect(await page.eval(`(function () {
      var input = document.querySelector('input[aria-label="Filter groups"]');
      return { exists: Boolean(input), value: input ? input.value : null, focused: document.activeElement === input };
    })()`)).toEqual({ exists: true, value: "z", focused: true });
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
