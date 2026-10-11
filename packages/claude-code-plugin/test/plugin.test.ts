import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bearer, createTestApp, seedSession, type TestApp } from "@torrix/server/testing";
import { convertLines } from "../scripts/transcript.mjs";
import { PROMPT_1, PROMPT_2, SESSION, subagent, turnOne, turnTwo } from "./fixture";

const HOOK = path.resolve(import.meta.dir, "..", "scripts", "torrix-hook.mjs");
const RUNTIME = Bun.which("node") ?? process.execPath;

interface Sandbox {
  dir: string;
  transcript: string;
  agentTranscript: string;
  dataDir: string;
}

function sandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "torrix-cc-"));
  const transcript = path.join(dir, `${SESSION}.jsonl`);
  const subDir = path.join(dir, SESSION, "subagents");
  fs.mkdirSync(subDir, { recursive: true });
  return { dir, transcript, agentTranscript: path.join(subDir, "agent-explore01.jsonl"), dataDir: path.join(dir, "plugin-data") };
}

function append(file: string, lines: string[]): void {
  fs.appendFileSync(file, `${lines.join("\n")}\n`);
}

async function runHook(box: Sandbox, baseUrl: string, apiKey: string, input: Record<string, unknown>): Promise<number> {
  const child = Bun.spawn([RUNTIME, HOOK], {
    env: { ...process.env, TORRIX_BASE_URL: baseUrl, TORRIX_API_KEY: apiKey, CLAUDE_PLUGIN_DATA: box.dataDir, TORRIX_HOOK_TIMEOUT_MS: "3000" },
    stdin: new Blob([JSON.stringify({ session_id: SESSION, transcript_path: box.transcript, ...input })]),
    stdout: "pipe",
    stderr: "pipe",
  });
  return await child.exited;
}

async function user(ctx: TestApp) {
  const session = await seedSession(ctx);
  await ctx.repos.projects.create({ id: crypto.randomUUID(), user_id: session.user.id, name: "Default", created_at: new Date().toISOString() });
  return session;
}

async function runs(ctx: TestApp, userId: string) {
  return (await ctx.repos.runs.list(userId, { limit: 50, offset: 0 } as never)).runs.filter((r) => r.id.startsWith("cc_"));
}

test("converter groups streamed lines into one run per API call and skips synthetic messages", () => {
  const { records, carry, toolUseRuns } = convertLines(turnOne());
  expect(records.map((r) => r.id)).toEqual(["cc_msg_one", "cc_msg_two", "cc_msg_api_error"]);
  expect(records[2]).toMatchObject({ status: 500, error: "API Error: 529 overloaded", trace_id: PROMPT_1 });
  const [first, second] = records;
  expect(first).toMatchObject({
    model: "claude-test-model",
    provider: "anthropic",
    trace_id: PROMPT_1,
    session_id: SESSION,
    agent_name: "claude-code",
    input_tokens: 10,
    output_tokens: 300,
    cache_read_tokens: 1000,
    cache_creation_tokens: 2000,
    thinking_tokens: 120,
    name: "Refactor the billing module",
    start_time: "2026-10-10T10:00:00.000Z",
    end_time: "2026-10-10T10:00:05.000Z",
  });
  expect(first.response.body.content.map((b: { type: string }) => b.type)).toEqual(["thinking", "tool_use"]);
  expect(second.request.body.messages[0].content).toContain("[tool_result] billing lives in src/billing");
  expect(toolUseRuns).toEqual({ toolu_explore: "cc_msg_one" });
  expect(carry.promptId).toBe(PROMPT_1);

  const next = convertLines(turnTwo(), carry);
  expect(next.records[0]).toMatchObject({ id: "cc_msg_three", trace_id: PROMPT_2, name: "Now update the README" });
});

