import type { Run } from "../core/domain";

/** Totals for a node and everything beneath it, so a branch answers "what did this subagent cost". */
export interface RunSubtree {
  runs: number;
  cost: number;
  tokens: number;
  errors: number;
  /** Latest end time (start + latency) anywhere in the branch, epoch ms. */
  endMs: number;
}

export interface RunTreeNode {
  run: Run;
  depth: number;
  children: RunTreeNode[];
  /** True when this node is the last of its parent's children (or the last root). */
  lastSibling: boolean;
  /** For each ancestor level, whether that ancestor was the last of its siblings. */
  ancestorLast: boolean[];
  /** Set when the run names a parent that is not part of the provided set. */
  orphanParentId: string | null;
  /** Set when the run's parent link was dropped to break a cycle. */
  cycleBroken: boolean;
  subtree: RunSubtree;
}

export interface RunTree {
  roots: RunTreeNode[];
  /** Depth-first pre-order list of every node, ready for table rendering. */
  flat: RunTreeNode[];
}

export function runStartMs(run: Run): number {
  const t = Date.parse(run.created_at);
  return Number.isFinite(t) ? t : 0;
}

export function runEndMs(run: Run): number {
  return runStartMs(run) + Math.max(0, run.latency_ms ?? 0);
}

function byStart(a: RunTreeNode, b: RunTreeNode): number {
  const diff = runStartMs(a.run) - runStartMs(b.run);
  return diff !== 0 ? diff : a.run.id.localeCompare(b.run.id);
}

function isError(run: Run): boolean {
  return run.status != null && run.status >= 400;
}

/**
 * Builds the parent/child forest implied by `parent_run_id`. Runs whose parent
 * is missing from the set become roots tagged with `orphanParentId`; parent
 * links that would form a cycle are dropped and flagged. Traversal is
 * iterative, so very deep agent chains cannot overflow the stack.
 */
export function buildRunTree(runs: Run[]): RunTree {
  const nodes = new Map<string, RunTreeNode>();
  for (const run of runs) {
    if (!nodes.has(run.id)) {
      nodes.set(run.id, {
        run,
        depth: 0,
        children: [],
        lastSibling: false,
        ancestorLast: [],
        orphanParentId: null,
        cycleBroken: false,
        subtree: { runs: 0, cost: 0, tokens: 0, errors: 0, endMs: 0 },
      });
    }
  }

  // A parent link is kept only if following parents from it never returns to the node.
  const createsCycle = (node: RunTreeNode, parentId: string): boolean => {
    let cursor: string | null | undefined = parentId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      if (cursor === node.run.id) {
        return true;
      }
      guard.add(cursor);
      cursor = nodes.get(cursor)?.run.parent_run_id;
    }
    return false;
  };

  const roots: RunTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.run.parent_run_id;
    const parent = parentId && parentId !== node.run.id ? nodes.get(parentId) : undefined;
    if (parent && !createsCycle(node, parentId!)) {
      parent.children.push(node);
    } else {
      node.orphanParentId = parent ? null : (parentId ?? null);
      node.cycleBroken = Boolean(parent) || parentId === node.run.id;
      roots.push(node);
    }
  }

  roots.sort(byStart);
  const flat: RunTreeNode[] = [];
  const stack: Array<{ node: RunTreeNode; depth: number; ancestorLast: boolean[]; last: boolean }> = [];
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    stack.push({ node: roots[i], depth: 0, ancestorLast: [], last: i === roots.length - 1 });
  }
  while (stack.length) {
    const { node, depth, ancestorLast, last } = stack.pop()!;
    node.depth = depth;
    node.ancestorLast = ancestorLast;
    node.lastSibling = last;
    flat.push(node);
    node.children.sort(byStart);
    const childAncestors = depth === 0 ? [] : [...ancestorLast, last];
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: node.children[i], depth: depth + 1, ancestorLast: childAncestors, last: i === node.children.length - 1 });
    }
  }

  // Post-order rollups: walking the pre-order list backwards visits children before parents.
  for (let i = flat.length - 1; i >= 0; i -= 1) {
    const node = flat[i];
    const run = node.run;
    const totals: RunSubtree = {
      runs: 1,
      cost: run.cost_usd ?? 0,
      tokens: (run.input_tokens ?? 0) + (run.output_tokens ?? 0),
      errors: isError(run) ? 1 : 0,
      endMs: runEndMs(run),
    };
    for (const child of node.children) {
      totals.runs += child.subtree.runs;
      totals.cost += child.subtree.cost;
      totals.tokens += child.subtree.tokens;
      totals.errors += child.subtree.errors;
      totals.endMs = Math.max(totals.endMs, child.subtree.endMs);
    }
    node.subtree = totals;
  }
  return { roots, flat };
}
