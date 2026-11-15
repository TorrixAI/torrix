import { expect, test } from "bun:test";
import type { Run, TraceAnnotation } from "../src/api";
import {
  assignLanes,
  ancestorsOf,
  buildTraceTree,
  buildVisibleRows,
  decisionFact,
  resolveFirstFailure,
  toggleCollapsed,
  traceNodeShape,
  windowFor,
  withLanes,
} from "../src/lib/traceGraph";

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

function makeRun(id: string, agent: string, parent: string | null = null, index = 0, extra: Partial<Run> = {}): Run {
  return {
    id,
    parent_run_id: parent,
    agent_name: agent,
    status: 200,
    latency_ms: 100,
    cost_usd: 0.01,
    input_tokens: 10,
    output_tokens: 5,
    created_at: new Date(BASE + index * 1_000).toISOString(),
    ...extra,
  } as Run;
}

function annotation(runId: string, id = "decision-1", status = "require_approval"): TraceAnnotation {
  return {
    id,
    kind: "authorization",
    runId,
    at: new Date(BASE + 500).toISOString(),
    title: "REQUIRE_APPROVAL createPurchaseOrder",
    status,
    meta: { request_id: `req-${id}`, policy: { name: "Large purchases need approval" } },
  };
}

test("lane assignment keeps the root agent first and parallel children in first-appearance order", () => {
  const tree = buildTraceTree([
    makeRun("root", "root", null, 0),
    makeRun("left", "alpha", "root", 1),
    makeRun("right", "beta", "root", 2),
  ]);
  const lanes = assignLanes(tree.flat);
  expect(lanes.agentOrder).toEqual(["root", "alpha", "beta"]);
  expect(lanes.lanes.map((lane) => lane.label)).toEqual(["root", "alpha", "beta"]);
  expect(lanes.laneByRun.get("root")).toBe(0);
  expect(lanes.laneByRun.get("left")).toBe(1);
  expect(lanes.laneByRun.get("right")).toBe(2);
});

test("deep nesting keeps one lane per agent and folds agents after the eighth lane", () => {
  const runs = Array.from({ length: 10 }, (_, index) =>
    makeRun(`agent-${index}`, `agent-${index}`, index === 0 ? null : `agent-${index - 1}`, index),
  );
  const tree = buildTraceTree(runs);
  expect(tree.flat).toHaveLength(10);
  expect(tree.flat[9]?.depth).toBe(9);
  const lanes = assignLanes(tree.flat);
  expect(lanes.lanes).toHaveLength(8);
  expect(lanes.lanes[7]?.label).toBe("+3");
  expect(lanes.laneByRun.get("agent-8")).toBe(7);
  expect(lanes.laneByRun.get("agent-9")).toBe(7);
});

test("orphan and cyclic parents become roots without losing or duplicating runs", () => {
  const tree = buildTraceTree([
    makeRun("orphan", "solo", "missing-parent", 0),
    makeRun("a", "alpha", "b", 1),
    makeRun("b", "beta", "a", 2),
  ]);
  expect(tree.flat).toHaveLength(3);
  expect(tree.roots).toHaveLength(3);
  expect(tree.byId.get("orphan")?.orphanParentId).toBe("missing-parent");
  expect(tree.byId.get("a")?.cycleBroken).toBe(true);
  expect(tree.byId.get("b")?.cycleBroken).toBe(true);
  expect(assignLanes(tree.flat).lanes.map((lane) => lane.label)).toEqual(["solo", "alpha", "beta"]);
});

