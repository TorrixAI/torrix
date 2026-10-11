import { describe, expect, test } from "bun:test";
import type { TorrixClient } from "../src/client.js";
import type { TorrixRecord } from "../src/types.js";
import { torrixMiddleware } from "../src/vercel.js";

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

describe("torrixMiddleware", () => {
  test("records generate calls", async () => {
    const { client, records } = collector();
    const middleware = torrixMiddleware({ client, name: "middleware", agentName: "agent", tags: { app: "test" } });
    const args = {
      doGenerate: async () => ({
        text: "hi",
        usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: 1, cachedInputTokens: 2 },
        finishReason: "stop",
        response: { id: "req_1" },
      }),
      params: { prompt: [{ role: "user", content: "hello" }] },
      model: { modelId: "gpt-4o", provider: "openai.chat" },
    };
    const result = await middleware.wrapGenerate(args as never);
    expect(result.text).toBe("hi");
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({
      id: "req_1",
      provider: "openai",
      model: "gpt-4o",
      status: 200,
      input_tokens: 7,
      output_tokens: 3,
      thinking_tokens: 1,
      cache_read_tokens: 2,
      name: "middleware",
      agent_name: "agent",
      tags: { app: "test" },
    });
  });

  test("records generate failures and rethrows", async () => {
    const { client, records } = collector();
    const middleware = torrixMiddleware({ client });
    await expect(
      middleware.wrapGenerate({
        doGenerate: async () => {
          throw Object.assign(new Error("upstream down"), { status: 503 });
        },
        params: {},
        model: { modelId: "m", provider: "anthropic.messages" },
      } as never),
    ).rejects.toThrow("upstream down");
    expect(records[0]).toMatchObject({ status: 503, provider: "anthropic", error: "upstream down" });
  });

  test("accumulates streams", async () => {
    const { client, records } = collector();
    const middleware = torrixMiddleware({ client });
    const stream = new ReadableStream<Record<string, unknown>>({
      start(controller) {
        controller.enqueue({ type: "text-delta", delta: "a" });
        controller.enqueue({ type: "text-delta", textDelta: "b" });
        controller.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 2, outputTokens: 1 } });
        controller.close();
      },
    });
    const result = await middleware.wrapStream({
      doStream: async () => ({ stream }),
      params: { prompt: [] },
      model: { modelId: "gpt-4o", provider: "openai.chat" },
    } as never);
    const reader = result.stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(records.length).toBe(1);
    expect(records[0]).toMatchObject({ provider: "openai", model: "gpt-4o", status: 200, input_tokens: 2, output_tokens: 1 });
    const body = records[0].response?.body as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0].message.content).toBe("ab");
  });
});
