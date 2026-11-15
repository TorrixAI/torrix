import { expect, test } from "bun:test";
import { extractFromSSEChunks } from "../src/lib/extract";
import { createTestApp } from "./helpers";

const anthropicSse = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-5", usage: { input_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n\n`,
  `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } })}\n\n`,
  `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } })}\n\n`,
  `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } })}\n\n`,
  `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
].join("");

const geminiSse = [
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello" }], role: "model" } }], modelVersion: "gemini-2.5-pro" })}\n\n`,
  `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: " there" }], role: "model" }, finishReason: "STOP" }], modelVersion: "gemini-2.5-pro" })}\n\n`,
  `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } })}\n\n`,
].join("");

test("anthropic stream chunks yield the response text, usage and stop reason", () => {
  const extracted = extractFromSSEChunks(anthropicSse);
  expect(extracted.responseText).toBe("Hello there");
  expect(extracted.model).toBe("claude-sonnet-4-5");
  expect(extracted.inputTokens).toBe(12);
  expect(extracted.outputTokens).toBe(4);
  expect(extracted.finishReason).toBe("end_turn");
});

test("gemini stream chunks yield the response text and usage", () => {
  const extracted = extractFromSSEChunks(geminiSse);
  expect(extracted.responseText).toBe("Hello there");
  expect(extracted.model).toBe("gemini-2.5-pro");
  expect(extracted.inputTokens).toBe(10);
  expect(extracted.outputTokens).toBe(2);
  expect(extracted.finishReason).toBe("stop");
});

test("playground streams provider text and never forwards the console cookie", async () => {
  const seen: { headers: Headers | null } = { headers: null };
  const upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.headers = req.headers;
      return new Response(anthropicSse, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const ctx = await createTestApp({ TORRIX_LOCAL_HOST: `127.0.0.1:${upstream.port}` });
  try {
    const signup = await ctx.app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "playground@torrix.test", password: "password123" },
    });
    const key = (signup.json() as { api_key: string }).api_key;

    const res = await ctx.app.inject({
      method: "POST",
      url: "/proxy",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-target-url": `http://127.0.0.1:${upstream.port}/v1/messages`,
        "x-torrix-provider": "anthropic",
        "x-torrix-source": "playground",
        "x-torrix-session": "pg-session",
        "x-api-key": "sk-ant-test",
        "anthropic-version": "2023-06-01",
        cookie: "torrix_session=secret-session-key",
        "accept-encoding": "gzip, deflate, br",
      },
      payload: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream");
    expect(res.body).toContain('"type":"text_delta"');
    expect(res.body).toContain('"text":"Hello"');
    expect(res.body).toContain('"text":" there"');

    expect(seen.headers?.get("cookie")).toBeNull();
    expect(seen.headers?.get("authorization")).toBeNull();
    expect(seen.headers?.get("x-api-key")).toBe("sk-ant-test");

    const requests = await ctx.app.inject({
      method: "GET",
      url: `/api/runs?session=pg-session&limit=5`,
      headers: { authorization: `Bearer ${key}` },
    });
    const body = requests.json() as { runs: Array<{ id: string; source: string; session_id: string; model: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ source: "playground", session_id: "pg-session", model: "claude-sonnet-4-5" });

    const recorded = await ctx.app.inject({
      method: "GET",
      url: `/api/runs/${body.runs[0].id}/events`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(recorded.statusCode).toBe(200);
  } finally {
    upstream.stop(true);
    await ctx.cleanup();
  }
});
