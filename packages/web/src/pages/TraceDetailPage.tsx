import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { CustomChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api,
  compact,
  fmtMs,
  fmtUsd,
  relTime,
  userPrompt,
  type GroupRunsResponse,
  type Run,
  type RunEvent,
} from "../api";
import { formatCount, formatPercent } from "../api";
import { ClampedText, InlineSelect, Panel } from "../components";
import { axisBase, baseOption, gridBase, tooltipBase } from "../charts";
import { useFeature } from "../features";
import { cssVar, useTheme } from "../theme";
import { lastAnswer } from "../lib/conversation";
import { agentColorToken, buildTraceTree, buildVisibleRows, traceAgent } from "../lib/traceGraph";
import { EMPTY_STEP_FILTER, runMatchesStepFilter, stepFilterActive, stepMatches, type TraceStepFilter } from "../lib/traceFilter";
import TraceTreeGraph from "./TraceTreeGraph";

echarts.use([CustomChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

interface TraceDetailPageProps {
  kind: "trace" | "session";
}

interface GroupInsightsData {
  analysis?: string;
  highlights?: string[];
  costDrivers?: string[];
  errorDrivers?: string[];
  suggestions?: string[];
  cached?: boolean;
}

export default function TraceDetailPage({ kind }: TraceDetailPageProps) {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<"tree" | "waterfall">(() => localStorage.getItem("torrix_trace_view") === "flow" ? "waterfall" : "tree");
  const [flowReady, setFlowReady] = useState(false);
  const [stepFilter, setStepFilter] = useState<TraceStepFilter>(EMPTY_STEP_FILTER);
  // A different trace must not inherit the previous one's step filter; the
  // filter survives Tree | Flow because the tab is local to this trace.
  useEffect(() => { setStepFilter(EMPTY_STEP_FILTER); }, [kind, id]);
  useEffect(() => {
    localStorage.setItem("torrix_trace_view", activeTab === "waterfall" ? "flow" : "tree");
  }, [activeTab]);
  const queryClient = useQueryClient();
  const judgeFeature = useFeature("judge");
  const [judgeError, setJudgeError] = useState("");
  const judgeTrace = useMutation({
    mutationFn: () => api<{ judgment: { score: number | null; error: string | null } }>(`/api/runs/group/trace/${encodeURIComponent(id)}/judge`, { method: "POST", body: JSON.stringify({ apply: true }) }),
    onSuccess: (data) => {
      setJudgeError(data.judgment.error ?? "");
      void queryClient.invalidateQueries({ queryKey: ["group-runs", kind, id] });
      void queryClient.invalidateQueries({ queryKey: ["group-total", kind, id] });
    },
    onError: (error: Error) => setJudgeError(error.message),
  });
  const judgeSession = useMutation({
    mutationFn: () => api<{ queued: number; skipped: number }>("/api/runs/bulk", { method: "POST", body: JSON.stringify({ action: "judge", session_ids: [id] }) }),
    onSuccess: (data) => {
      setJudgeError(`Queued ${data.queued} trace${data.queued === 1 ? "" : "s"}${data.skipped ? `, skipped ${data.skipped}` : ""}. Refresh after the job finishes.`);
      void queryClient.invalidateQueries({ queryKey: ["group-runs", kind, id] });
    },
    onError: (error: Error) => setJudgeError(error.message),
  });

  // A trace rail virtualises 1,000 runs on one page; sessions keep the 200-run
  // page so a long conversation opens on its latest turns.
  const PAGE_SIZE = kind === "trace" ? 1000 : 200;
  const [page, setPage] = useState<number | null>(null);
  const totalQuery = useQuery({
    queryKey: ["group-total", kind, id],
    queryFn: () => api<{ total: number }>(`/api/runs/group/${kind}/${encodeURIComponent(id)}?limit=1&descendants=0`),
  });
  const totalRuns = totalQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRuns / PAGE_SIZE));
  const currentPage = page ?? (kind === "session" ? pageCount : 1);
  const groupQuery = useQuery({
    queryKey: ["group-runs", kind, id, currentPage],
    queryFn: () =>
      api<GroupRunsResponse>(
        `/api/runs/group/${kind}/${encodeURIComponent(id)}?limit=${PAGE_SIZE}&offset=${(currentPage - 1) * PAGE_SIZE}${kind === "trace" ? "&include=authorization" : ""}`,
      ),
  });

  const insightsQuery = useQuery<GroupInsightsData>({
    queryKey: ["group-insights", kind, id],
    queryFn: () =>
      api<GroupInsightsData>(`/api/runs/group/${kind}/${encodeURIComponent(id)}/insights`).catch(() => ({})),
    enabled: Boolean(id),
  });

  const analyzeMutation = useMutation({
    mutationFn: () =>
      api<GroupInsightsData>(`/api/runs/group/${kind}/${encodeURIComponent(id)}/insights`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["group-insights", kind, id], data);
    },
  });

  const runs = groupQuery.data?.runs ?? [];
  useEffect(() => {
    if (activeTab !== "waterfall" || !runs.length) {
      setFlowReady(false);
      return;
    }
    const timer = window.setTimeout(() => setFlowReady(true), 0);
    return () => { window.clearTimeout(timer); setFlowReady(false); };
  }, [activeTab, runs.length]);
  const totals = groupQuery.data?.totals;
  const traceScore = groupQuery.data?.trace_score ?? null;
  const traceScoreReason = groupQuery.data?.trace_score_reason ?? null;
  const firstFailingRunId = groupQuery.data?.first_failing_run_id ?? null;
  const authorization = groupQuery.data?.authorization ?? [];
  const sessionScore = groupQuery.data?.session_score ?? null;
  const sessionJudged = groupQuery.data?.session_judged ?? 0;
  const firstToolMap = useMemo(() => new Map((groupQuery.data?.firstTools ?? []).map((entry) => [entry.runId, entry.message])), [groupQuery.data?.firstTools]);
  const toolNamesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of groupQuery.data?.toolNames ?? []) {
      map.set(entry.runId, [...(map.get(entry.runId) ?? []), entry.name]);
    }
    return map;
  }, [groupQuery.data?.toolNames]);
  const lastAnswerMap = new Map((groupQuery.data?.lastAnswers ?? []).map((entry) => [entry.runId, entry.message]));
  const eventMap = new Map<string, { tools: number; think: boolean; response: boolean }>();
  for (const count of groupQuery.data?.eventCounts ?? []) {
    const entry = eventMap.get(count.runId) ?? { tools: 0, think: false, response: false };
    if (count.type === "tool_call") entry.tools += count.count;
    if (count.type === "thinking") entry.think = true;
    if (count.type === "response") entry.response = true;
    eventMap.set(count.runId, entry);
  }
  const orderedRuns = [...runs].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
  const answerRun = [...orderedRuns].reverse().find((run) => eventMap.get(run.id)?.response) ?? orderedRuns[orderedRuns.length - 1];
  const answerQuery = useQuery({
    queryKey: ["run-events", answerRun?.id],
    queryFn: () => api<{ events: RunEvent[] }>(`/api/runs/${encodeURIComponent(answerRun?.id ?? "")}/events`),
    enabled: kind === "trace" && Boolean(answerRun?.id),
  });
  const answer = lastAnswer(answerQuery.data?.events ?? []) ?? "No text answer captured.";

  const tree = useMemo(() => buildTraceTree(runs), [runs]);
  const fullRows = useMemo(() => buildVisibleRows(tree, new Set(), authorization, firstFailingRunId).rows, [tree, authorization, firstFailingRunId]);
  const stepTotal = fullRows.length;
  const stepMatched = useMemo(() => stepMatches(fullRows, toolNamesMap, stepFilter).matched, [fullRows, toolNamesMap, stepFilter]);
  const stepAgents = useMemo(() => Array.from(new Set(tree.flat.map((node) => traceAgent(node.run)))).sort(), [tree]);
  const stepModels = useMemo(() => Array.from(new Set(tree.flat.map((node) => node.run.model).filter((model): model is string => Boolean(model)))).sort(), [tree]);
  const stepTools = useMemo(() => Array.from(new Set([
    ...[...toolNamesMap.values()].flat(),
    ...authorization.map((annotation) => annotation.meta?.tool_name ?? ""),
  ].filter(Boolean))).sort(), [toolNamesMap, authorization]);
  const totalDuration = useMemo(() => {
    if (!tree.flat.length) return 0;
    let earliest = Infinity;
    let latest = -Infinity;
    for (const node of tree.flat) {
      const start = Date.parse(node.run.created_at) || 0;
      earliest = Math.min(earliest, start);
      latest = Math.max(latest, start + (node.run.latency_ms ?? 0));
    }
    return Math.max(1, latest - earliest);
  }, [tree]);

  const flow = useMemo(() => {
    if (!runs.length) return null;
    const laneOf = (run: Run) => traceAgent(run);
    const lanes = [...new Set(tree.flat.map((node) => laneOf(node.run)))];
    const laneColors = lanes.map((agent) => cssVar(agentColorToken(agent)));
    const positioned = new Map<string, { lane: number; start: number; end: number }>();
    const filtering = stepFilterActive(stepFilter);
    const matchedIds = new Set<string>();
    const data = runs.map((run) => {
      const start = Date.parse(run.created_at) || 0;
      const latency = Math.max(1, run.latency_ms ?? 0);
      const lane = lanes.indexOf(laneOf(run));
      positioned.set(run.id, { lane, start, end: start + latency });
      const match = runMatchesStepFilter(run, toolNamesMap.get(run.id), stepFilter);
      if (match) matchedIds.add(run.id);
      return { value: [lane, start, start + latency], itemStyle: { color: laneColors[lane], opacity: filtering && !match ? 0.18 : 1 }, run };
    });
    const edges = runs.flatMap((run) => {
      if (!run.parent_run_id) return [];
      const parent = positioned.get(run.parent_run_id);
      const child = positioned.get(run.id);
      const dim = filtering && (!matchedIds.has(run.id) || !matchedIds.has(run.parent_run_id));
      return parent && child ? [{ value: [parent.lane, parent.end, child.lane, child.start], dim }] : [];
    });
    return { lanes, laneColors, data, edges, filtering, height: Math.max(160, lanes.length * 34 + 44) };
  }, [runs, tree, theme, stepFilter, toolNamesMap]);

  const flowOption = useMemo(() => {
    if (!flow) return {};
    return {
      ...baseOption(),
      tooltip: {
        ...tooltipBase("item"),
        formatter: (params: { data: { run: Run } }) => {
          const run = params.data.run;
          return `${run.name || run.id.slice(0, 8)}<br/>agent ${run.agent_name || "-"} · ${run.model || "-"}<br/>${fmtMs(run.latency_ms)} · ${fmtUsd(run.cost_usd)}`;
        },
      },
      grid: gridBase({ left: 8, right: 24, top: 10, bottom: 24 }),
      xAxis: { type: "time", ...axisBase() },
      yAxis: { type: "category", data: flow.lanes, ...axisBase() },
      series: [{
        type: "custom",
        silent: true,
        encode: { x: [1, 3], y: [0, 2] },
        data: flow.edges,
        renderItem: (params: { data: { dim: boolean } }, api: { value: (index: number) => number; coord: (pair: [number, number]) => [number, number] }) => {
          const parent = api.coord([api.value(1), api.value(0)]);
          const child = api.coord([api.value(3), api.value(2)]);
          const midX = (parent[0] + child[0]) / 2;
          return {
            type: "polyline",
            shape: { points: [parent, [midX, parent[1]], [midX, child[1]], child] },
            style: { stroke: cssVar("--line-2"), lineWidth: 1, fill: "none", lineJoin: "round", opacity: params.data.dim ? 0.18 : 1 },
          };
        },
      }, {
        type: "custom",
        encode: { x: [1, 2], y: 0 },
        renderItem: (_params: unknown, api: { value: (index: number) => number; coord: (pair: [number, number]) => [number, number]; size: (pair: [number, number]) => [number, number]; style: () => object }) => {
          const lane = api.value(0);
          const start = api.coord([api.value(1), lane]);
          const end = api.coord([api.value(2), lane]);
          const height = Math.max(8, api.size([0, 1])[1] * 0.5);
          return { type: "rect", shape: { x: start[0], y: start[1] - height / 2, width: Math.max(10, end[0] - start[0]), height, r: 2 }, style: api.style() };
        },
        data: flow.data,
      }],
    };
  }, [flow, theme]);

  if (groupQuery.isPending) {
    return <div className="startup loading-page"><span>Loading execution graph…</span></div>;
  }
  if (groupQuery.isError) {
    return <div className="startup"><span>Could not load {kind}: {groupQuery.error.message}</span></div>;
  }

  const groupDuration = totals?.firstAt && totals.lastAt
    ? Math.max(0, Date.parse(totals.lastAt) + Math.max(0, totals.maxLatencyMs) - Date.parse(totals.firstAt))
    : totalDuration;
  const groupRunTotal = Math.max(totals?.runs ?? totalQuery.data?.total ?? runs.length, runs.length);
  const totalCost = totals?.cost ?? runs.reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);
  const totalTokens = totals?.tokens ?? runs.reduce(
    (acc, r) => acc + (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
    0,
  );
  const totalErrors = totals?.errors ?? runs.filter((r) => Number(r.status) >= 400 || Boolean(r.error)).length;
  const subagentCount = totals?.subagents ?? runs.filter((r) => Boolean(r.parent_run_id)).length;
  const firstPrompt = orderedRuns.map((run) => userPrompt(run.request_body)).find((text) => Boolean(text?.trim())) ?? orderedRuns[0]?.name ?? "No prompt captured";

  const insights = insightsQuery.data;

  // One row per user turn (trace) in the loaded page of a session.
  const turns = (() => {
    if (kind !== "session") return [];
    const grouped = new Map<string, Run[]>();
    for (const run of runs) {
      const key = run.trace_id ?? run.id;
      grouped.set(key, [...(grouped.get(key) ?? []), run]);
    }
    if (grouped.size < 2) return [];
    return [...grouped.entries()]
      .map(([traceId, list]) => {
        const ordered = [...list].sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
        const start = Date.parse(ordered[0].created_at) || 0;
        const end = Math.max(...list.map((run) => (Date.parse(run.created_at) || 0) + (run.latency_ms ?? 0)));
        return {
          traceId,
          start,
          started: ordered[0].created_at,
          prompt: ordered.map((run) => userPrompt(run.request_body)).find((text) => Boolean(text?.trim())) ?? ordered[0].name ?? "untitled",
          calls: list.length,
          span: Math.max(0, end - start),
          cost: list.reduce((sum, run) => sum + (Number(run.cost_usd) || 0), 0),
          errors: list.filter((run) => Number(run.status) >= 400 || Boolean(run.error)).length,
        };
      })
      .sort((a, b) => a.start - b.start);
  })();

  return (
    <>
      {activeTab === "tree" ? <a className="trace-skip-link" href="#trace-graph">Skip to execution graph</a> : null}
      <div className="mb-3">
        <Link to="/ui/traces" className={buttonVariants({ variant: "outline" })} style={{ padding: "4px 8px", fontSize: 12 }}>
          ← All traces
        </Link>
      </div>

      <div className="page-head">
        <div>
          <span className="eyebrow" style={{ fontSize: 11, letterSpacing: 0, color: "var(--text-3)", fontWeight: 600 }}>
            {kind === "trace" ? "Trace execution" : "Session thread"}
          </span>
          <h1 style={{ wordBreak: "break-all", fontSize: 22, marginTop: 2 }}>{id} {kind === "trace" && traceScore != null ? <span className={`badge ${traceScore === 1 ? "good" : "bad"}`} title={traceScoreReason ?? ""}>{traceScore === 1 ? "Good" : "Bad"}</span> : null}{kind === "session" && sessionJudged ? <span className="badge neutral" title={`${sessionJudged} traces judged`}>{Math.round(((sessionScore ?? 0) * 100))}% good</span> : null}</h1>
          <p className="page-sub">
            {groupRunTotal} {groupRunTotal === 1 ? "run" : "runs"} captured · {fmtMs(groupDuration)} total span
            {runs.length !== groupRunTotal ? ` · this page: ${runs.length} of ${groupRunTotal}` : ""}
            {kind === "trace" && firstFailingRunId ? <> · <Link className="quiet-link" to={`/ui/runs/${encodeURIComponent(firstFailingRunId)}`}>first failing step</Link></> : null}
            {kind === "trace" && traceScoreReason ? <> · {traceScoreReason}</> : null}
          </p>
        </div>
        <div className="head-actions">
          <ToggleGroup type="single" value={activeTab} onValueChange={(value) => { if (value) setActiveTab(value as "tree" | "waterfall"); }}>
            <ToggleGroupItem value="tree">Tree view</ToggleGroupItem>
            <ToggleGroupItem value="waterfall">Flow</ToggleGroupItem>
          </ToggleGroup>
          {kind === "trace" && judgeFeature.ready && judgeFeature.allowed ? <Button variant="outline" type="button" disabled={judgeTrace.isPending} onClick={() => judgeTrace.mutate()}>{judgeTrace.isPending ? "Judging." : "Judge this trace"}</Button> : null}
          {kind === "session" && judgeFeature.ready && judgeFeature.allowed ? <Button variant="outline" type="button" disabled={judgeSession.isPending} onClick={() => judgeSession.mutate()}>{judgeSession.isPending ? "Queueing." : "Judge each turn"}</Button> : null}
          <Button variant="outline" type="button" onClick={() => void groupQuery.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      {judgeError ? <p className="field-error">{judgeError}</p> : null}
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="st-label">Total runs</span>
          <div className="st-value">{groupRunTotal}</div>
          <div className="st-sub">{subagentCount} subagents spawned{runs.length !== groupRunTotal ? ` · this page: ${runs.length}` : ""}</div>
        </div>
        <div className="stat-tile">
          <span className="st-label">Total cost</span>
          <div className="st-value">{fmtUsd(totalCost)}</div>
          <div className="st-sub">across full graph</div>
        </div>
        <div className="stat-tile">
          <span className="st-label">Tokens</span>
          <div className="st-value">{compact(totalTokens)}</div>
          <div className="st-sub">prompt + completion</div>
        </div>
        <div className={`stat-tile${totalErrors > 0 ? " tone-bad" : " tone-good"}`}>
          <span className="st-label">Errors</span>
          <div className="st-value">{totalErrors}</div>
          <div className="st-sub">{groupRunTotal > 0 ? formatPercent((totalErrors / groupRunTotal) * 100, 0) : "0%"} error rate</div>
        </div>
      </div>

      {pageCount > 1 ? (
        <div className="group-pager mb-3 flex flex-wrap items-center gap-2">
          <span className="panel-note">
            Showing runs {formatCount((currentPage - 1) * PAGE_SIZE + 1)} to {formatCount(Math.min(currentPage * PAGE_SIZE, totalRuns))} of {formatCount(totalRuns)}
          </span>
          {currentPage > 1 ? <Button variant="outline" type="button" onClick={() => setPage(currentPage - 1)}>Earlier</Button> : null}
          {currentPage < pageCount ? <Button variant="outline" type="button" onClick={() => setPage(currentPage + 1)}>Later</Button> : null}
          {currentPage < pageCount ? <Button variant="outline" type="button" onClick={() => setPage(pageCount)}>Latest</Button> : null}
        </div>
      ) : null}

      {kind === "trace" ? <Panel title="Turn summary" note="prompt and readable answer">
        <div className="turn-grid" data-test="turn-summary">
          <div><span className="meta-label">Prompt</span><ClampedText text={firstPrompt} quote testId="turn-prompt" /></div>
          <div><span className="meta-label">Answer</span>{answer === "No text answer captured." ? <div className="empty-value" data-test="turn-answer"><p>No text answer captured.</p><span className="field-hint">Open the final run to inspect its events.</span></div> : <ClampedText text={answer} testId="turn-answer" />}</div>
        </div>
      </Panel> : null}

      {turns.length ? (
        <Panel flush title="Turns" note="one row per user turn (trace) in this session">
          <div className="table-wrap"><table>
            <thead><tr><th>Started</th><th>Turn</th><th className="num">Calls</th><th className="num">Duration</th><th className="num">Cost</th><th className="num">Errors</th></tr></thead>
            <tbody>
              {turns.map((turn) => <tr key={turn.traceId} className="clickable">
                <td className="tnum" style={{ color: "var(--text-3)", fontSize: 12 }}>{relTime(turn.started)}</td>
                <td><Link to={`/ui/traces/${encodeURIComponent(turn.traceId)}`}>{turn.prompt.length > 90 ? `${turn.prompt.slice(0, 90)}…` : turn.prompt}</Link></td>
                <td className="num">{turn.calls}</td>
                <td className="num">{fmtMs(turn.span)}</td>
                <td className="num">{fmtUsd(turn.cost)}</td>
                <td className="num">{turn.errors ? <span className="badge bad"><span className="dot" />{turn.errors}</span> : "0"}</td>
              </tr>)}
            </tbody>
          </table></div>
        </Panel>
      ) : null}

      {tree.flat.length ? <div className="trace-step-filter mb-3">
        <span className="filter-cap">Filter steps</span>
        <InlineSelect className="filter-select" aria-label="Step agent filter" value={stepFilter.agent} onValueChange={(agent) => setStepFilter((current) => ({ ...current, agent }))} options={[{ value: "", label: "All agents" }, ...stepAgents.map((agent) => ({ value: agent, label: agent }))]} />
        <InlineSelect className="filter-select" aria-label="Step model filter" value={stepFilter.model} onValueChange={(model) => setStepFilter((current) => ({ ...current, model }))} options={[{ value: "", label: "All models" }, ...stepModels.map((model) => ({ value: model, label: model }))]} />
        <InlineSelect className="filter-select" aria-label="Step tool filter" value={stepFilter.tool} onValueChange={(tool) => setStepFilter((current) => ({ ...current, tool }))} options={[{ value: "", label: "Any tool" }, ...stepTools.map((tool) => ({ value: tool, label: tool }))]} />
        <InlineSelect className="filter-select" aria-label="Step kind filter" value={stepFilter.type} onValueChange={(type) => setStepFilter((current) => ({ ...current, type: type as TraceStepFilter["type"] }))} options={[{ value: "all", label: "Any step" }, { value: "model", label: "Model calls" }, { value: "tool", label: "Tool calls" }, { value: "decision", label: "Decisions" }]} />
        <label className="filter-check">
          <Checkbox checked={stepFilter.failuresOnly} onCheckedChange={(value) => setStepFilter((current) => ({ ...current, failuresOnly: value === true }))} />
          <span>Failures only</span>
        </label>
        <span className="panel-note">{stepMatched} of {stepTotal} steps</span>
        {stepFilterActive(stepFilter) ? <Button size="sm" variant="ghost" type="button" onClick={() => setStepFilter(EMPTY_STEP_FILTER)}>Clear filter</Button> : null}
      </div> : null}

      {activeTab === "tree" ? (
        <TraceTreeGraph
          kind={kind}
          traceId={id}
          tree={tree}
          firstFailingRunId={firstFailingRunId}
          stepFilter={stepFilter}
          toolNames={toolNamesMap}
          authorization={authorization}
          firstTools={firstToolMap}
          lastAnswers={lastAnswerMap}
          eventCounts={eventMap}
          onOpenRun={(runId) => navigate(`/ui/runs/${encodeURIComponent(runId)}`)}
        />
      ) : (
        <div className="panel mb-4.5 record-surface">
          <div className="panel-head">
            <span className="panel-title">Flow timeline</span>
            <span className="panel-note">{flow ? `${flow.lanes.length} agent ${flow.lanes.length === 1 ? "lane" : "lanes"} · click a bar to open the run` : "time offsets and run duration"}</span>
            <span className="fig-caption"><b>Fig. 02</b> · evidence timeline</span>
          </div>
          <div className="panel-body">
            {flow && flowReady ? <div className="flow-chart" data-test="flow-chart" data-lane-colors={flow.laneColors.join(",")}>
              <ReactEChartsCore
                key={`flow-${runs.length}-${theme}`}
                echarts={echarts}
                option={flowOption}
                style={{ height: flow.height }}
                notMerge
                onEvents={{ click: (params: { data?: { run?: Run } }) => { const run = params?.data?.run; if (run) navigate(`/ui/runs/${encodeURIComponent(run.id)}`); } }}
              />
            </div> : flow ? <div className="skeleton flow-skeleton" aria-hidden="true" /> : <span className="panel-note">No runs in this view. Open Runs to send a call through Torrix.</span>}
          </div>
        </div>
      )}

      <div className="panel mb-4.5">
        <div className="panel-head">
          <span className="panel-title"><span className="sig" />AI Judge Analysis</span>
          <Button
            
            type="button"
            disabled={analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
          >
            {analyzeMutation.isPending ? "Analyzing with Judge…" : "Analyze with AI"}
          </Button>
        </div>
        <div className="panel-body" style={{ padding: "16px 18px" }}>
          {insights?.analysis ? (
            <div style={{ display: "grid", gap: 12, fontSize: 13, lineHeight: 1.6, color: "var(--text)" }}>
              <p className="m-0">{insights.analysis}</p>
              {insights.highlights && insights.highlights.length > 0 ? (
                <div>
                  <b style={{ color: "var(--heading)" }}>Key highlights:</b>
                  <ul className="mt-1.5 mr-0 mb-0 ml-4">
                    {insights.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {insights.suggestions && insights.suggestions.length > 0 ? (
                <div>
                  <b style={{ color: "var(--heading)" }}>Suggestions:</b>
                  <ul className="mt-1.5 mr-0 mb-0 ml-4">
                    {insights.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="m-0" style={{ color: "var(--text)", fontSize: 13.5, lineHeight: 1.6 }}>
              Ask the configured judge model to evaluate this {kind}: execution flow, subagent orchestration, cost drivers, errors and latency bottlenecks.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
