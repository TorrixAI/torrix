import { expect, test } from "bun:test";
import {
  buildBody,
  chunkText,
  describeError,
  geminiEndpoint,
  isReasoningModel,
  plainResponseText,
  type PlaygroundProvider,
} from "../src/pages/playgroundUtil";

const provider = (overrides: Partial<PlaygroundProvider>): PlaygroundProvider => ({
  id: "openai",
  label: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  endpoint: "/chat/completions",
  format: "openai",
  auth: "bearer",
  models: [],
  ...overrides,
});

const turns = [
  { role: "user" as const, content: "hi" },
  { role: "assistant" as const, content: "hello" },
  { role: "user" as const, content: "again" },
];

test("chat models send max_tokens and temperature, and honor the stream toggle", () => {
  const streamed = buildBody(provider({}), "gpt-4o", turns, 0.4, "be brief");
  expect(streamed).toMatchObject({ model: "gpt-4o", temperature: 0.4, max_tokens: 1024, stream: true });
  expect(streamed.stream_options).toEqual({ include_usage: true });
  expect(streamed.messages).toEqual([
    { role: "system", content: "be brief" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" },
  ]);

  const plain = buildBody(provider({}), "gpt-4o", turns, 0.4, "", { stream: false });
  expect(plain).not.toHaveProperty("stream");
  expect(plain).not.toHaveProperty("stream_options");
});

test("reasoning models get max_completion_tokens and no temperature", () => {
  for (const model of ["gpt-5", "gpt-5-mini", "o4-mini", "o3"]) {
    expect(isReasoningModel(model)).toBe(true);
    const body = buildBody(provider({}), model, turns, 0.4, "");
    expect(body).toHaveProperty("max_completion_tokens", 2048);
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("temperature");
  }
  expect(isReasoningModel("gpt-4o")).toBe(false);
  expect(isReasoningModel("gpt-5-chat-latest")).toBe(false);
});

test("anthropic streams only when asked and keeps its required max_tokens", () => {
  const anthropic = provider({ id: "anthropic", format: "anthropic", endpoint: "/messages", auth: "x-api-key" });
  const streamed = buildBody(anthropic, "claude-sonnet-4-5", turns, 0.2, "be brief");
  expect(streamed).toMatchObject({ max_tokens: 1024, temperature: 0.2, stream: true });
  expect(streamed.system).toBe("be brief");
  expect(streamed.messages).toEqual([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" },
  ]);

  const plain = buildBody(anthropic, "claude-sonnet-4-5", turns, 0.2, "", { stream: false });
  expect(plain).not.toHaveProperty("stream");
});

test("gemini uses the generateContent body and swaps to the SSE endpoint when streaming", () => {
  const gemini = provider({ id: "gemini", format: "gemini", endpoint: "/models/{model}:generateContent", auth: "x-goog-api-key" });
  const body = buildBody(gemini, "gemini-2.5-pro", turns, 0.3, "be brief", { stream: true });
  expect(body).not.toHaveProperty("stream");
  expect(body.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
  expect(body.generationConfig).toMatchObject({ temperature: 0.3, maxOutputTokens: 2048 });

  expect(geminiEndpoint(gemini.endpoint, false)).toBe("/models/{model}:generateContent");
  expect(geminiEndpoint(gemini.endpoint, true)).toBe("/models/{model}:streamGenerateContent?alt=sse");
});

test("anthropic text deltas render, not just legacy text deltas", () => {
  expect(chunkText({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } })).toBe("Hel");
  expect(chunkText({ type: "content_block_delta", content_block_delta: { delta: { type: "text_delta", text: "lo" } } })).toBe("lo");
});

test("openai and gemini stream chunks yield their text", () => {
  expect(chunkText({ choices: [{ delta: { content: "hello" } }] })).toBe("hello");
  expect(chunkText({ choices: [{ delta: { tool_calls: [] } }] })).toBe("");
  expect(chunkText({ candidates: [{ content: { parts: [{ text: "hel" }, { text: "lo" }] } }] })).toBe("hello");
});

test("plain responses read each provider envelope", () => {
  expect(plainResponseText(provider({}), { choices: [{ message: { content: "openai text" } }] })).toBe("openai text");
  expect(plainResponseText(provider({ format: "anthropic" }), { content: [{ type: "text", text: "anthropic text" }] })).toBe("anthropic text");
  expect(plainResponseText(provider({ format: "gemini" }), { candidates: [{ content: { parts: [{ text: "gemini text" }] } }] })).toBe("gemini text");
});

test("provider errors render a readable status and message for JSON and text bodies", () => {
  expect(describeError({ error: { message: "max_tokens is not supported" } }, 400)).toBe("HTTP 400 · max_tokens is not supported");
  expect(describeError({ detail: "bad model", error: "upstream_error" }, 404)).toBe("HTTP 404 · bad model");
  expect(describeError("<html>gateway timeout</html>", 504)).toBe("HTTP 504 · <html>gateway timeout</html>");
  expect(describeError("", 500)).toBe("HTTP 500 · request rejected");
});
