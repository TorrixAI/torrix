import { expect, test } from "bun:test";
import { extractUserPrompt, looksLikeHumanPrompt } from "../src/lib/extract";

const SVG_PATH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 6.399L21.979 16.754L24.561 12.283L22.095 13.706L21.283 12.299L29 7.843L21.979 20.004L16 9.649L10.021 20.004L3 7.843L10.717 12.299L9.905 13.706L7.439 12.283L10.021 16.754Z"/></svg>`;

test("server prompt extraction prefers the first human message", () => {
  const anthropic = JSON.stringify({
    messages: [
      { role: "user", content: [{ type: "text", text: "Review the supplier order." }] },
      { role: "assistant", content: [{ type: "tool_use", name: "read", input: { path: "orders.json" } }] },
      { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: SVG_PATH }] }] },
    ],
  });
  expect(extractUserPrompt(anthropic)).toBe("Review the supplier order.");
  expect(looksLikeHumanPrompt(SVG_PATH)).toBe(false);
  expect(looksLikeHumanPrompt("Can you explain the result?")).toBe(true);
});
