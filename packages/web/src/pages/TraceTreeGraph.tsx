import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DecisionStrip, EvidenceChip } from "../components";
import { fmtMs, fmtUsd, type TraceAnnotation } from "../api";
import {
  allCollapsible,
  ancestorsOf,
  assignLanes,
  buildVisibleRows,
  resolveFirstFailure,
  toggleCollapsed,
  traceAgent,
  traceNodeShape,
  windowFor,
  withLanes,
  type CollapseSummary,
  type DecisionTraceRow,
  type RunTraceRow,
  type TraceLane,
  type TraceTree,
  type TraceRow,
} from "../lib/traceGraph";
import { parseResponse, toolArgumentSummary, toolLabel, toolStep } from "../lib/conversation";
import { rowMatchesStepFilter, stepFilterActive, stepMatches, type TraceStepFilter } from "../lib/traceFilter";
import { useEffect, useMemo, useRef, useState } from "react";

interface TraceEventCount {
  tools: number;
  think: boolean;
  response: boolean;
}

interface TraceTreeGraphProps {
  kind: "trace" | "session";
  traceId: string;
  tree: TraceTree;
  firstFailingRunId: string | null;
  authorization: TraceAnnotation[];
  firstTools: Map<string, string>;
  lastAnswers: Map<string, string>;
  eventCounts: Map<string, TraceEventCount>;
  toolNames: Map<string, string[]>;
  stepFilter?: TraceStepFilter;
  onOpenRun: (runId: string) => void;
}

