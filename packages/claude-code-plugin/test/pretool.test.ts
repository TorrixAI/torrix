import { expect, test } from "bun:test";
import * as path from "node:path";

const PRETOOL = path.resolve(import.meta.dir, "..", "scripts", "torrix-pretool.mjs");
const RUNTIME = Bun.which("node") ?? process.execPath;

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: "allow" | "deny" | "ask";
    permissionDecisionReason: string;
  };
}

function parse(output: string): HookOutput["hookSpecificOutput"] | null {
  if (!output.trim()) return null;
  return (JSON.parse(output) as HookOutput).hookSpecificOutput;
}

async function runHook(baseUrl: string, env: Record<string, string>, input: Record<string, unknown> | string) {
  const child = Bun.spawn([RUNTIME, PRETOOL], {
    env: {
      ...process.env,
      TORRIX_BASE_URL: baseUrl,
      TORRIX_AGENT_KEY: "trxa_test",
      TORRIX_GUARD: "enforce",
      TORRIX_GUARD_FAIL: "open",
      ...env,
    },
    stdin: new Blob([typeof input === "string" ? input : JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).text();
  return { code: await child.exited, output };
}

function toolInput(tool: string, session = "session-test"): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: session,
    cwd: "/work/project",
    permission_mode: "default",
    tool_name: tool,
    tool_input: { command: "echo hi" },
    tool_use_id: "tool-1",
  };
}

test("PreToolUse maps allow, deny and held decisions", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      seen.push(body);
      const action = String(body.action);
      const decision = action === "Bash" ? "DENY" : action === "Edit" ? "REQUIRE_APPROVAL" : "ALLOW";
      return Response.json({ decision, reason: `mock ${action}` });
    },
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const denied = parse((await runHook(base, { TORRIX_GUARD: "enforce" }, toolInput("Bash"))).output)!;
    expect(denied).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(denied.permissionDecisionReason).toContain("Torrix denied Bash");
    expect(denied.permissionDecisionReason).toContain("mock Bash");

    const held = parse((await runHook(base, { TORRIX_GUARD: "enforce" }, toolInput("Edit"))).output)!;
    expect(held).toMatchObject({ permissionDecision: "ask" });
    expect(held.permissionDecisionReason).toContain("held Edit for approval");

    const allowed = parse((await runHook(base, { TORRIX_GUARD: "enforce" }, toolInput("Read"))).output)!;
    expect(allowed).toMatchObject({ permissionDecision: "allow" });
    expect(allowed.permissionDecisionReason).toContain("Torrix allowed Read");

    expect(seen[0]).toMatchObject({
      action: "Bash",
      resourceType: "tool",
      resourceId: "Bash",
      toolName: "Bash",
      targetSystem: "claude-code",
      protocol: "sdk",
      sessionId: "session-test",
      traceId: "session-test",
      context: { client: "claude-code", cwd: "/work/project", permission_mode: "default" },
    });
  } finally {
    server.stop(true);
  }
});

test("observe mode asks Torrix but never changes the tool decision", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ decision: "DENY", reason: "should not block" }) });
  try {
    const result = await runHook(`http://127.0.0.1:${server.port}`, { TORRIX_GUARD: "observe" }, toolInput("Bash"));
    expect(result.code).toBe(0);
    expect(result.output.trim()).toBe("");
  } finally {
    server.stop(true);
  }
});

test("fail-open allows and fail-closed denies when Torrix is unreachable", async () => {
  const open = parse((await runHook("http://127.0.0.1:9", { TORRIX_GUARD: "enforce", TORRIX_GUARD_FAIL: "open" }, toolInput("Bash"))).output)!;
  expect(open.permissionDecision).toBe("allow");
  expect(open.permissionDecisionReason).toContain("fail-open");

  const closed = parse((await runHook("http://127.0.0.1:9", { TORRIX_GUARD: "enforce", TORRIX_GUARD_FAIL: "closed" }, toolInput("Bash"))).output)!;
  expect(closed.permissionDecision).toBe("deny");
  expect(closed.permissionDecisionReason).toContain("fail-closed");
});

test("guard off and malformed input leave Claude Code alone", async () => {
  const off = await runHook("http://127.0.0.1:9", { TORRIX_GUARD: "off" }, toolInput("Bash"));
  expect(off.code).toBe(0);
  expect(off.output.trim()).toBe("");

  const malformed = await runHook("http://127.0.0.1:9", { TORRIX_GUARD: "enforce" }, "{not-json");
  expect(malformed.code).toBe(0);
  expect(malformed.output.trim()).toBe("");
});
