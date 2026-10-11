import { describe, expect, test } from "bun:test";
import { TorrixClient } from "../src/client.js";
import { runContext } from "../src/context.js";
import type { TorrixRecord } from "../src/types.js";
import { unwrap, wrap } from "../src/wrap.js";

function collector(): { client: TorrixClient; records: TorrixRecord[] } {
  const records: TorrixRecord[] = [];
  const client = {
    ingest: async (record: TorrixRecord | TorrixRecord[]) => {
      records.push(...(Array.isArray(record) ? record : [record]));
      return [];
    },
  } as unknown as TorrixClient;
  return { client, records };
}

function openAIClient(create: (params: unknown) => Promise<unknown>): { client: Record<string, unknown>; calls: unknown[] } {
  const calls: unknown[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: unknown) => {
          calls.push(params);
          return create(params);
        },
      },
    },
  };
  return { client, calls };
}

function anthropicClient(create: (params: unknown) => Promise<unknown>): { client: Record<string, unknown>; calls: unknown[] } {
  const calls: unknown[] = [];
  const client = {
    messages: {
      create: async (params: unknown) => {
        calls.push(params);
        return create(params);
      },
    },
  };
  return { client, calls };
}

describe("wrap", () => {
  test("records OpenAI completions with usage and strips internal params", async () => {
    const { client: torrix, records } = collector();
    const fake = openAIClient(async () => ({
      id: "chatcmpl-1",
      model: "gpt-4o",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        completion_tokens_details: { reasoning_tokens: 2 },
        prompt_tokens_details: { cached_tokens: 3 },
      },
      choices: [{ message: { role: "assistant", content: "hi" } }],
    }));
    wrap(fake.client, { client: torrix });
    await (fake.client as any).chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      torrix_name: "greeting",
      torrix_tags: { env: "test" },
    });
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({
      id: "chatcmpl-1",
      provider: "openai",
      model: "gpt-4o",
      status: 200,
      input_tokens: 10,
      output_tokens: 5,
      thinking_tokens: 2,
      cache_read_tokens: 3,
      name: "greeting",
      tags: { env: "test" },
    });
    expect(records[0].latency_ms).toBeGreaterThanOrEqual(0);
    expect((fake.calls[0] as Record<string, unknown>).torrix_name).toBeUndefined();
    expect((fake.calls[0] as Record<string, unknown>).torrix_tags).toBeUndefined();
    unwrap(fake.client);
  });

  test("records failures and rethrows", async () => {
    const { client: torrix, records } = collector();
    const failure = Object.assign(new Error("rate limited"), { status: 429 });
    const fake = openAIClient(async () => {
      throw failure;
    });
    wrap(fake.client, { client: torrix });
    await expect((fake.client as any).chat.completions.create({ model: "gpt-4o" })).rejects.toThrow("rate limited");
    expect(records.length).toBe(1);
    expect(records[0].status).toBe(429);
    expect(records[0].error).toContain("rate limited");
    expect(records[0].provider).toBe("openai");
    unwrap(fake.client);
  });

  test("accumulates OpenAI streams, keeps stream properties and records once", async () => {
    const { client: torrix, records } = collector();
    async function* chunks() {
      yield { id: "chatcmpl-stream", model: "gpt-4o", choices: [{ delta: { content: "Hel" } }] };
      yield { choices: [{ delta: { content: "lo", reasoning_content: "th" } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: '{"a":' } }] } }] };
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] };
      yield { choices: [{ finish_reason: "tool_calls" }], usage: { prompt_tokens: 7, completion_tokens: 3 } };
    }
    const stream = chunks() as AsyncGenerator<unknown> & { controller?: { aborted: boolean } };
    stream.controller = { aborted: false };
    const fake = openAIClient(async () => stream);
    wrap(fake.client, { client: torrix });
    const result = (await (fake.client as any).chat.completions.create({ model: "gpt-4o", stream: true })) as AsyncIterable<unknown> & {
      controller?: { aborted: boolean };
    };
    expect(result.controller).toBeDefined();
    let seen = 0;
    for await (const _chunk of result) seen += 1;
    expect(seen).toBe(5);
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({ id: "chatcmpl-stream", status: 200, input_tokens: 7, output_tokens: 3 });
    const body = records[0].response?.body as {
      choices: Array<{ message: { content: string; reasoning_content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> }; finish_reason: string }>;
    };
    expect(body.choices[0].message.content).toBe("Hello");
    expect(body.choices[0].message.reasoning_content).toBe("th");
    expect(body.choices[0].message.tool_calls?.[0].function).toEqual({ name: "read", arguments: '{"a":1}' });
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    unwrap(fake.client);
  });

  test("records Anthropic messages and streams", async () => {
    const { client: torrix, records } = collector();
    const fake = anthropicClient(async () => ({
      id: "msg_1",
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 20, output_tokens: 12, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 },
      content: [{ type: "text", text: "Bonjour" }],
    }));
    wrap(fake.client, { client: torrix });
    await (fake.client as any).messages.create({ model: "claude-sonnet-4-5", messages: [] });
    expect(records[0]).toMatchObject({
      id: "msg_1",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      input_tokens: 20,
      output_tokens: 12,
      cache_read_tokens: 5,
      cache_creation_tokens: 2,
      status: 200,
    });
    unwrap(fake.client);

    const streaming = collector();
    async function* events() {
      yield { type: "message_start", message: { id: "msg_2", model: "claude-sonnet-4-5", usage: { input_tokens: 9, cache_read_input_tokens: 1 } } };
      yield { type: "content_block_start", index: 0, content_block: { type: "text" } };
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sal" } };
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ut" } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } };
      yield { type: "message_stop" };
    }
    const fakeStream = anthropicClient(async () => events());
    wrap(fakeStream.client, { client: streaming.client });
    const result = (await (fakeStream.client as any).messages.create({ model: "claude-sonnet-4-5", stream: true })) as AsyncIterable<unknown>;
    let count = 0;
    for await (const _event of result) count += 1;
    expect(count).toBe(6);
    expect(streaming.records.length).toBe(1);
    expect(streaming.records[0]).toMatchObject({
      id: "msg_2",
      provider: "anthropic",
      input_tokens: 9,
      output_tokens: 4,
      cache_read_tokens: 1,
      status: 200,
    });
    const body = streaming.records[0].response?.body as { content: Array<{ type: string; text?: string }>; stop_reason: string };
    expect(body.content[0].text).toBe("Salut");
    expect(body.stop_reason).toBe("end_turn");
  });

  test("run context chains wrapped calls", async () => {
    const captured: TorrixRecord[][] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { records: TorrixRecord[] };
      captured.push(body.records);
      return Response.json({ accepted: body.records.length, ids: body.records.map((record) => record.id ?? "generated") });
    }) as typeof fetch;
    try {
      const torrix = new TorrixClient({ baseUrl: "http://mock.local", apiKey: "trxk_test", background: false });
      let counter = 0;
      const fake = openAIClient(async () => {
        counter += 1;
        return { id: `chatcmpl-${counter}`, model: "gpt-4o", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [] };
      });
      wrap(fake.client, { client: torrix });
      await runContext({ sessionId: "ses_wrap", agentName: "agent" }, async () => {
        await (fake.client as any).chat.completions.create({ model: "gpt-4o" });
        await (fake.client as any).chat.completions.create({ model: "gpt-4o" });
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(captured.length).toBe(2);
      const [first] = captured[0];
      const [second] = captured[1];
      expect(first.session_id).toBe("ses_wrap");
      expect(first.agent_name).toBe("agent");
      expect(first.parent_run_id).toBeUndefined();
      expect(second.parent_run_id).toBeUndefined();
      expect(second.trace_id).toBe(first.trace_id);
      unwrap(fake.client);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("unwrap restores the original method", () => {
    const { client: torrix } = collector();
    const fake = openAIClient(async () => ({}));
    const original = (fake.client as any).chat.completions.create;
    wrap(fake.client, { client: torrix });
    expect((fake.client as any).chat.completions.create).not.toBe(original);
    unwrap(fake.client);
    expect((fake.client as any).chat.completions.create).toBe(original);
  });

  test("wrapping twice is idempotent", async () => {
    const { client: torrix, records } = collector();
    const fake = openAIClient(async () => ({ id: "once", model: "gpt-4o", choices: [] }));
    wrap(fake.client, { client: torrix });
    wrap(fake.client, { client: torrix });
    await (fake.client as any).chat.completions.create({ model: "gpt-4o" });
    expect(records.length).toBe(1);
    unwrap(fake.client);
  });
});