test("the hook ingests turns, links subagents, prices cache tokens and never duplicates", async () => {
  const ctx = await createTestApp();
  const box = sandbox();
  try {
    const session = await user(ctx);
    const baseUrl = (await ctx.app.listen({ port: 0, host: "127.0.0.1" })).replace(/\/$/, "");
    const priced = await ctx.app.inject({
      method: "PUT",
      url: "/api/cost/pricing",
      headers: bearer(session.key),
      payload: { model: "claude-test-model", input: 10, output: 20 },
    });
    expect(priced.statusCode).toBe(200);

    append(box.transcript, turnOne());
    expect(await runHook(box, baseUrl, session.key, { hook_event_name: "Stop" })).toBe(0);
    let stored = await runs(ctx, session.user.id);
    expect(stored.map((r) => r.id).sort()).toEqual(["cc_msg_api_error", "cc_msg_one", "cc_msg_two"]);
    const one = stored.find((r) => r.id === "cc_msg_one")!;
    // 10 in, 300 out, 1000 cache reads at 0.1x, 2000 cache writes at 1.25x; $10/$20 per million.
    expect(one.cost_usd).toBeCloseTo((10 * 10 + 300 * 20 + (1000 * 0.1 + 2000 * 1.25) * 10) / 1e6, 9);
    expect(one).toMatchObject({ trace_id: PROMPT_1, session_id: SESSION, agent_name: "claude-code", cache_read_tokens: 1000 });
    const events = await ctx.repos.events.listByRun(one.id);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["thinking", "tool_call"]));

    expect(await runHook(box, baseUrl, session.key, { hook_event_name: "Stop" })).toBe(0);
    expect((await runs(ctx, session.user.id)).length).toBe(3);

    append(box.agentTranscript, subagent());
    fs.writeFileSync(box.agentTranscript.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "toolu_explore" }));
    expect(
      await runHook(box, baseUrl, session.key, { hook_event_name: "SubagentStop", agent_transcript_path: box.agentTranscript, agent_type: "Explore" }),
    ).toBe(0);
    const sub = (await runs(ctx, session.user.id)).find((r) => r.id === "cc_msg_sub");
    expect(sub).toMatchObject({ parent_run_id: "cc_msg_one", agent_name: "Explore", agent_id: "explore01", trace_id: PROMPT_1 });

    append(box.transcript, turnTwo());
    fs.rmSync(path.join(box.dataDir, "state"), { recursive: true, force: true });
    expect(await runHook(box, baseUrl, session.key, { hook_event_name: "SessionEnd", reason: "other" })).toBe(0);
    stored = await runs(ctx, session.user.id);
    expect(stored.map((r) => r.id).sort()).toEqual(["cc_msg_api_error", "cc_msg_one", "cc_msg_sub", "cc_msg_three", "cc_msg_two"]);
  } finally {
    await ctx.cleanup();
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
}, 60_000);

test("an unreachable Torrix never fails the hook and the backlog is delivered later", async () => {
  const ctx = await createTestApp();
  const box = sandbox();
  try {
    const session = await user(ctx);
    append(box.transcript, turnOne());
    expect(await runHook(box, "http://127.0.0.1:9", session.key, { hook_event_name: "Stop" })).toBe(0);
    expect(fs.readFileSync(path.join(box.dataDir, "torrix-hook.log"), "utf8")).toContain("error:");
    expect((await runs(ctx, session.user.id)).length).toBe(0);

    const baseUrl = (await ctx.app.listen({ port: 0, host: "127.0.0.1" })).replace(/\/$/, "");
    expect(await runHook(box, baseUrl, session.key, { hook_event_name: "Stop" })).toBe(0);
    expect((await runs(ctx, session.user.id)).length).toBe(3);
  } finally {
    await ctx.cleanup();
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
}, 60_000);

test("without an API key the hook is a silent no-op", async () => {
  const box = sandbox();
  try {
    append(box.transcript, turnOne());
    expect(await runHook(box, "http://127.0.0.1:9", "", { hook_event_name: "Stop" })).toBe(0);
    expect(fs.existsSync(box.dataDir)).toBe(false);
  } finally {
    fs.rmSync(box.dir, { recursive: true, force: true });
  }
});
