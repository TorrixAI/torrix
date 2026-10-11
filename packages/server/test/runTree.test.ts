import { expect, test } from "bun:test";
import type { Run } from "../src/core/domain";
import { buildRunTree } from "../src/lib/runTree";

let seq = 0;

function makeRun(overrides: Partial<Run>): Run {
  seq += 1;
  return {
    id: `run-${seq}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    ...overrides,
  } as unknown as Run;
}

test("buildRunTree nests children under their parent and flattens depth-first", () => {
  const root = makeRun({ id: "root", created_at: "2026-01-01T00:00:00.000Z" });
  const child = makeRun({ id: "child", parent_run_id: root.id, created_at: "2026-01-01T00:00:01.000Z" });
  const sibling = makeRun({ id: "sibling", created_at: "2026-01-01T00:00:02.000Z" });
  const grandchild = makeRun({ id: "grandchild", parent_run_id: child.id, created_at: "2026-01-01T00:00:03.000Z" });

  const tree = buildRunTree([grandchild, sibling, child, root]);
  expect(tree.roots.map((n) => n.run.id)).toEqual(["root", "sibling"]);
  expect(tree.flat.map((n) => [n.run.id, n.depth])).toEqual([
    ["root", 0],
    ["child", 1],
    ["grandchild", 2],
    ["sibling", 0],
  ]);
  const node = (id: string) => tree.flat.find((n) => n.run.id === id) as NonNullable<ReturnType<typeof tree.flat.find>>;
  expect(node("root").lastSibling).toBe(false);
  expect(node("child").lastSibling).toBe(true);
  expect(node("grandchild").lastSibling).toBe(true);
  // Roots are not joined by guide lines, so the root level reserves no guide column.
  expect(node("grandchild").ancestorLast).toEqual([true]);
  expect(node("sibling").lastSibling).toBe(true);
});

test("buildRunTree orders siblings by created_at", () => {
  const root = makeRun({ id: "root", created_at: "2026-01-01T00:00:00.000Z" });
  const late = makeRun({ id: "late", parent_run_id: "root", created_at: "2026-01-01T00:00:09.000Z" });
  const early = makeRun({ id: "early", parent_run_id: "root", created_at: "2026-01-01T00:00:02.000Z" });

  const tree = buildRunTree([root, late, early]);
  expect(tree.flat.map((n) => n.run.id)).toEqual(["root", "early", "late"]);
});

test("buildRunTree marks runs whose parent is missing as orphan roots", () => {
  const orphan = makeRun({ id: "orphan", parent_run_id: "missing" });
  const tree = buildRunTree([orphan]);
  expect(tree.roots).toHaveLength(1);
  expect(tree.roots[0].orphanParentId).toBe("missing");
  expect(tree.roots[0].depth).toBe(0);
});

test("buildRunTree breaks cycles and self references without losing nodes", () => {
  const self = makeRun({ id: "self", parent_run_id: "self" });
  const a = makeRun({ id: "a", parent_run_id: "b" });
  const b = makeRun({ id: "b", parent_run_id: "a" });

  const tree = buildRunTree([self, a, b]);
  expect(tree.flat).toHaveLength(3);
  expect(tree.flat.map((n) => n.run.id).sort()).toEqual(["a", "b", "self"]);
  expect(tree.roots.some((n) => n.run.id === "self")).toBe(true);
});

test("buildRunTree rolls up cost, tokens, errors and end time per branch", () => {
  const root = makeRun({ id: "root", created_at: "2026-01-01T00:00:00.000Z", cost_usd: 1, input_tokens: 10, output_tokens: 5, latency_ms: 1000 });
  const sub = makeRun({ id: "sub", parent_run_id: "root", created_at: "2026-01-01T00:00:02.000Z", cost_usd: 0.5, input_tokens: 4, latency_ms: 3000 });
  const failed = makeRun({ id: "failed", parent_run_id: "sub", created_at: "2026-01-01T00:00:03.000Z", status: 500, cost_usd: 0.25 });
  const tree = buildRunTree([root, sub, failed]);
  const rootNode = tree.flat.find((n) => n.run.id === "root")!;
  expect(rootNode.subtree).toMatchObject({ runs: 3, cost: 1.75, tokens: 19, errors: 1 });
  expect(rootNode.subtree.endMs).toBe(Date.parse("2026-01-01T00:00:05.000Z"));
  expect(tree.flat.find((n) => n.run.id === "sub")!.subtree).toMatchObject({ runs: 2, errors: 1 });
});

test("buildRunTree breaks cycles, flags them, and survives very deep chains", () => {
  const a = makeRun({ id: "a", parent_run_id: "b", created_at: "2026-01-01T00:00:00.000Z" });
  const b = makeRun({ id: "b", parent_run_id: "a", created_at: "2026-01-01T00:00:01.000Z" });
  const cyclic = buildRunTree([a, b]);
  expect(cyclic.flat).toHaveLength(2);
  expect(cyclic.flat.some((n) => n.cycleBroken)).toBe(true);

  const chain = Array.from({ length: 3_000 }, (_, i) =>
    makeRun({ id: `r${i}`, parent_run_id: i ? `r${i - 1}` : null, created_at: new Date(Date.UTC(2026, 0, 1) + i).toISOString() }),
  );
  const deep = buildRunTree(chain);
  expect(deep.flat).toHaveLength(3_000);
  expect(deep.flat[2_999].depth).toBe(2_999);
  expect(deep.roots[0].subtree.runs).toBe(3_000);
});
