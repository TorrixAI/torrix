import type { Run, TraceAnnotation } from "../api";

export interface TraceSubtree {
  runs: number;
  cost: number;
  tokens: number;
  errors: number;
  startMs: number;
  endMs: number;
}

export interface TraceTreeNode {
  run: Run;
  depth: number;
  parentRunId: string | null;
  children: TraceTreeNode[];
  lastSibling: boolean;
  ancestorLast: boolean[];
  orphanParentId: string | null;
  cycleBroken: boolean;
  subtree: TraceSubtree;
}

export interface TraceTree {
  roots: TraceTreeNode[];
  flat: TraceTreeNode[];
  byId: Map<string, TraceTreeNode>;
  parents: Map<string, string | null>;
}

export function runStartMs(run: Run): number {
  const value = Date.parse(run.created_at);
  return Number.isFinite(value) ? value : 0;
}

export function runEndMs(run: Run): number {
  return runStartMs(run) + Math.max(0, run.latency_ms ?? 0);
}

export function runFailed(run: Run): boolean {
  return Number(run.status) >= 400 || Boolean(run.error);
}

function byStart(a: TraceTreeNode, b: TraceTreeNode): number {
  const delta = runStartMs(a.run) - runStartMs(b.run);
  return delta !== 0 ? delta : a.run.id.localeCompare(b.run.id);
}

/** The web build of the run tree. It keeps the server builder's orphan and cycle rules. */
export function buildTraceTree(runs: Run[]): TraceTree {
  const byId = new Map<string, TraceTreeNode>();
  for (const run of runs) {
    if (byId.has(run.id)) continue;
    byId.set(run.id, {
      run,
      depth: 0,
      parentRunId: null,
      children: [],
      lastSibling: false,
      ancestorLast: [],
      orphanParentId: null,
      cycleBroken: false,
      subtree: { runs: 0, cost: 0, tokens: 0, errors: 0, startMs: 0, endMs: 0 },
    });
  }

  const createsCycle = (node: TraceTreeNode, parentId: string): boolean => {
    let cursor: string | null | undefined = parentId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      if (cursor === node.run.id) return true;
      guard.add(cursor);
      cursor = byId.get(cursor)?.run.parent_run_id;
    }
    return false;
  };

  const roots: TraceTreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.run.parent_run_id;
    const parent = parentId && parentId !== node.run.id ? byId.get(parentId) : undefined;
    if (parent && !createsCycle(node, parentId!)) {
      node.parentRunId = parent.run.id;
      parent.children.push(node);
    } else {
      node.orphanParentId = parent ? null : (parentId ?? null);
      node.cycleBroken = Boolean(parent) || parentId === node.run.id;
      roots.push(node);
    }
  }

  roots.sort(byStart);
  const flat: TraceTreeNode[] = [];
  const stack: Array<{ node: TraceTreeNode; depth: number; ancestorLast: boolean[]; last: boolean }> = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: roots[index], depth: 0, ancestorLast: [], last: index === roots.length - 1 });
  }
  while (stack.length) {
    const { node, depth, ancestorLast, last } = stack.pop()!;
    node.depth = depth;
    node.ancestorLast = ancestorLast;
    node.lastSibling = last;
    flat.push(node);
    node.children.sort(byStart);
    const nextAncestors = depth === 0 ? [] : [...ancestorLast, last];
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index], depth: depth + 1, ancestorLast: nextAncestors, last: index === node.children.length - 1 });
    }
  }

  for (let index = flat.length - 1; index >= 0; index -= 1) {
    const node = flat[index];
    const run = node.run;
    const totals: TraceSubtree = {
      runs: 1,
      cost: Number(run.cost_usd) || 0,
      tokens: (run.input_tokens ?? 0) + (run.output_tokens ?? 0),
      errors: runFailed(run) ? 1 : 0,
      startMs: runStartMs(run),
      endMs: runEndMs(run),
    };
    for (const child of node.children) {
      totals.runs += child.subtree.runs;
      totals.cost += child.subtree.cost;
      totals.tokens += child.subtree.tokens;
      totals.errors += child.subtree.errors;
      totals.startMs = Math.min(totals.startMs, child.subtree.startMs);
      totals.endMs = Math.max(totals.endMs, child.subtree.endMs);
    }
    node.subtree = totals;
  }

  const parents = new Map<string, string | null>();
  for (const node of flat) parents.set(node.run.id, node.parentRunId);
  return { roots, flat, byId, parents };
}