function useDensity(): "comfortable" | "compact" {
  const read = () => document.querySelector(".app")?.getAttribute("data-density") === "compact" ? "compact" : "comfortable";
  const [density, setDensity] = useState<"comfortable" | "compact">(read);
  useEffect(() => {
    const app = document.querySelector(".app");
    if (!app) return;
    setDensity(read());
    const observer = new MutationObserver(() => setDensity(read()));
    observer.observe(app, { attributes: true, attributeFilter: ["data-density"] });
    return () => observer.disconnect();
  }, []);
  return density;
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 699px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 699px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

function summaryText(summary: CollapseSummary | null): string {
  if (!summary) return "";
  return `${summary.steps} step${summary.steps === 1 ? "" : "s"}, ${fmtUsd(summary.cost)}, ${fmtMs(summary.durationMs)}, ${summary.errors} error${summary.errors === 1 ? "" : "s"}`;
}

function rowStep(row: RunTraceRow, firstTool: string | undefined, counts: TraceEventCount | undefined, lastAnswer: string | undefined) {
  const step = firstTool ? toolLabel(firstTool) : counts?.think ? "Thinking" : counts?.response ? "Answer" : row.run.name || "untitled";
  const tool = firstTool ? toolStep(firstTool).name : null;
  const toolExtra = counts?.tools && counts.tools > 1 ? ` +${counts.tools - 1}` : "";
  const secondLine = firstTool ? toolArgumentSummary(firstTool) : parseResponse(lastAnswer).text ?? parseResponse(lastAnswer).reasoning ?? "";
  return { step, tool, toolExtra, secondLine };
}

function runLabel(row: RunTraceRow, index: number, firstTool: string | undefined, counts: TraceEventCount | undefined, step: string): string {
  const isError = Number(row.run.status) >= 400 || Boolean(row.run.error);
  const kind = firstTool ? "tool call" : counts?.think ? "thinking" : counts?.response ? "answer" : "model call";
  const parts = [`step ${index + 1}`, `${kind} ${firstTool ? toolStep(firstTool).name : step}`, `agent ${traceAgent(row.run)}`];
  parts.push(isError ? "failed" : `status ${row.run.status ?? "unknown"}`);
  if (row.collapsed) parts.push(`collapsed, ${summaryText(row.summary)}`);
  return parts.join(", ");
}

function decisionLabel(row: DecisionTraceRow, index: number): string {
  return `step ${index + 1}, decision ${row.fact.label}, ${row.annotation.title}, agent ${traceAgent(row.run)}`;
}

function laneX(lane: number, railPad: number, laneGap: number): number {
  return railPad + lane * laneGap + laneGap / 2;
}

function Row({
  row,
  index,
  focused,
  dimmed,
  rail,
  railWidth,
  rowHeight,
  lane,
  firstTool,
  counts,
  lastAnswer,
  onToggle,
  onOpen,
  onFocus,
  onKeyDown,
}: {
  row: TraceRow;
  index: number;
  focused: boolean;
  dimmed: boolean;
  rail: boolean;
  railWidth: number;
  rowHeight: number;
  lane: TraceLane | undefined;
  firstTool: string | undefined;
  counts: TraceEventCount | undefined;
  lastAnswer: string | undefined;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, row: TraceRow, index: number) => void;
}) {
  const isRun = row.kind === "run";
  const run = row.run;
  const step = isRun ? rowStep(row, firstTool, counts, lastAnswer) : null;
  const isError = isRun && (Number(run.status) >= 400 || Boolean(run.error));
  const hasChildren = isRun && row.node.children.length > 0;
  const label = isRun ? runLabel(row, index, firstTool, counts, step!.step) : decisionLabel(row, index);
  const summary = isRun ? summaryText(row.summary) : "";
  const hint = isRun ? (row.collapsed ? summary : step?.secondLine ?? "") : "";
  const listIndent = 8 + row.depth * 14;
  return (
    <div
      className={[
        "trace-rail-row",
        isRun ? "trace-row-run" : "trace-row-decision",
        isError ? "trace-row-failed" : "",
        row.kind === "run" && row.firstFailure ? "trace-row-first-failure" : "",
        row.kind === "run" && row.collapsed ? "trace-row-collapsed" : "",
        dimmed ? "is-dimmed" : "",
      ].filter(Boolean).join(" ")}
      role="treeitem"
      aria-level={row.level}
      aria-expanded={hasChildren ? !row.collapsed : undefined}
      aria-label={dimmed ? `${label}, does not match the step filter` : label}
      tabIndex={focused ? 0 : -1}
      data-row-key={row.key}
      data-run-id={isRun ? run.id : undefined}
      data-lane={row.lane}
      data-dimmed={dimmed ? "true" : undefined}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,a")) return;
        onOpen(run.id);
      }}
      onFocus={onFocus}
      onKeyDown={(event) => onKeyDown(event, row, index)}
      style={{ height: rowHeight, paddingLeft: rail ? railWidth + 4 : listIndent }}
    >
      <div className="trace-row-body">
        <div className="trace-row-line">
          {hasChildren ? <button
            type="button"
            className="trace-collapse-toggle"
            tabIndex={-1}
            aria-label={row.collapsed ? "Expand subagent span" : "Collapse subagent span"}
            onClick={(event) => { event.stopPropagation(); onToggle(run.id); }}
          >{row.collapsed ? "+" : "−"}</button> : null}
          <span className="trace-step" title={isRun ? step?.step : row.annotation.title}>{isRun ? step?.step : row.annotation.title}</span>
          {!rail && lane ? <span className="trace-agent-inline"><span className="agent-color-dot" style={{ background: `var(${lane.colorToken})` }} />{lane.label}</span> : null}
        </div>
        <div className="trace-row-meta">
          {isRun ? <>
            <span className="trace-row-tool" title={step?.tool ?? run.model ?? ""}>{step?.tool ? `${step.tool}${step.toolExtra}` : run.model || "unknown model"}</span>
            {hint && !row.collapsed ? <span className="trace-row-hint" title={hint}>{hint}</span> : null}
            {row.collapsed ? <span className="trace-row-hint trace-row-hint-summary" title={summary}>{summary}</span> : null}
          </> : <>
            <DecisionStrip decision={row.fact.kind} policy={row.fact.policy} approver={row.fact.approver} />
            {row.annotation.detail ? <span className="trace-row-hint" title={row.annotation.detail}>{row.annotation.detail}</span> : null}
          </>}
        </div>
      </div>
      <div className="trace-row-stats">
        {isRun ? <>
          <span className="trace-stat" title={`Duration ${fmtMs(run.latency_ms)}`}>{fmtMs(run.latency_ms)}</span>
          <span className="trace-stat" title={`Cost ${fmtUsd(run.cost_usd)}`}>{fmtUsd(run.cost_usd)}</span>
          <span className={`trace-status ${isError ? "bad" : "good"}`} title={`Status ${run.status ?? "unknown"}, ${isError ? "failed" : "succeeded"}`}>
            <span aria-hidden="true">{isError ? "✕" : "✓"}</span>
            <span>{isError ? "failed" : "ok"} {run.status ?? ""}</span>
          </span>
        </> : <>
          {row.annotation.riskLevel ? <span className="chip warn" title={`Risk ${row.annotation.riskLevel}`}>{row.annotation.riskLevel}</span> : null}
          <EvidenceChip id={row.fact.requestId} href="/api/v1/ledger/export" label="evidence" />
        </>}
      </div>
    </div>
  );
}

