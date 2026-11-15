import { expect, test } from "bun:test";
import type { Run, TraceAnnotation } from "../src/api";
import type { TraceRow } from "../src/lib/traceGraph";
import { EMPTY_STEP_FILTER, rowMatchesStepFilter, runMatchesStepFilter, stepFilterActive, stepMatches, type TraceStepFilter } from "../src/lib/traceFilter";

const run = (overrides: Partial<Run> = {}): Run => ({
  id: "run_1",
  created_at: "2026-01-01T10:00:00.000Z",
  agent_name: "build",
  model: "gpt-4o",
  status: 200,
  ...overrides,
});

const tools = (...names: string[]) => names;

const filter = (overrides: Partial<TraceStepFilter> = {}): TraceStepFilter => ({ ...EMPTY_STEP_FILTER, ...overrides });

const runRow = (value: Run): TraceRow => ({ kind: "run", key: `run:${value.id}`, run: value } as TraceRow);

const decisionRow = (value: Run, annotation: Partial<TraceAnnotation>, factKind: "allowed" | "held" | "denied"): TraceRow => ({
  kind: "decision",
  key: `decision:${annotation.id ?? "x"}`,
  run: value,
  annotation: { id: "d1", kind: "policy", at: "2026-01-01T10:00:00.000Z", title: "policy", ...annotation } as TraceAnnotation,
  fact: { kind: factKind, label: factKind, icon: "", colorToken: "--text-3", policy: null, approver: null, requestId: "r1" },
} as TraceRow);

test("an empty filter matches every row", () => {
  expect(stepFilterActive(EMPTY_STEP_FILTER)).toBe(false);
  expect(runMatchesStepFilter(run(), undefined, EMPTY_STEP_FILTER)).toBe(true);
  expect(runMatchesStepFilter(run({ model: "other" }), tools("Read"), EMPTY_STEP_FILTER)).toBe(true);
});

test("agent, model, tool and failure filters compose on a run", () => {
  const value = run({ status: 500, error: "boom" });
  expect(runMatchesStepFilter(value, tools("Read"), filter({ agent: "build" }))).toBe(true);
  expect(runMatchesStepFilter(value, tools("Read"), filter({ agent: "review" }))).toBe(false);
  expect(runMatchesStepFilter(value, tools("Read"), filter({ model: "gpt-4o" }))).toBe(true);
  expect(runMatchesStepFilter(value, tools("Read"), filter({ model: "claude" }))).toBe(false);
  expect(runMatchesStepFilter(value, tools("Read"), filter({ tool: "Read" }))).toBe(true);
  expect(runMatchesStepFilter(value, tools("Edit"), filter({ tool: "Read" }))).toBe(false);
  expect(runMatchesStepFilter(value, tools("Read", "Edit"), filter({ tool: "Edit" }))).toBe(true);
  expect(runMatchesStepFilter(value, undefined, filter({ tool: "Read" }))).toBe(false);
  expect(runMatchesStepFilter(value, tools("Read"), filter({ failuresOnly: true }))).toBe(true);
  expect(runMatchesStepFilter(run(), tools("Read"), filter({ failuresOnly: true }))).toBe(false);
});

test("the step kind partitions model calls, tool calls and decisions", () => {
  expect(runMatchesStepFilter(run(), tools("Read"), filter({ type: "model" }))).toBe(false);
  expect(runMatchesStepFilter(run(), undefined, filter({ type: "model" }))).toBe(true);
  expect(runMatchesStepFilter(run(), tools("Read"), filter({ type: "tool" }))).toBe(true);
  expect(runMatchesStepFilter(run(), undefined, filter({ type: "tool" }))).toBe(false);
  expect(runMatchesStepFilter(run(), tools("Read"), filter({ type: "decision" }))).toBe(false);
  const decision = decisionRow(run(), { id: "d1" }, "allowed");
  expect(rowMatchesStepFilter(decision, undefined, filter({ type: "decision" }))).toBe(true);
  expect(rowMatchesStepFilter(decision, undefined, filter({ type: "model" }))).toBe(false);
});

test("decisions match the annotation tool and denied state", () => {
  const annotation = { id: "d2", meta: { tool_name: "createPurchaseOrder" } };
  const denied = decisionRow(run(), annotation, "denied");
  expect(rowMatchesStepFilter(denied, undefined, filter({ tool: "createPurchaseOrder" }))).toBe(true);
  expect(rowMatchesStepFilter(denied, undefined, filter({ tool: "Read" }))).toBe(false);
  expect(rowMatchesStepFilter(denied, undefined, filter({ failuresOnly: true }))).toBe(true);
  expect(rowMatchesStepFilter(decisionRow(run(), annotation, "allowed"), undefined, filter({ failuresOnly: true }))).toBe(false);
  expect(rowMatchesStepFilter(denied, undefined, filter({ agent: "review" }))).toBe(false);
});

test("counts report matched and total steps", () => {
  const firstTools = new Map([["run_1", tools("Read")], ["run_2", tools("Edit")]]);
  const rows = [runRow(run({ id: "run_1" })), runRow(run({ id: "run_2", status: 500 }))];
  expect(stepMatches(rows, firstTools, EMPTY_STEP_FILTER)).toEqual({ matched: 2, total: 2 });
  expect(stepMatches(rows, firstTools, filter({ tool: "Read" }))).toEqual({ matched: 1, total: 2 });
  expect(stepMatches(rows, firstTools, filter({ type: "model" }))).toEqual({ matched: 0, total: 2 });
  expect(stepMatches(rows, firstTools, filter({ type: "tool" }))).toEqual({ matched: 2, total: 2 });
  expect(stepMatches(rows, firstTools, filter({ failuresOnly: true }))).toEqual({ matched: 1, total: 2 });
});
