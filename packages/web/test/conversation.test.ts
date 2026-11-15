import { expect, test } from "bun:test";
import { conversationAnswer, displayText, parseResponse, responseDisplay, toolLabel } from "../src/lib/conversation";
import type { RunEvent } from "../src/api";

test("tool events render the tool name and its main argument", () => {
  expect(toolLabel(JSON.stringify([{ name: "Edit", arguments: { file_path: "packages/server/src/lib/x.ts" } }]))).toBe("Edit packages/server/src/lib/x.ts");
  expect(toolLabel(JSON.stringify([{ name: "Bash", arguments: { command: "bun test" } }]))).toBe("Bash bun test");
  expect(toolLabel("not json")).toBe("tool call");

  // The server caps large tool events at 4,000 chars, which truncates the JSON.
  const truncated = `[{"name":"edit","arguments":"{\\"path\\":\\"/Users/a/Big.tsx\\",\\"oldString\\":\\"${"x".repeat(80)}`;
  expect(toolLabel(truncated)).toBe("edit /Users/a/Big.tsx");
  const fnShape = `[{"function":{"name":"shell"},"arguments":"{\\"command\\":\\"bun test`;
  expect(toolLabel(fnShape)).toBe("shell bun test");
});

test("provider envelopes fall back to reasoning or a tool call instead of raw JSON", () => {
  const openai = responseDisplay(JSON.stringify({
    choices: [{ message: { content: "", reasoning_content: "I need to inspect the file first.", tool_calls: [{ function: { name: "Read", arguments: "{\"file_path\":\"engine.ts\"}" } }] } }],
  }));
  expect(openai).toBe("I need to inspect the file first.");

  const anthropic = responseDisplay(JSON.stringify({
    content: [{ type: "tool_use", name: "Edit", input: { file_path: "packages/server/src/lib/x.ts" } }],
  }));
  expect(anthropic).toBe("Tool call: Edit packages/server/src/lib/x.ts");
});

test("plain text stays readable and display unescaping never changes storage", () => {
  expect(responseDisplay("Hello there.")).toBe("Hello there.");
  expect(parseResponse("Hello there.").text).toBe("Hello there.");
  expect(displayText("D:\\\\Project\\\\x\\nNext line")).toBe("D:\\Project\\x\nNext line");
});

test("conversationAnswer reads the last response event", () => {
  const events: RunEvent[] = [
    { run_id: "r1", type: "request", message: "{}", created_at: "2026-10-01T00:00:00.000Z" },
    { run_id: "r1", type: "response", message: "The answer.", created_at: "2026-10-01T00:00:01.000Z" },
  ];
  expect(conversationAnswer(events)).toBe("The answer.");
  expect(conversationAnswer([])).toBe("No text answer captured.");
});