export function traceAgent(run: Run): string {
  return run.agent_name?.trim() || "unknown";
}

/** Stable categorical colour for an agent across Flow, the rail and the Runs list. */
export function agentColorIndex(agent: string): number {
  let hash = 2166136261;
  for (let index = 0; index < agent.length; index += 1) {
    hash ^= agent.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 6;
}

export function agentColorToken(agent: string): string {
  return `--s${agentColorIndex(agent) + 1}`;
}

export interface TraceLane {
  key: string;
  label: string;
  colorToken: string;
  folded?: string[];
}

export interface LaneAssignment {
  lanes: TraceLane[];
  laneByRun: Map<string, number>;
  laneByAgent: Map<string, number>;
  agentOrder: string[];
  folded: string[];
}

export const FOLDED_AGENT_KEY = "__folded";

export function assignLanes(nodes: TraceTreeNode[], maxVisible = 8): LaneAssignment {
  const agentOrder: string[] = [];
  for (const node of nodes) {
    const agent = traceAgent(node.run);
    if (!agentOrder.includes(agent)) agentOrder.push(agent);
  }
  const limit = Math.max(2, maxVisible);
  const namedCount = agentOrder.length <= limit ? agentOrder.length : limit - 1;
  const named = agentOrder.slice(0, namedCount);
  const folded = agentOrder.slice(namedCount);
  const lanes: TraceLane[] = named.map((agent) => ({
    key: agent,
    label: agent,
    colorToken: agentColorToken(agent),
  }));
  if (folded.length) {
    lanes.push({
      key: FOLDED_AGENT_KEY,
      label: `+${folded.length}`,
      colorToken: "--text-3",
      folded,
    });
  }

  const laneByAgent = new Map<string, number>();
  named.forEach((agent, index) => laneByAgent.set(agent, index));
  const foldedLane = folded.length ? lanes.length - 1 : -1;
  for (const agent of folded) laneByAgent.set(agent, foldedLane);
  const laneByRun = new Map<string, number>();
  for (const node of nodes) laneByRun.set(node.run.id, laneByAgent.get(traceAgent(node.run)) ?? 0);
  return { lanes, laneByRun, laneByAgent, agentOrder, folded };
}

export type DecisionKind = "allowed" | "held" | "denied";

export interface DecisionFact {
  kind: DecisionKind;
  label: string;
  icon: string;
  colorToken: string;
  policy: string | null;
  approver: string | null;
  requestId: string;
}

const ALLOWED = new Set(["allow", "allowed", "approved", "executed", "success", "succeeded"]);
const HELD = new Set(["require_approval", "required_approval", "pending_approval", "pending", "held", "awaiting_approval"]);

export function decisionFact(annotation: TraceAnnotation): DecisionFact {
  const status = String(annotation.status ?? annotation.approval?.state ?? "").trim().toLowerCase();
  const kind: DecisionKind = ALLOWED.has(status) ? "allowed" : HELD.has(status) ? "held" : "denied";
  const policy = annotation.meta?.policy?.name ?? null;
  const approver = annotation.approval?.reviewer ?? annotation.meta?.principal?.display_name ?? null;
  const requestId = annotation.meta?.request_id ?? annotation.id;
  return {
    kind,
    label: kind === "allowed" ? "Allowed" : kind === "held" ? "Held" : "Denied",
    icon: kind === "allowed" ? "✓" : kind === "held" ? "◷" : "✕",
    colorToken: kind === "allowed" ? "--good" : kind === "held" ? "--warn" : "--bad",
    policy,
    approver,
    requestId,
  };
}

export interface CollapseSummary {
  steps: number;
  cost: number;
  durationMs: number;
  errors: number;
}

export interface RunTraceRow {
  kind: "run";
  key: string;
  run: Run;
  node: TraceTreeNode;
  lane: number;
  depth: number;
  level: number;
  collapsed: boolean;
  summary: CollapseSummary | null;
  firstFailure: boolean;
}

export interface DecisionTraceRow {
  kind: "decision";
  key: string;
  annotation: TraceAnnotation;
  run: Run;
  node: TraceTreeNode;
  lane: number;
  depth: number;
  level: number;
  fact: DecisionFact;
}

export type TraceRow = RunTraceRow | DecisionTraceRow;

/** The rail node shape: decisions are diamonds, tool calls squares, model calls circles. */
export function traceNodeShape(row: TraceRow, hasToolCall: boolean): "decision" | "tool" | "model" {
  if (row.kind === "decision") return "decision";
  return hasToolCall ? "tool" : "model";
}

export interface VisibleTrace {
  rows: TraceRow[];
  /** Last visible row index inside each run's subtree, used by return connectors. */
  spanEndById: Map<string, number>;
}

export function buildVisibleRows(
  tree: TraceTree,
  collapsed: Set<string>,
  annotations: TraceAnnotation[] = [],
  firstFailingRunId: string | null = null,
): VisibleTrace {
  const byRun = new Map<string, TraceAnnotation[]>();
  for (const annotation of annotations) {
    if (!annotation.runId) continue;
    const bucket = byRun.get(annotation.runId) ?? [];
    bucket.push(annotation);
    byRun.set(annotation.runId, bucket);
  }
  for (const bucket of byRun.values()) {
    bucket.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  }

  const rows: TraceRow[] = [];
  const spanEndById = new Map<string, number>();

  const visit = (node: TraceTreeNode) => {
    const lane = 0;
    const isCollapsed = node.children.length > 0 && collapsed.has(node.run.id);
    const hiddenRuns = Math.max(0, node.subtree.runs - 1);
    const summary: CollapseSummary | null = isCollapsed
      ? {
          steps: hiddenRuns,
          cost: Math.max(0, node.subtree.cost - (Number(node.run.cost_usd) || 0)),
          durationMs: Math.max(0, node.subtree.endMs - node.subtree.startMs),
          errors: Math.max(0, node.subtree.errors - (runFailed(node.run) ? 1 : 0)),
        }
      : null;
    rows.push({
      kind: "run",
      key: `run:${node.run.id}`,
      run: node.run,
      node,
      lane,
      depth: node.depth,
      level: node.depth + 1,
      collapsed: isCollapsed,
      summary,
      firstFailure: node.run.id === firstFailingRunId,
    });
    for (const annotation of byRun.get(node.run.id) ?? []) {
      rows.push({
        kind: "decision",
        key: `decision:${annotation.id}`,
        annotation,
        run: node.run,
        node,
        lane,
        depth: node.depth + 1,
        level: node.depth + 2,
        fact: decisionFact(annotation),
      });
    }
    if (!isCollapsed) {
      for (const child of node.children) visit(child);
    }
    spanEndById.set(node.run.id, rows.length - 1);
  };

  for (const root of tree.roots) visit(root);
  return { rows, spanEndById };
}

/** Assign the lane in a second pass so the row builder can stay independent of layout. */
export function withLanes(visible: VisibleTrace, lanes: LaneAssignment): VisibleTrace {
  return {
    spanEndById: visible.spanEndById,
    rows: visible.rows.map((row) => ({ ...row, lane: lanes.laneByRun.get(row.run.id) ?? 0 })),
  };
}

export function resolveFirstFailure(tree: TraceTree, firstFailingRunId: string | null): string | null {
  if (firstFailingRunId && tree.byId.has(firstFailingRunId)) return firstFailingRunId;
  return tree.flat.find((node) => runFailed(node.run))?.run.id ?? null;
}

export function ancestorsOf(tree: TraceTree, runId: string): string[] {
  const ancestors: string[] = [];
  const guard = new Set<string>();
  let cursor = tree.parents.get(runId) ?? null;
  while (cursor && !guard.has(cursor)) {
    ancestors.push(cursor);
    guard.add(cursor);
    cursor = tree.parents.get(cursor) ?? null;
  }
  return ancestors;
}

export function toggleCollapsed(current: Set<string>, runId: string): Set<string> {
  const next = new Set(current);
  if (next.has(runId)) next.delete(runId);
  else next.add(runId);
  return next;
}

export function allCollapsible(tree: TraceTree): string[] {
  return tree.flat.filter((node) => node.children.length > 0).map((node) => node.run.id);
}

export interface VirtualWindow {
  start: number;
  end: number;
  offset: number;
  height: number;
}

export function windowFor(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): VirtualWindow {
  if (count <= 0) return { start: 0, end: 0, offset: 0, height: 0 };
  const height = Math.max(1, rowHeight);
  const first = Math.min(count - 1, Math.max(0, Math.floor(Math.max(0, scrollTop) / height)));
  const visible = Math.max(1, Math.ceil(Math.max(1, viewportHeight) / height));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offset: start * height, height: Math.max(0, end - start) * height };
}
