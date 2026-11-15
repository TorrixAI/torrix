import { expect, test } from "bun:test";
import { toolNameFromEventMessage } from "../src/lib/toolNames";
import type { Run } from "../src/core/domain";
import { buildRunRow } from "../src/lib/runMapper";
import { bearer, createTestApp } from "./helpers";

test("tool names parse from normal, function-shaped and truncated events", () => {
  expect(toolNameFromEventMessage(JSON.stringify([{ name: "Read", arguments: "{}" }]))).toBe("Read");
  expect(toolNameFromEventMessage(JSON.stringify([{ function: { name: "shell" }, arguments: "{}" }]))).toBe("shell");
  expect(toolNameFromEventMessage(`[{"name":"edit","arguments":"{\\"path\\":\\"/Users/a/Big.tsx\\",\\"oldString\\":\\"${"x".repeat(80)}`)).toBe("edit");
  expect(toolNameFromEventMessage("plain command output")).toBeNull();
});

test("the group API returns every distinct tool name per run", async () => {
  const ctx = await createTestApp();
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "tools@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;
    const user = (await ctx.repos.users.findByEmail("tools@torrix.test"))!;
    const project = (await ctx.repos.projects.findDefault(user.id))!;
    const run: Run = buildRunRow({
      id: "run_tools",
      user_id: user.id,
      project_id: project.id,
      trace_id: "trc_tools",
      session_id: "ses_tools",
      created_at: "2026-01-01T10:00:00.000Z",
      status: 200,
      source: "sdk",
      provider: "openai",
      model: "gpt-4o",
    });
    await ctx.repos.runs.save(run);
    await ctx.repos.events.addMany([
      { id: crypto.randomUUID(), run_id: "run_tools", type: "tool_call", message: JSON.stringify([{ name: "Read", arguments: "{}" }]), created_at: "2026-01-01T10:00:01.000Z" },
      { id: crypto.randomUUID(), run_id: "run_tools", type: "tool_call", message: JSON.stringify([{ name: "Edit", arguments: "{}" }]), created_at: "2026-01-01T10:00:02.000Z" },
      { id: crypto.randomUUID(), run_id: "run_tools", type: "tool_call", message: JSON.stringify([{ name: "Read", arguments: "{}" }]), created_at: "2026-01-01T10:00:03.000Z" },
    ]);

    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/runs/group/trace/trc_tools",
      headers: bearer(key),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { toolNames?: Array<{ runId: string; name: string }> };
    expect(body.toolNames).toEqual([
      { runId: "run_tools", name: "Read" },
      { runId: "run_tools", name: "Edit" },
    ]);
  } finally {
    await ctx.cleanup();
  }
});
