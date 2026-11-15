import type { Run } from "../api";
import { toolStep } from "./conversation";
import { runFailed, traceAgent, type TraceRow } from "./traceGraph";

/** Step-level filter for the execution graph and the Flow timeline. */
export interface TraceStepFilter {
  agent: string;
  model: string;
  tool: string;
  type: "all" | "model" | "tool" | "decision";
  failuresOnly: boolean;
}

export const EMPTY_STEP_FILTER: TraceStepFilter = {
  agent: "",
  model: "",
  tool: "",
  type: "all",
  failuresOnly: false,
};

export function stepFilterActive(filter: TraceStepFilter): boolean {
  return Boolean(filter.agent || filter.model || filter.tool || filter.type !== "all" || filter.failuresOnly);
}

export function toolNameOf(firstTool: string | undefined): string {
  return firstTool ? toolStep(firstTool).name : "";
}

/** A run matches the agent/model/tool/type/failure parts of the filter. */
export function runMatchesStepFilter(run: Run, toolNames: readonly string[] | undefined, filter: TraceStepFilter): boolean {
  const tools = toolNames ?? [];
  if (!stepFilterActive(filter)) return true;
  if (filter.type === "decision") return false;
  if (filter.type === "model" && tools.length) return false;
  if (filter.type === "tool" && !tools.length) return false;
  if (filter.agent && traceAgent(run) !== filter.agent) return false;
  if (filter.model && (run.model ?? "") !== filter.model) return false;
  if (filter.tool && !tools.includes(filter.tool)) return false;
  if (filter.failuresOnly && !runFailed(run)) return false;
  return true;
}

/** Decision rows can carry their tool in the annotation metadata. */
export function rowMatchesStepFilter(row: TraceRow, toolNames: readonly string[] | undefined, filter: TraceStepFilter): boolean {
  if (!stepFilterActive(filter)) return true;
  if (row.kind === "run") return runMatchesStepFilter(row.run, toolNames, filter);
  if (filter.type === "model" || filter.type === "tool") return false;
  if (filter.failuresOnly && row.fact.kind !== "denied") return false;
  if (filter.agent && traceAgent(row.run) !== filter.agent) return false;
  if (filter.model && (row.run.model ?? "") !== filter.model) return false;
  if (filter.tool && (row.annotation.meta?.tool_name ?? "") !== filter.tool) return false;
  return true;
}

export function stepMatches(rows: TraceRow[], toolNames: Map<string, readonly string[]>, filter: TraceStepFilter): { matched: number; total: number } {
  if (!stepFilterActive(filter)) return { matched: rows.length, total: rows.length };
  let matched = 0;
  for (const row of rows) {
    if (rowMatchesStepFilter(row, toolNames.get(row.run.id), filter)) matched += 1;
  }
  return { matched, total: rows.length };
}
