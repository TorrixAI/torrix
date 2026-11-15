import { expect, test } from "bun:test";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const PLUGIN = pathToFileURL(path.resolve(import.meta.dir, "..", "..", "..", ".opencode", "plugins", "torrix.js")).href;

async function loadPlugin(env: Record<string, string>) {
  Object.assign(process.env, {
    TORRIX_URL: "http://127.0.0.1:9",
    TORRIX_AGENT_KEY: "trxa_test",
    TORRIX_GUARD: "enforce",
    TORRIX_GUARD_FAIL: "open",
    ...env,
  });
  const module = (await import(`${PLUGIN}?v=${Date.now()}-${Math.random()}`)) as { default: { setup: (ctx: unknown) => Promise<() => void> } };
  const hooks = new Map<string, (event: Record<string, unknown>) => Promise<void>>();
  const ctx = {
    session: {
      hook: async (name: string, fn: (event: Record<string, unknown>) => Promise<void>) => {
        hooks.set(`session:${name}`, fn);
      },
      context: async () => ({ messages: [] }),
    },
    tool: {
      hook: async (name: string, fn: (event: Record<string, unknown>) => Promise<void>) => {
        hooks.set(`tool:${name}`, fn);
      },
    },
    event: {
      subscribe: async function* () {
        await new Promise(() => {});
      },
    },
  };
  const dispose = await module.default.setup(ctx);
  return { hooks, dispose };
}

test("opencode execute.before blocks denied and held tools", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      const action = String(body.action);
      const decision = action === "Bash" ? "DENY" : action === "Edit" ? "REQUIRE_APPROVAL" : "ALLOW";
      return Response.json({ decision, reason: `mock ${action}` });
    },
  });
  try {
    const { hooks, dispose } = await loadPlugin({ TORRIX_URL: `http://127.0.0.1:${server.port}` });
    const before = hooks.get("tool:execute.before");
    expect(before).toBeDefined();
    await expect(before!({ tool: "Bash", input: { command: "rm -rf build" } })).rejects.toThrow("Torrix denied Bash");
    await expect(before!({ tool: "Edit", input: { filePath: "a.ts" } })).rejects.toThrow("Torrix held Edit");
    await expect(before!({ tool: "Read", input: { filePath: "a.ts" } })).resolves.toBeUndefined();
    dispose();
  } finally {
    server.stop(true);
  }
});

test("opencode fail-closed blocks when Torrix is unreachable", async () => {
  const { hooks, dispose } = await loadPlugin({ TORRIX_URL: "http://127.0.0.1:9", TORRIX_GUARD_FAIL: "closed" });
  const before = hooks.get("tool:execute.before");
  expect(before).toBeDefined();
  await expect(before!({ tool: "Bash", input: {} })).rejects.toThrow("fail-closed");
  dispose();
});

test("opencode guard off registers no enforcement hook", async () => {
  const { hooks, dispose } = await loadPlugin({ TORRIX_GUARD: "off" });
  expect(hooks.get("tool:execute.before")).toBeUndefined();
  dispose();
});
