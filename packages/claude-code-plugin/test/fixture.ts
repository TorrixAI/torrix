// Synthetic Claude Code transcript lines shaped like real sessions: one API call
// spans several `assistant` lines sharing message.id, tool results come back as
// `user` lines, and subagents write their own sidechain transcript.
export const SESSION = "sess-fixture-1";
export const PROMPT_1 = "prompt-aaa";
export const PROMPT_2 = "prompt-bbb";

const base = { sessionId: SESSION, version: "2.1.296", gitBranch: "main", cwd: "/work/app", userType: "external" };
const usage = (input: number, output: number, read: number, write: number, thinking?: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  ...(thinking ? { output_tokens_details: { thinking_tokens: thinking } } : {}),
});

function line(entry: Record<string, unknown>): string {
  return JSON.stringify({ ...base, ...entry });
}

export function turnOne(): string[] {
  const u1 = usage(10, 300, 1000, 2000, 120);
  const u2 = usage(4, 50, 3000, 0);
  return [
    line({ type: "user", uuid: "u1", promptId: PROMPT_1, timestamp: "2026-10-10T10:00:00.000Z", message: { role: "user", content: "Refactor the billing module\nand add tests" } }),
    line({ type: "assistant", uuid: "a1", requestId: "req_1", timestamp: "2026-10-10T10:00:03.000Z", message: { id: "msg_one", model: "claude-test-model", role: "assistant", content: [{ type: "thinking", thinking: "Plan the refactor." }], usage: u1, stop_reason: null } }),
    line({ type: "assistant", uuid: "a2", requestId: "req_1", timestamp: "2026-10-10T10:00:05.000Z", message: { id: "msg_one", model: "claude-test-model", role: "assistant", content: [{ type: "tool_use", id: "toolu_explore", name: "Agent", input: { description: "Explore billing" } }], usage: u1, stop_reason: "tool_use" } }),
    line({ type: "user", uuid: "u2", promptId: PROMPT_1, timestamp: "2026-10-10T10:00:20.000Z", toolUseResult: {}, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_explore", content: "billing lives in src/billing" }] } }),
    line({ type: "assistant", uuid: "a3", requestId: "req_2", timestamp: "2026-10-10T10:00:24.000Z", message: { id: "msg_two", model: "claude-test-model", role: "assistant", content: [{ type: "text", text: "Done. Billing refactored." }], usage: u2, stop_reason: "end_turn" } }),
    line({ type: "assistant", uuid: "a4", timestamp: "2026-10-10T10:00:24.500Z", message: { id: "msg_synthetic", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "No response requested." }], usage: usage(0, 0, 0, 0) } }),
    line({ type: "assistant", uuid: "a6", timestamp: "2026-10-10T10:00:25.000Z", message: { id: "msg_api_error", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: 529 overloaded" }], usage: usage(0, 0, 0, 0) } }),
  ];
}

export function turnTwo(): string[] {
  return [
    line({ type: "user", uuid: "u3", promptId: PROMPT_2, timestamp: "2026-10-10T10:05:00.000Z", message: { role: "user", content: [{ type: "text", text: "Now update the README" }] } }),
    line({ type: "assistant", uuid: "a5", requestId: "req_3", timestamp: "2026-10-10T10:05:04.000Z", message: { id: "msg_three", model: "claude-test-model", role: "assistant", content: [{ type: "text", text: "README updated." }], usage: usage(6, 40, 5000, 100), stop_reason: "end_turn" } }),
  ];
}

export function subagent(): string[] {
  return [
    line({ type: "user", uuid: "s1", promptId: PROMPT_1, isSidechain: true, agentId: "explore01", timestamp: "2026-10-10T10:00:06.000Z", message: { role: "user", content: "Explore billing" } }),
    line({ type: "assistant", uuid: "s2", isSidechain: true, agentId: "explore01", timestamp: "2026-10-10T10:00:12.000Z", message: { id: "msg_sub", model: "claude-test-model", role: "assistant", content: [{ type: "tool_use", id: "toolu_grep", name: "Grep", input: { pattern: "billing" } }, { type: "text", text: "Found it." }], usage: usage(20, 80, 0, 900), stop_reason: "end_turn" } }),
  ];
}
