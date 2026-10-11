import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestApp, seedSession, type TestApp, type TestSession } from "../../server/test/helpers";
import { sqlAll } from "../../server/src/db/sql";
import { TorrixClient } from "../src/client.js";
import { runContext } from "../src/context.js";
import { wrap } from "../src/wrap.js";

interface RunRow {
  id: string;
  trace_id: string | null;
  session_id: string | null;
  parent_run_id: string | null;
  agent_name: string | null;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  status: number;
  source: string;
}

let ctx: TestApp;
let session: TestSession;
let baseUrl: string;

beforeAll(async () => {
  ctx = await createTestApp();
  session = await seedSession(ctx);
  await ctx.repos.projects.create({
    id: crypto.randomUUID(),
    user_id: session.user.id,
    name: "Default",
    created_at: new Date().toISOString(),
  });
  baseUrl = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("sdk end to end", () => {
  test("wrapped calls land as linked runs with usage", async () => {
    const client = new TorrixClient({ baseUrl, apiKey: session.key, background: true, flushIntervalMs: 10 });
    let counter = 0;
    const fake = {
      chat: {
        completions: {
          create: async () => {
            counter += 1;
            return {
              id: `chatcmpl-e2e-${counter}`,
              model: "gpt-4o",
              usage: { prompt_tokens: 120, completion_tokens: 30 },
              choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            };
          },
        },
      },
    };
    wrap(fake, { client, name: "e2e call" });
    await runContext({ sessionId: "ses_e2e", agentName: "e2e" }, async () => {
      await fake.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "hello" }] });
      await fake.chat.completions.create({ model: "gpt-4o", messages: [{ role: "user", content: "again" }] });
    });
    expect(await client.flush()).toBe(true);
    const rows = await sqlAll<RunRow>(
      ctx.db.engine,
      "SELECT id, trace_id, session_id, parent_run_id, agent_name, model, provider, input_tokens, output_tokens, status, source FROM runs WHERE user_id = ? ORDER BY id",
      [session.user.id],
    );
    expect(rows.length).toBe(2);
    const [first, second] = rows;
    expect(first.id).toBe("chatcmpl-e2e-1");
    expect(first.source).toBe("sdk");
    expect(first.model).toBe("gpt-4o");
    expect(first.provider).toBe("openai");
    expect(first.input_tokens).toBe(120);
    expect(first.output_tokens).toBe(30);
    expect(first.status).toBe(200);
    expect(first.session_id).toBe("ses_e2e");
    expect(first.agent_name).toBe("e2e");
    expect(first.trace_id).toBeTruthy();
    expect(second.trace_id).toBe(first.trace_id);
    expect(second.parent_run_id).toBeNull();
  });
});