test("collapsing a spawn node replaces its descendants with one summary row", () => {
  const tree = buildTraceTree([
    makeRun("root", "root", null, 0, { cost_usd: 0.02 }),
    makeRun("left", "alpha", "root", 1, { cost_usd: 0.03 }),
    makeRun("right", "beta", "root", 2, { status: 500, cost_usd: 0.04 }),
  ]);
  const collapsed = new Set(["root"]);
  const visible = withLanes(buildVisibleRows(tree, collapsed, [], "right"), assignLanes(tree.flat));
  expect(visible.rows).toHaveLength(1);
  expect(visible.rows[0]?.kind).toBe("run");
  if (visible.rows[0]?.kind === "run") {
    expect(visible.rows[0].collapsed).toBe(true);
    expect(visible.rows[0].summary).toMatchObject({ steps: 2, errors: 1 });
    expect(visible.rows[0].summary?.cost).toBeCloseTo(0.07);
  }
  const expanded = buildVisibleRows(tree, new Set(), [], "right");
  expect(expanded.rows).toHaveLength(3);
  expect(toggleCollapsed(collapsed, "root").has("root")).toBe(false);
  expect(ancestorsOf(tree, "right")).toEqual(["root"]);
});

test("decision rows follow their run and keep the run lane", () => {
  const tree = buildTraceTree([
    makeRun("root", "root", null, 0),
    makeRun("child", "alpha", "root", 1),
  ]);
  const lanes = assignLanes(tree.flat);
  const visible = withLanes(buildVisibleRows(tree, new Set(), [annotation("child")]), lanes);
  const decision = visible.rows.find((row) => row.kind === "decision");
  expect(decision?.kind).toBe("decision");
  expect(decision?.level).toBe(3);
  expect(decision?.lane).toBe(lanes.laneByRun.get("child"));
  if (decision?.kind === "decision") {
    expect(decision.fact.kind).toBe("held");
    expect(decision.fact.policy).toBe("Large purchases need approval");
    expect(decision.fact.requestId).toBe("req-decision-1");
  }
});

test("first failure prefers the judged run and falls back to the first failed run", () => {
  const tree = buildTraceTree([
    makeRun("root", "root", null, 0),
    makeRun("bad-first", "alpha", "root", 1, { status: 500 }),
    makeRun("bad-second", "beta", "root", 2, { status: 429 }),
  ]);
  expect(resolveFirstFailure(tree, "bad-second")).toBe("bad-second");
  expect(resolveFirstFailure(tree, null)).toBe("bad-first");
  expect(resolveFirstFailure(tree, "missing")).toBe("bad-first");
});

test("decision status maps to allowed, held and denied without colour as the only cue", () => {
  expect(decisionFact(annotation("r", "a", "approved")).kind).toBe("allowed");
  expect(decisionFact(annotation("r", "b", "require_approval")).kind).toBe("held");
  expect(decisionFact(annotation("r", "c", "denied")).kind).toBe("denied");
  expect(decisionFact(annotation("r", "d", "unknown")).icon).toBe("✕");
});

test("virtual window keeps overscan and never renders beyond the row count", () => {
  expect(windowFor(0, 0, 400, 36)).toEqual({ start: 0, end: 0, offset: 0, height: 0 });
  const window = windowFor(1_000, 3_600, 360, 36, 4);
  expect(window.start).toBe(96);
  expect(window.end).toBe(114);
  expect(window.offset).toBe(3_456);
  expect(window.height).toBe(648);
  expect(windowFor(5, 10_000, 360, 36).end).toBe(5);
});

test("rail node shapes follow the legend: circle, square, diamond", () => {
  const run = makeRun("shape_run", "build");
  const tree = buildTraceTree([run]);
  const plain = withLanes(buildVisibleRows(tree, new Set()), assignLanes(tree.flat)).rows;
  expect(traceNodeShape(plain[0], false)).toBe("model");
  expect(traceNodeShape(plain[0], true)).toBe("tool");

  const annotation: TraceAnnotation = {
    id: "shape_decision",
    kind: "policy",
    runId: "shape_run",
    at: new Date(BASE + 500).toISOString(),
    title: "Allow purchase",
    status: "allowed",
  };
  const withDecision = withLanes(buildVisibleRows(tree, new Set(), [annotation]), assignLanes(tree.flat)).rows;
  const decision = withDecision.find((row) => row.kind === "decision");
  expect(decision ? traceNodeShape(decision, false) : null).toBe("decision");
});
