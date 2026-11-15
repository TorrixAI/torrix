import { expect, test } from "bun:test";
import type { Events, Run } from "../src/core/domain";
import { buildTraceDigestFromRuns } from "../src/lib/insights";

function run(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    user_id: "u1",
    project_id: "p1",
    name: id,
    status: 200,
    latency_ms: 100,
    cost_usd: 0.01,
    trace_id: "trace-1",
    created_at: new Date(2026, 0, 1, 0, Number(id.replace(/\D/g, "") || 0)).toISOString(),
    ...overrides,
  } as Run;
}

test("trace digest uses the human prompt, final answer, errors and elides long middles", () => {
  const runs = Array.from({ length: 40 }, (_, index) => run(`r${index}`, {
    request_body: index === 0 ? JSON.stringify({ messages: [{ role: "user", content: "Check supplier order." }] }) : null,
    status: index === 22 ? 500 : 200,
    parent_run_id: index === 5 ? "r0" : null,
  }));
  const events: Events[] = [
    { id: "e0", run_id: "r0", type: "tool_call", message: JSON.stringify([{ name: "read_file", arguments: { path: "order.json" } }]), created_at: new Date().toISOString() },
    { id: "e1", run_id: "r39", type: "response", message: "The order is cleared.", created_at: new Date().toISOString() },
    { id: "e2", run_id: "r22", type: "error", message: "upstream timeout while reading supplier", created_at: new Date().toISOString() },
    { id: "e3", run_id: "r1", type: "prompt", message: "tool result only", created_at: new Date().toISOString() },
  ];
  const digest = buildTraceDigestFromRuns(runs, events, 800);
  expect(digest.prompt).toBe("Check supplier order.");
  expect(digest.answer).toBe("The order is cleared.");
  expect(digest.steps.find((step) => step.run_id === "r22")?.error).toContain("upstream timeout");
  expect(digest.steps.find((step) => step.run_id === "r5")?.subagent).toBe(true);
  expect(digest.steps.find((step) => step.run_id === "r0")?.tool).toBe("read_file");
  expect(digest.elided).toBeGreaterThan(0);
  expect(digest.text).toContain("elided");
  expect(digest.totals.errors).toBe(1);
});