export default function TraceTreeGraph({
  kind,
  traceId,
  tree,
  firstFailingRunId,
  authorization,
  firstTools,
  lastAnswers,
  eventCounts,
  toolNames,
  stepFilter = { agent: "", model: "", tool: "", type: "all", failuresOnly: false },
  onOpenRun,
}: TraceTreeGraphProps) {
  const density = useDensity();
  const narrow = useIsNarrow();
  const rowHeight = density === "compact" ? 28 : 36;
  const [viewMode, setViewMode] = useState<"rail" | "list">(() => localStorage.getItem("torrix_trace_tree_mode") === "list" ? "list" : "rail");
  const collapseKey = `torrix_trace_collapsed:${kind}:${traceId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem(collapseKey) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollFrame = useRef(0);

  const rail = viewMode === "rail" && !narrow;
  const lanes = useMemo(() => assignLanes(tree.flat), [tree]);
  const failureId = useMemo(() => resolveFirstFailure(tree, firstFailingRunId), [tree, firstFailingRunId]);
  const visible = useMemo(() => withLanes(buildVisibleRows(tree, collapsed, authorization, failureId), lanes), [tree, collapsed, authorization, failureId, lanes]);
  const rows = visible.rows;
  const fullRows = useMemo(() => buildVisibleRows(tree, new Set(), authorization, failureId).rows, [tree, authorization, failureId]);
  const filterActive = stepFilterActive(stepFilter);
  const matched = useMemo(() => stepMatches(fullRows, toolNames, stepFilter), [fullRows, toolNames, stepFilter]);
  const dimmedKeys = useMemo(() => {
    if (!filterActive) return new Set<string>();
    const out = new Set<string>();
    for (const row of fullRows) {
      if (!rowMatchesStepFilter(row, toolNames.get(row.run.id), stepFilter)) out.add(row.key);
    }
    return out;
  }, [fullRows, toolNames, stepFilter, filterActive]);
  const railPad = 8;
  const laneGap = 24;
  const railWidth = railPad * 2 + Math.max(1, lanes.lanes.length) * laneGap;
  const hasCollapsed = rows.some((row) => row.kind === "run" && row.collapsed);
  const collapsibleRunIds = useMemo(() => allCollapsible(tree), [tree]);
  const allCollapsed = collapsibleRunIds.length > 0 && collapsibleRunIds.every((runId) => collapsed.has(runId));
  const listHeight = Math.min(Math.max(rows.length * rowHeight, 120), 640);

  useEffect(() => {
    localStorage.setItem("torrix_trace_tree_mode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    try { setCollapsed(new Set(JSON.parse(sessionStorage.getItem(collapseKey) ?? "[]") as string[])); }
    catch { setCollapsed(new Set()); }
  }, [collapseKey]);
  useEffect(() => {
    sessionStorage.setItem(collapseKey, JSON.stringify([...collapsed]));
  }, [collapseKey, collapsed]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight || listHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [listHeight]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const max = Math.max(0, rows.length * rowHeight - element.clientHeight);
    if (element.scrollTop > max) {
      element.scrollTop = max;
      setScrollTop(max);
    }
  }, [rows.length, rowHeight]);
  useEffect(() => {
    if (!pendingFocus) return;
    const index = rows.findIndex((row) => row.key === pendingFocus);
    if (index < 0) { setPendingFocus(null); return; }
    const target = Math.max(0, index * rowHeight - Math.max(0, viewportHeight / 2 - rowHeight / 2));
    const element = scrollRef.current;
    if (element && Math.abs(element.scrollTop - target) > 1) {
      element.scrollTop = target;
      setScrollTop(target);
      return;
    }
    const node = element?.querySelector<HTMLElement>(`.trace-rail-row[data-row-key="${pendingFocus}"]`);
    if (node) {
      setFocusKey(pendingFocus);
      setPendingFocus(null);
      let focusedOnce = false;
      const focusRow = (attempt = 0) => {
        const scroller = scrollRef.current;
        const active = document.activeElement as HTMLElement | null;
        if (focusedOnce && active && active !== document.body && !scroller?.contains(active)) return;
        const target = scroller?.querySelector<HTMLElement>(`.trace-rail-row[data-row-key="${pendingFocus}"]`);
        target?.focus();
        if (target && document.activeElement === target) focusedOnce = true;
        if (attempt < 5) globalThis.setTimeout(() => focusRow(attempt + 1), 80);
      };
      globalThis.setTimeout(() => focusRow(), 50);
    }
  }, [pendingFocus, rows, rowHeight, scrollTop, viewportHeight]);

  const onScroll = () => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      setScrollTop(scrollRef.current?.scrollTop ?? 0);
    });
  };
  useEffect(() => () => { if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current); }, []);

  const window = windowFor(rows.length, scrollTop, viewportHeight, rowHeight, 6);
  const visibleRows = rows.slice(window.start, window.end);

  const moveFocus = (index: number) => {
    const row = rows[index];
    if (row) setPendingFocus(row.key);
  };
  const toggle = (runId: string) => {
    if (!tree.byId.get(runId)?.children.length) return;
    setCollapsed((current) => toggleCollapsed(current, runId));
  };
  const jump = () => {
    if (!failureId) return;
    const ancestors = ancestorsOf(tree, failureId);
    setCollapsed((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestors) next.delete(id);
      return next;
    });
    setPendingFocus(`run:${failureId}`);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, row: TraceRow, index: number) => {
    if (event.target !== event.currentTarget) return;
    const isRun = row.kind === "run";
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (event.key === "Home") moveFocus(0);
      else if (event.key === "End") moveFocus(rows.length - 1);
      else moveFocus(Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenRun(row.run.id);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (isRun && row.node.children.length) {
        if (row.collapsed) toggle(row.run.id);
        else moveFocus(index + 1);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (isRun && row.node.children.length && !row.collapsed) toggle(row.run.id);
      else {
        const parent = row.kind === "decision" ? row.run.id : tree.parents.get(row.run.id);
        if (parent) setPendingFocus(`run:${parent}`);
      }
    }
  };

  const rowIcon = (lane: TraceLane) => (
    <span className="trace-lane-key" aria-hidden="true" title={lane.folded?.join(", ")}>
      <i style={{ background: `var(${lane.colorToken})` }} />
      <span>{lane.label}</span>
    </span>
  );

  const railNodes = rail ? visibleRows.map((row, index) => {
    const y = (index + 0.5) * rowHeight;
    const x = laneX(row.lane, railPad, laneGap);
    const lane = lanes.lanes[row.lane] ?? lanes.lanes[0];
    if (!lane) return null;
    const isRun = row.kind === "run";
    const failed = isRun && (Number(row.run.status) >= 400 || Boolean(row.run.error));
    const isDecision = row.kind === "decision";
    const toolCall = isRun && Boolean(countsFor(eventCounts, row.run.id)?.tools);
    const shape = traceNodeShape(row, toolCall);
    const color = `var(${lane.colorToken})`;
    return (
      <g
        key={`node-${row.key}`}
        className={`trace-rail-node ${isDecision ? "trace-rail-decision" : "trace-rail-run-node"}${dimmedKeys.has(row.key) ? " is-dimmed" : ""}`}
        data-run-id={isRun ? row.run.id : undefined}
        data-lane={row.lane}
        transform={`translate(${x} ${y})`}
        onClick={(event) => {
          event.stopPropagation();
          if (isRun && row.node.children.length) toggle(row.run.id);
        }}
        style={{ pointerEvents: isRun && row.node.children.length ? "auto" : "none", cursor: isRun && row.node.children.length ? "pointer" : "default" }}
      >
        {isDecision ? <rect className="trace-rail-node-shape" x={-4} y={-4} width={8} height={8} transform="rotate(45)" fill="var(--surface)" stroke={`var(${row.fact.colorToken})`} strokeWidth={1.5} /> : <>
          {shape === "tool"
            ? <rect className="trace-rail-node-shape" x={-4.5} y={-4.5} width={9} height={9} rx={1} fill={color} stroke={color} strokeWidth={1.5} />
            : <circle className="trace-rail-node-shape" r={4.5} fill={color} stroke={color} strokeWidth={1.5} />}
          {failed ? (shape === "tool"
            ? <rect className="trace-rail-failure-ring" x={-7.5} y={-7.5} width={15} height={15} rx={3} fill="none" stroke="var(--bad)" strokeWidth={1.5} />
            : <circle className="trace-rail-failure-ring" r={7.5} fill="none" stroke="var(--bad)" strokeWidth={1.5} />) : null}
          {row.node.children.length ? <g className={`trace-rail-spawn ${row.kind === "run" && row.collapsed ? "is-collapsed" : ""}`} transform="translate(11 0)">
            <circle r={5.5} fill="var(--surface)" stroke={color} strokeWidth={1} />
            <text x={0} y={2.8} textAnchor="middle" className="trace-rail-spawn-text" fill={color}>{row.kind === "run" && row.collapsed ? "+" : "−"}</text>
          </g> : null}
        </>}
      </g>
    );
  }) : null;

  return (
    <section id="trace-graph" className="panel mb-4.5 trace-tree-panel" aria-label="Execution graph" tabIndex={-1}>
      <div className="panel-head trace-tree-head">
        <span className="panel-title">Execution graph</span>
        <span className="panel-note">
          {filterActive ? `${matched.matched} of ${matched.total} steps` : `${rows.length} row${rows.length === 1 ? "" : "s"}`} · {lanes.agentOrder.length} agent{lanes.agentOrder.length === 1 ? "" : "s"} · commit-style rail
        </span>
        <div className="trace-tree-actions">
          {failureId ? <Button size="sm" variant="outline" type="button" onClick={jump}>Jump to first failure</Button> : null}
          <Button size="sm" variant="ghost" type="button" onClick={() => setCollapsed(new Set())} disabled={!hasCollapsed}>Expand all</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setCollapsed(new Set(collapsibleRunIds))} disabled={!collapsibleRunIds.length || allCollapsed}>Collapse all</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" type="button">View</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Tree view</DropdownMenuLabel>
              <DropdownMenuCheckboxItem checked={viewMode === "rail"} onCheckedChange={() => setViewMode("rail")}>Graph rail</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={viewMode === "list"} onCheckedChange={() => setViewMode("list")}>Simple list</DropdownMenuCheckboxItem>
              {narrow ? <><DropdownMenuSeparator /><span className="trace-menu-note">The rail becomes indentation below 700px.</span></> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {rail ? <div className="trace-lane-legend" aria-hidden="true">
        <span className="trace-shape-key"><i className="trace-key-shape circle" />model call</span>
        <span className="trace-shape-key"><i className="trace-key-shape square" />tool call</span>
        <span className="trace-shape-key"><i className="trace-key-shape diamond" />decision</span>
        {lanes.lanes.length ? <span className="trace-legend-sep">agents</span> : null}
        {lanes.lanes.map((lane) => <span key={lane.key}>{rowIcon(lane)}</span>)}
      </div> : null}
      {rows.length ? <div
        ref={scrollRef}
        className={`trace-rail-scroll${rail ? " has-rail" : " is-list"}`}
        style={{ height: listHeight }}
        onScroll={onScroll}
        role="tree"
        aria-label={`${kind === "trace" ? "Trace" : "Session"} execution tree`}
        aria-orientation="vertical"
        data-rail-width={rail ? railWidth : 0}
      >
        <div className="trace-rail-canvas" style={{ height: rows.length * rowHeight }}>
          {rail ? <div className="trace-rail-svg-layer" style={{ top: window.offset, height: window.height }}>
            <svg className="trace-rail-svg" width={railWidth} height={Math.max(1, window.height)} viewBox={`0 0 ${railWidth} ${Math.max(1, window.height)}`} aria-hidden="true">
              {lanes.lanes.map((lane, index) => <line key={`lane-${lane.key}`} className="trace-rail-lane-line" x1={laneX(index, railPad, laneGap)} x2={laneX(index, railPad, laneGap)} y1={0} y2={window.height} stroke={`var(${lane.colorToken})`} strokeOpacity={0.7} strokeWidth={1} />)}
              {visibleRows.flatMap((row, index) => {
                if (row.kind !== "run" || !row.run.parent_run_id) return [];
                const parentIndex = rows.findIndex((candidate) => candidate.kind === "run" && candidate.run.id === row.run.parent_run_id);
                if (parentIndex < window.start || parentIndex >= window.end) return [];
                const parent = rows[parentIndex];
                if (parent?.kind !== "run" || parent.lane === row.lane) return [];
                const y0 = (parentIndex - window.start + 0.5) * rowHeight;
                const y1 = (index + 0.5) * rowHeight;
                const x0 = laneX(parent.lane, railPad, laneGap);
                const x1 = laneX(row.lane, railPad, laneGap);
                const color = `var(${lanes.lanes[parent.lane]?.colorToken ?? "--text-3"})`;
                if (dimmedKeys.has(row.key) || dimmedKeys.has(parent.key)) return [];
                return <path key={`spawn-${row.key}`} className="trace-rail-edge" d={`M ${x0} ${y0 + 6} C ${x0} ${y0 + (y1 - y0) * 0.45}, ${x1} ${y1 - (y1 - y0) * 0.45}, ${x1} ${y1 - 6}`} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={1.5} />;
              })}
              {visibleRows.flatMap((row) => {
                if (row.kind !== "run" || !row.node.children.length) return [];
                return row.node.children.flatMap((child) => {
                  const end = visible.spanEndById.get(child.run.id);
                  if (end == null || end < window.start || end >= window.end) return [];
                  const childRow = rows.find((candidate) => candidate.kind === "run" && candidate.run.id === child.run.id);
                  if (!childRow || childRow.lane === row.lane) return [];
                  const y = (end - window.start + 1) * rowHeight - 1;
                  const x0 = laneX(childRow.lane, railPad, laneGap);
                  const x1 = laneX(row.lane, railPad, laneGap);
                  const color = `var(${lanes.lanes[childRow.lane]?.colorToken ?? "--text-3"})`;
                  if (dimmedKeys.has(row.key) || dimmedKeys.has(childRow.key)) return [];
                  return <path key={`return-${row.key}-${child.run.id}`} className="trace-rail-edge trace-rail-return" d={`M ${x0} ${y - 8} C ${x0} ${y}, ${x1} ${y}, ${x1} ${y}`} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={1.5} />;
                });
              })}
              {railNodes}
            </svg>
          </div> : null}
          <div className="trace-rail-window" style={{ top: window.offset }}>
            {visibleRows.map((row, index) => {
              const absoluteIndex = window.start + index;
              return <Row
                key={row.key}
                row={row}
                index={absoluteIndex}
                focused={focusKey ? focusKey === row.key : absoluteIndex === window.start}
                dimmed={dimmedKeys.has(row.key)}
                rail={rail}
                railWidth={railWidth}
                rowHeight={rowHeight}
                lane={lanes.lanes[row.lane]}
                firstTool={row.kind === "run" ? firstTools.get(row.run.id) : undefined}
                counts={row.kind === "run" ? eventCounts.get(row.run.id) : undefined}
                lastAnswer={row.kind === "run" ? lastAnswers.get(row.run.id) : undefined}
                onToggle={toggle}
                onOpen={onOpenRun}
                onFocus={() => setFocusKey(row.key)}
                onKeyDown={onKeyDown}
              />;
            })}
          </div>
        </div>
      </div> : <div className="empty-value" style={{ padding: "18px 0" }}><p>No runs in this view.</p><span className="field-hint">Open Runs to send a call through Torrix.</span></div>}
      <div className="trace-tree-foot">
        <span>{rail ? "Lanes are agents. Collapse a spawn node to fold its branch." : "Simple list, indented by depth."}</span>
        <span>{lanes.folded.length ? `+${lanes.folded.length} agents folded into the last lane.` : ""}</span>
      </div>
    </section>
  );
}

function countsFor(map: Map<string, TraceEventCount>, id: string): TraceEventCount | undefined {
  return map.get(id);
}
