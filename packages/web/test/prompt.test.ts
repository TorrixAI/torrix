import { expect, test } from "bun:test";
import { looksLikeHumanPrompt, userPrompt } from "../src/api";

const SVG_PATH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 6.399L21.979 16.754L24.561 12.283L22.095 13.706L21.283 12.299L29 7.843L21.979 20.004L16 9.649L10.021 20.004L3 7.843L10.717 12.299L9.905 13.706L7.439 12.283L10.021 16.754Z"/></svg>`;

test("Anthropic loops keep the first human block and skip a later tool_result blob", () => {
  const body = JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "text", text: "Review the supplier order before it is sent." }] },
      { role: "assistant", content: [{ type: "tool_use", name: "read", input: { path: "orders/PO-1042.json" } }] },
      { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: SVG_PATH }] }] },
    ],
  });
  expect(userPrompt(body)).toBe("Review the supplier order before it is sent.");
});

test("OpenAI loops skip role tool messages", () => {
  const body = JSON.stringify({
    messages: [
      { role: "system", content: "You are a procurement agent." },
      { role: "user", content: "Check the Northwind order total." },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "shell", arguments: "{\"command\":\"cat orders.json\"}" } }] },
      { role: "tool", tool_call_id: "c1", content: SVG_PATH },
    ],
  });
  expect(userPrompt(body)).toBe("Check the Northwind order total.");
});

test("plain single prompts pass through", () => {
  expect(userPrompt(JSON.stringify({ messages: [{ role: "user", content: "Summarize this run." }] }))).toBe("Summarize this run.");
  expect(userPrompt("Summarize this run.")).toBe("Summarize this run.");
});

test("pasted files, JSON, long unbroken strings and code blocks are rejected", () => {
  expect(looksLikeHumanPrompt(SVG_PATH)).toBe(false);
  expect(looksLikeHumanPrompt(JSON.stringify({ path: "orders/PO-1042.json", amount: 20000 }))).toBe(false);
  expect(looksLikeHumanPrompt("M16 6.399L21.979 16.754L24.561 12.283L22.095 13.706")).toBe(false);
  expect(looksLikeHumanPrompt("abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz")).toBe(false);
  expect(looksLikeHumanPrompt("Can you explain the result?")).toBe(true);
});

test("the next human message is used when the first user block is tool output", () => {
  const body = JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "function_call_output", output: SVG_PATH }] },
      { role: "user", content: "Now compare the two totals." },
    ],
  });
  expect(userPrompt(body)).toBe("Now compare the two totals.");
});
