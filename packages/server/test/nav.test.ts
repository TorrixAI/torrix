import { expect, test } from "bun:test";
import { Cdp, browserPath } from "./cdp";
import { createTestApp, seedSession } from "./helpers";

test.skipIf(!browserPath)("the sidebar keeps Agents as one item while the page carries the tab bar", async () => {
  const ctx = await createTestApp();
  let page: Cdp | null = null;
  try {
    const session = await seedSession(ctx);
    const origin = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    page = await Cdp.launch();
    await page.signIn(origin, session.key);
    await page.goto(`${origin}/ui/dashboard`, "document.querySelectorAll('.nav-cap').length >= 6", "dashboard navigation");

    const groups = await page.eval<string[]>("Array.from(document.querySelectorAll('.nav-cap')).map(function(node){return node.textContent.trim()})");
    expect(groups).toEqual(["Observability", "Build", "Agents", "Governance", "Workspace", "System"]);
    expect(groups).not.toContain("Management");

    await page.eval("Array.from(document.querySelectorAll('button')).find(function(button){return button.textContent.includes('Agents')}).click()");
    await page.waitFor("!!document.querySelector('a[href=\"/ui/agents\"]')", "agents item");
    expect(await page.eval("!!document.querySelector('.nav-groups a[href=\"/ui/agents/approvals\"]')")).toBe(false);
    expect(await page.eval("!!document.querySelector('.nav-groups a[href=\"/ui/agents/observed\"]')")).toBe(false);
  } finally {
    page?.close();
    await ctx.cleanup();
  }
}, 120_000);
