import { Button, buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQuery } from "@tanstack/react-query";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createParser } from "eventsource-parser";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkline } from "../components";
import { api, compact, deltaArrow, deltaTone, fmtMs, fmtUsd, formatCount, formatDate, formatDateTime, formatPercent, type Coverage, type Dashboard, type Run } from "../api";
import { axisBase, baseOption, barSeries, donutSeries, gridBase, legendBase, lineSeries, seriesColors, splitLine, tooltipBase } from "../charts";
import { useFeature } from "../features";
import { cssVar, useTheme } from "../theme";
import { dayToIso } from "../lib/runFilters";

echarts.use([LineChart, BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, GraphicComponent, CanvasRenderer]);

const RANGES = [7, 14, 30];

/** How much of the observed agent traffic has a registered identity and policy behind it. */
function CoveragePanel() {
  const control = useFeature("agent-control");
  const query = useQuery({ queryKey: ["coverage"], queryFn: () => api<{ coverage: Coverage }>("/api/v1/coverage") });
  const coverage = query.data?.coverage;
  const observed = coverage?.observed ?? 0;
  const rawPercent = coverage?.coverage_percent ?? 0;
  const percent = Number.isFinite(rawPercent) ? Math.min(100, Math.max(0, rawPercent)) : 0;
  // Whole numbers read cleaner for a small fleet: 0%, 50%, 100%. Keep a
  // decimal only when the window actually produces one.
  const percentLabel = formatPercent(percent, Number.isInteger(percent) ? 0 : 1);

  return <section className="panel mb-4 coverage-panel">
    <div className="panel-head">
      <div className="panel-title"><span className="sig" />Governed coverage</div>
      <span className="panel-note">{control.allowed ? "registered agents over observed agents" : <><span className="chip">Pro</span> registry</>}</span>
    </div>
    <div className="panel-body">
      {query.isPending || !control.ready ? <span className="panel-note">Loading...</span> : coverage ? control.allowed ? (<>
        {observed === 0 ? <div className="empty" style={{ padding: "6px 0 2px" }}>
          <span className="empty-title">No agent-attributed runs</span>
          <span className="empty-sub">Runs appear here when they carry an agent name. <Link to="/ui/integrations">Connect an SDK or proxy</Link> to start attributing traffic.</span>
        </div> : <>
          <div className="coverage-summary">
            <span className="coverage-num">{percentLabel}</span>
            <span className="panel-note">{coverage.covered} of {observed} observed agent{observed === 1 ? " matches" : "s match"} a registered agent</span>
          </div>
          {percent > 0 ? <div className="coverage-track" role="progressbar" aria-label="Governed coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div style={{ width: `${percent}%` }} />
          </div> : <p className="coverage-zero">
            None of the observed traffic is governed yet. <Link className="coverage-link" to="/ui/agents">Register an agent</Link> to start measuring coverage.
          </p>}
          {coverage.uncovered.length ? <div className="table-wrap"><table>
            <thead><tr><th>Uncovered agent</th><th className="num">Runs</th><th className="num">Cost</th><th>Last seen</th></tr></thead>
            <tbody>{coverage.uncovered.slice(0, 6).map((agent) => <tr key={agent.name}>
              <td><Link className="tcell-primary" to={`/ui/runs?agent=${encodeURIComponent(agent.name)}`}>{agent.name}</Link></td>
              <td className="num">{compact(agent.runs)}</td>
              <td className="num">{fmtUsd(agent.cost)}</td>
              <td className="tnum">{formatDate(agent.lastSeen)}</td>
            </tr>)}</tbody>
          </table></div> : <span className="panel-note">Every observed agent matches a registered agent.</span>}
          {coverage.registered_without_traffic.length ? <p className="panel-note" style={{ marginTop: 10 }}>{coverage.registered_without_traffic.length} registered agent{coverage.registered_without_traffic.length === 1 ? " has" : "s have"} no traffic in this window.</p> : null}
        </>}
      </>) : (<>
        <div className="coverage-summary">
          <span className="coverage-num">{observed}</span>
          <span className="panel-note">observed agent{observed === 1 ? "" : "s"} in this window</span>
        </div>
        <p className="panel-note coverage-explain">Torrix records and attributes every run for free. Coverage is measured only when agents are registered, so Community does not show a percentage that cannot change.</p>
        <div className="coverage-actions">
          <Link className={buttonVariants({ variant: "outline" })} to="/ui/agents/observed">View observed agents</Link>
          <Link className="coverage-link" to="/ui/locked/agent-control">See what Pro adds</Link>
        </div>
      </>) : null}
    </div>
  </section>;
}

export default function DashboardPage() {
  const theme = useTheme();
  const judgeAllowed = useFeature("judge").allowed;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [comparePrevious, setComparePrevious] = useState(true);
  const range = RANGES.includes(Number(params.get("range"))) ? Number(params.get("range")) : 14;
  const project = params.get("project") ?? "";
  const query = useQuery({
    queryKey: ["dashboard", range, project],
    queryFn: () => {
      const to = new Date();
      const from = new Date(Date.now() - (range - 1) * 86_400_000);
      const search = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (project) search.set("project", project);
      return api<Dashboard>(`/api/dashboard?${search}`);
    },
  });

  const stats = query.data;
  // Bars read best for a short, discrete window; a 30-day view is a trend, so
  // the same series becomes a line/area with clickable points.
  const dailyBars = range <= 14;
  const dayLabel = (date: string) => formatDate(date).replace(/ \d{4}$/, "");
  const openDay = (index: number) => {
    const day = stats?.perDay[index]?.date;
    if (!day) return;
    const search = new URLSearchParams({ from: dayToIso(day), to: dayToIso(day, true) });
    if (project) search.set("project", project);
    navigate(`/ui/runs?${search}`);
  };
  const tooltipRows = (params: unknown, formatFor: (name: string) => (value: number) => string) => {
    const list = (Array.isArray(params) ? params : [params]) as Array<{ marker?: string; seriesName?: string; axisValueLabel?: string; value?: unknown }>;
    if (!list.length) return "";
    const title = String(list[0]?.axisValueLabel ?? "");
    const rows = list.map((item) => `${item.marker ?? ""} ${item.seriesName ?? "Value"}: ${formatFor(String(item.seriesName ?? ""))(Number(item.value))}`);
    return [title, ...rows].join("<br/>");
  };
  const chart = useMemo(() => {
    if (!stats) return {};
    const cost = cssVar("--hero-series");
    const previous = cssVar("--text-3");
    const labels = stats.perDay.map((day) => dayLabel(day.date));
    const showPrevious = comparePrevious && (stats.perDayPrevious?.length ?? 0) === stats.perDay.length;
    return {
      ...baseOption(),
      color: [cost, previous],
      grid: gridBase({ top: 44, right: 12 }),
      tooltip: { ...tooltipBase("axis"), formatter: (params: unknown) => tooltipRows(params, () => fmtUsd) },
      legend: legendBase(),
      xAxis: { type: "category", data: labels, ...axisBase() },
      yAxis: { type: "value", name: "USD", nameGap: 14, nameTextStyle: { color: cssVar("--text-3"), fontSize: 11, fontFamily: "Geist" }, splitLine: splitLine(), axisLabel: { color: cssVar("--text-3"), fontSize: 11, formatter: (value: number) => `$${value}` } },
      series: [
        dailyBars
          ? barSeries("Spend", cost, stats.perDay.map((day) => Number(day.cost.toFixed(4))), { barMaxWidth: 26 })
          : lineSeries("Spend", cost, stats.perDay.map((day) => Number(day.cost.toFixed(4))), { area: true, showSymbol: false, triggerLineEvent: true }),
        ...(showPrevious ? [lineSeries("Previous spend", previous, stats.perDayPrevious!.map((day) => Number(day.cost.toFixed(4))), { lineStyle: { width: 1.4, type: "dashed", opacity: 0.75 }, itemStyle: { color: previous, opacity: 0.7 } })] : []),
      ],
    };
  }, [stats, theme, comparePrevious, dailyBars]);
  const requestsChart = useMemo(() => {
    if (!stats?.perDay.length) return {};
    return {
      ...baseOption(),
      color: [cssVar("--s1")],
      grid: gridBase({ top: 16, right: 10 }),
      tooltip: { ...tooltipBase("axis"), formatter: (params: unknown) => tooltipRows(params, () => formatCount) },
      xAxis: { type: "category", data: stats.perDay.map((day) => dayLabel(day.date)), ...axisBase() },
      yAxis: { type: "value", splitLine: splitLine(), axisLabel: { color: cssVar("--text-3"), fontSize: 11, formatter: (value: number) => formatCount(value) } },
      series: [dailyBars ? barSeries("Runs", cssVar("--s1"), stats.perDay.map((day) => day.runs), { barMaxWidth: 22 }) : lineSeries("Runs", cssVar("--s1"), stats.perDay.map((day) => day.runs), { showSymbol: false, triggerLineEvent: true })],
    };
  }, [stats, theme, dailyBars]);
  const errorsChart = useMemo(() => {
    if (!stats?.perDay.length) return {};
    return {
      ...baseOption(),
      color: [cssVar("--bad")],
      grid: gridBase({ top: 16, right: 10 }),
      tooltip: { ...tooltipBase("axis"), formatter: (params: unknown) => tooltipRows(params, () => formatCount) },
      xAxis: { type: "category", data: stats.perDay.map((day) => dayLabel(day.date)), ...axisBase() },
      yAxis: { type: "value", splitLine: splitLine(), axisLabel: { color: cssVar("--text-3"), fontSize: 11, formatter: (value: number) => formatCount(value) } },
      series: [dailyBars ? barSeries("Errors", cssVar("--bad"), stats.perDay.map((day) => day.errors), { barMaxWidth: 22 }) : lineSeries("Errors", cssVar("--bad"), stats.perDay.map((day) => day.errors), { showSymbol: false, triggerLineEvent: true })],
    };
  }, [stats, theme, dailyBars]);
  const sourceChart = useMemo(() => {
    if (!stats?.bySource.length) return {};
    const total = stats.bySource.reduce((sum, row) => sum + row.runs, 0);
    return {
      ...baseOption(),
      color: seriesColors(),
      tooltip: { ...tooltipBase("item"), formatter: "{b}: {c} runs ({d}%)" },
      series: [donutSeries(stats.bySource.slice(0, 6).map((row) => ({ name: row.source, value: row.runs })))],
      graphic: [
        { type: "text", left: "center", top: "43%", style: { text: compact(total), fill: cssVar("--heading"), font: "600 18px Geist, sans-serif", textAlign: "center" } },
        { type: "text", left: "center", top: "55%", style: { text: "runs", fill: cssVar("--text-3"), font: "11px Geist, sans-serif", textAlign: "center" } },
      ],
    };
  }, [stats, theme]);

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  if (!stats) return null;

  const peakDay = stats.perDay.reduce((best, day) => day.cost > best.cost ? day : best, stats.perDay[0]);
  const anomalyDays = stats.perDay.filter((day) => day.anomalies > 0);
  const previous = stats.previous;
  const delta = previous && previous.totalCost >= Math.max(1, stats.totalCost * 0.1)
    ? ((stats.totalCost - previous.totalCost) / previous.totalCost) * 100
    : null;
  const projected = (stats.totalCost / range) * 30;
  const dailyAverage = stats.totalCost / range;
  const dailyErrorRate = stats.perDay.map((day) => day.runs ? (day.errors / day.runs) * 100 : 0);
  const successRate = stats.totalRuns ? (1 - stats.errorCount / stats.totalRuns) * 100 : 100;
  const avgTokens = stats.totalRuns ? Math.round(stats.totalTokens / stats.totalRuns) : 0;
  const errorRate = stats.totalRuns ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  // Previous minus current: positive means the window got faster. Without
  // traffic in the previous window a delta would just repeat the current
  // average and read as a real regression, so leave it out.
  const latencyDelta = previous && previous.totalRuns > 0 ? previous.avgLatencyMs - stats.avgLatencyMs : null;

  return <>
    <div className="page-head">
      <div>
        <h1>Dashboard</h1>
        <p className="page-sub">The ledger of what ran, what it cost and what needs a decision. Last {range} days, {stats.project_name ? `project ${stats.project_name}` : project ? "selected project" : "all projects"}.</p>
      </div>
      <div className="head-actions">
        <ToggleGroup className="range" type="single" value={String(range)} onValueChange={(value) => { if (!value) return; const next = new URLSearchParams(params); next.set("range", value); setParams(next); }}>{RANGES.map((value) => <ToggleGroupItem key={value} value={String(value)} className={value === range ? "active" : ""}>{value}D</ToggleGroupItem>)}</ToggleGroup>
        <Link className={buttonVariants({ variant: "outline" })} to="/ui/analytics">Open Analytics</Link>
        <Button variant="outline" type="button" onClick={() => void query.refetch()}>Refresh</Button>
      </div>
    </div>

    <section className="db-hero">
      <div className="db-hero-foot">
        <div>
          <div className="db-hero-label">Spend, last {range} days</div>
          <div className="db-hero-num"><em>{fmtUsd(stats.totalCost)}</em></div>
          <span className="db-hero-sub">Daily average <b>{fmtUsd(dailyAverage)}</b>{range < 30 ? <> · projected 30-day <b>{fmtUsd(projected)}</b></> : null}{delta != null ? <span className={`db-delta ${deltaTone("spend", delta >= 0.05 ? 1 : delta <= -0.05 ? -1 : 0)}`}> · {deltaArrow(delta >= 0 ? 1 : -1)} {formatPercent(Math.abs(delta))} vs previous {range} days</span> : null}</span>
          <div className="hero-spark"><Sparkline values={stats.perDay.map((day) => day.cost)} accent bars /></div>
        </div>
        <div className="db-hero-stats">
          <div className="db-stat"><div className="v">{compact(stats.totalRuns)}</div><div className="l">Runs</div><div className="s">{formatPercent(successRate)} succeeded</div></div>
          <div className="db-stat"><div className="v">{compact(stats.totalTokens)}</div><div className="l">Tokens</div><div className="s">{compact(avgTokens)} avg per run</div></div>
          <div className="db-stat"><div className="v">{fmtMs(stats.avgLatencyMs)}</div><div className="l">Avg latency</div><div className="s">{latencyDelta != null ? <span className={`delta-tone ${deltaTone("latency", latencyDelta >= 0 ? -1 : 1)}`}>{latencyDelta >= 0 ? "↓" : "↑"} {fmtMs(Math.abs(latencyDelta))} vs previous</span> : `p95 ${fmtMs(stats.p95LatencyMs)}`}</div></div>
        </div>
      </div>
    </section>

    <section className="db-kpis" aria-label="Key figures">
      <Kpi to="/ui/runs" label="Requests" value={compact(stats.totalRuns)} unit="runs" detail={`${formatCount(stats.errorCount)} error${stats.errorCount === 1 ? "" : "s"} · ${formatPercent(successRate)} success`} values={stats.perDay.map((day) => day.runs)} />
      <Kpi to="/ui/runs?status=error" label="Error rate" value={formatPercent(errorRate, 2)} detail={`${formatCount(stats.errorCount)} failed run${stats.errorCount === 1 ? "" : "s"}`} values={dailyErrorRate} />
      <Kpi to="/ui/runs?sort=latency&dir=desc" label="p95 latency" value={fmtMs(stats.p95LatencyMs)} detail={`p50 ${fmtMs(stats.p50LatencyMs)} · p99 ${fmtMs(stats.p99LatencyMs)}`} />
      <Kpi to="/ui/runs?sort=latency&dir=desc" label="p99 latency" value={fmtMs(stats.p99LatencyMs)} detail="tail of the window" />
      <Kpi to="/ui/analytics" label="Active models" value={String(stats.byModel.length)} unit={stats.byModel.length === 1 ? "model" : "models"} detail={`${stats.bySource.length} ingress source${stats.bySource.length === 1 ? "" : "s"}`} />
      {judgeAllowed && (stats.judgeCostUsd ?? 0) > 0
        ? <Kpi to="/ui/cost" label="Judge spend" value={fmtUsd(stats.judgeCostUsd ?? 0)} unit="MTD" detail="judging and online evals" />
        : <Kpi to="/ui/agents/observed" label="Agents" value={String(stats.byAgent.length)} unit="seen" detail="in this window" />}
    </section>

    <CoveragePanel />

    <section className="panel mb-4">
      <div className="panel-head">
        <div className="panel-title"><span className="sig" />Spend by day</div>
        <div className="panel-tools">
          <label className="db-compare" title="Overlay the previous window's daily spend">
            <Checkbox aria-label="Compare with the previous period" checked={comparePrevious} onCheckedChange={(value) => setComparePrevious(value === true)} />
            <span>vs previous</span>
          </label>
          <span className="panel-note">{range} DAYS</span>
        </div>
      </div>
      <div className="panel-body">
        {stats.totalRuns
          ? <ReactEChartsCore echarts={echarts} option={chart} style={{ height: 300 }} notMerge onEvents={{ click: (params: { dataIndex?: number }) => openDay(params.dataIndex ?? -1) }} />
          : <ChartEmpty title="No runs in this window" hint="Send a request through the proxy or widen the range." />}
        <span className="fig-caption">
          <b>Fig. 01</b> · Daily spend, with the previous window dashed. Click a day to open its runs.
          {stats.totalRuns && peakDay && peakDay.cost > 0 ? <> Peak spend {formatDate(peakDay.date)} ({fmtUsd(peakDay.cost)}).</> : null}
          {anomalyDays.length ? <> {anomalyDays.length} anomaly day{anomalyDays.length === 1 ? "" : "s"}: {anomalyDays.map((day) => formatDate(day.date)).join(", ")}.</> : null}
        </span>
      </div>
    </section>

    <div className="db-mid">
      <section className="panel"><div className="panel-head"><div className="panel-title"><span className="sig" />Runs per day</div></div><div className="panel-body">{stats.totalRuns ? <ReactEChartsCore echarts={echarts} option={requestsChart} style={{ height: 180 }} notMerge onEvents={{ click: (params: { dataIndex?: number }) => openDay(params.dataIndex ?? -1) }} /> : <ChartEmpty title="No requests" hint="Nothing ran in this window." />}</div></section>
      <section className="panel"><div className="panel-head"><div className="panel-title"><span className="sig" />Errors per day</div></div><div className="panel-body">{stats.totalRuns ? <ReactEChartsCore echarts={echarts} option={errorsChart} style={{ height: 180 }} notMerge onEvents={{ click: (params: { dataIndex?: number }) => openDay(params.dataIndex ?? -1) }} /> : <ChartEmpty title="No errors" hint="Nothing ran in this window." />}</div></section>
    </div>

    <div className="db-cols">
      <section className="panel db-live-panel">
        <div className="panel-head"><div className="panel-title"><span className="sig live" />Live feed</div><Link className="panel-note" to="/ui/runs">View all runs</Link></div>
        <LiveFeedMini />
      </section>
      <section className="panel">
        <div className="panel-head"><div className="panel-title"><span className="sig" />Sources</div><span className="panel-note">INGRESS</span></div>
        <div className="panel-body">
          {stats.bySource.length ? <><ReactEChartsCore echarts={echarts} option={sourceChart} style={{ height: 170 }} notMerge /><div className="donut-legend">{stats.bySource.slice(0, 6).map((row, index) => <Link className="row" key={row.source} to={`/ui/runs?source=${encodeURIComponent(row.source)}`}><span className={`sw s${index + 1}`} /><span className="lbl">{row.source}</span><span className="val">{compact(row.runs)}</span></Link>)}</div></> : <span className="panel-note">No ingress data.</span>}
        </div>
      </section>
    </div>

    <section className="panel mb-4">
      <div className="panel-head"><div className="panel-title"><span className="sig" />Models by spend</div><Link className="panel-note" to="/ui/analytics">Analytics</Link></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Model</th><th className="num">Runs</th><th>Share</th><th className="num">Total cost</th></tr></thead>
        <tbody>
          {stats.byModel.length ? stats.byModel.slice(0, 10).map((row) => <tr key={row.model}>
            <td><Link className="tcell-primary mono" to={`/ui/runs?model=${encodeURIComponent(row.model)}`}>{row.model}</Link></td>
            <td className="num">{compact(row.runs)}</td>
            <td><div className="share"><div className="share-track"><div className="share-fill" style={{ width: `${stats.totalCost > 0 ? Math.min(100, (row.cost / stats.totalCost) * 100) : 0}%` }} /></div></div></td>
            <td className="num">{fmtUsd(row.cost)}</td>
          </tr>) : <tr><td colSpan={4} className="panel-note" style={{ padding: 16, textAlign: "center" }}>No model usage in this window.</td></tr>}
        </tbody>
      </table></div>
    </section>

    <div className="db-cols">
      <section className="panel">
        <div className="panel-head"><div className="panel-title"><span className="sig" />Agents</div><Link className="panel-note" to="/ui/agents">Observed agents</Link></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Agent</th><th className="num">Runs</th><th className="num">Cost</th><th className="num">Errors</th></tr></thead>
          <tbody>{stats.byAgent.length ? stats.byAgent.slice(0, 8).map((row) => <tr key={row.agent}><td><Link className="tcell-primary" to={`/ui/runs?agent=${encodeURIComponent(row.agent)}`}>{row.agent}</Link></td><td className="num">{compact(row.runs)}</td><td className="num">{fmtUsd(row.cost)}</td><td className="num">{row.errorCount}</td></tr>) : <tr><td colSpan={4} className="panel-note" style={{ padding: 14, textAlign: "center" }}>No agent-attributed runs.</td></tr>}</tbody>
        </table></div>
      </section>
      <section className="panel">
        <div className="panel-head"><div className="panel-title"><span className="sig" />MCP activity</div><Link className="panel-note" to="/ui/runs?source=mcp_gateway">Governed runs</Link></div>
        <div className="panel-body">
          <div className="group-stats mt-0 mx-0 mb-3">
            <span className="chip">calls: <b>{stats.mcp.calls}</b></span><span className="chip">denied: <b>{stats.mcp.denied}</b></span><span className="chip">pending: <b>{stats.mcp.pending}</b></span><span className="chip">errors: <b>{stats.mcp.errorCount}</b></span>
          </div>
          {stats.mcp.tools.length ? stats.mcp.tools.slice(0, 6).map((tool) => <div key={tool.tool} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--sans)", fontSize: 11.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}><Link to={`/ui/runs?q=${encodeURIComponent(tool.tool)}`}>{tool.tool}</Link><span className="tcell-muted">{compact(tool.runs)} · {fmtUsd(tool.cost)}</span></div>) : <span className="panel-note">No MCP tool calls.</span>}
        </div>
      </section>
    </div>
  </>;
}

function ChartEmpty({ title, hint }: { title: string; hint: string }) {
  return <div className="empty-value" style={{ padding: "34px 0", textAlign: "center" }}>
    <p>{title}</p>
    <span className="field-hint">{hint}</span>
  </div>;
}

function Kpi({ to, label, value, unit, detail, values }: { to: string; label: string; value: string; unit?: string; detail: string; values?: number[] }) {
  return <Link className="db-kpi" to={to}>
    <div className="db-kpi-label">{label}</div>
    <div className="db-kpi-value">{value}{unit ? <span className="unit">{unit}</span> : null}</div>
    <div className="db-kpi-sub">{detail}</div>
    {values?.length ? <Sparkline values={values} bars /> : null}
  </Link>;
}

function LiveFeedMini() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState("connecting");
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    const controller = new AbortController();
    (async () => {
      const key = localStorage.getItem("torrix_key");
      try {
        const response = await fetch("/api/stream", { headers: key ? { authorization: `Bearer ${key}` } : {}, credentials: "include", signal: controller.signal });
        if (!response.ok || !response.body) { setStatus("unavailable"); return; }
        setStatus("live");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createParser({
          onEvent: (event) => {
            if (!event.data) return;
            try {
              const parsed = JSON.parse(event.data) as Record<string, unknown>;
              if (parsed.type === "connected") { setStatus("live"); return; }
              if (parsed.id) setRuns((prev) => [parsed as unknown as Run, ...prev].slice(0, 40));
            } catch { /* heartbeat */ }
          },
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch { if (!closedRef.current) setStatus("error"); }
    })();
    return () => { closedRef.current = true; controller.abort(); };
  }, []);
  return <>
    <div id="liveFeed">
      {runs.length ? runs.map((run) => <div className="live-row" key={run.id}>
        <span className="lr-time">{formatDateTime(run.created_at)}</span>
        <Link className="lr-name" to={`/ui/runs/${run.id}`}>{run.name || run.id.slice(0, 8)}</Link>
        <span className="lr-model">{run.model || "?"}</span>
        <span className={`badge ${run.status && run.status >= 400 ? "bad" : "good"}`}><span className="dot" />{run.status ?? 200}</span>
        <span className="lr-cost">{fmtUsd(run.cost_usd)}</span>
      </div>) : <div className="live-empty">Waiting for the first run… send a request through Torrix or trigger an LLM run.</div>}
    </div>
    <div className="live-foot"><span><span className={`db-dot ${status === "live" ? "s4" : "s5"}`} />{status}</span><Link to="/ui/live">Full feed</Link></div>
  </>;
}

export function PageLoading() {
  return <div className="loading-page"><div className="skeleton" style={{ width: 240, height: 40, marginBottom: 18 }} /><div className="kpis">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" style={{ height: 92 }} />)}</div><div className="skeleton" style={{ height: 320 }} /></div>;
}

export function PageError({ message }: { message: string }) {
  return <div className="error-panel" role="alert">
    <div><span className="empty-title">Could not load this view</span><span className="empty-sub">{message}</span></div>
    <Button variant="outline" type="button" onClick={() => window.location.reload()}>Retry</Button>
  </div>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="kpi"><span className="k-label">{label}</span><div className="k-value">{value}</div><div className="k-sub">{detail}</div></article>;
}

export function RunTable({ runs, loading }: { runs: Run[]; loading: boolean }) {
  if (loading) return <div className="panel-body"><span className="skeleton" style={{ display: "block", width: "100%", height: 80 }} /></div>;
  if (!runs.length) return <div className="panel-body"><div className="empty"><span className="empty-title">No runs yet</span><span className="empty-sub">Once an LLM call passes through Torrix, it appears here.</span></div></div>;
  return <div className="table-wrap"><table><thead><tr><th>Run</th><th>Provider / model</th><th>Status</th><th className="num">Tokens</th><th className="num">Cost</th><th className="num">Latency</th><th>Time</th></tr></thead><tbody>
    {runs.map((run) => { const failed = !!run.status && run.status >= 400; return <tr key={run.id} className={failed ? "row-error" : undefined}>
      <td><Link className="tcell-primary" to={`/ui/runs/${run.id}`}>{run.name || run.id.slice(0, 8)}</Link><small className="tcell-sub">{run.source || "direct"}</small></td>
      <td><div className="cell-stack"><span className="tcell-primary">{run.provider || "Unknown"}</span><small className="tcell-sub">{run.model || "Unknown model"}</small></div></td>
      <td><span className={`badge ${failed ? "bad" : "good"}`}><span className="dot" />{failed ? run.status : "OK"}</span></td>
      <td className="num">{compact((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}</td>
      <td className="num">{fmtUsd(run.cost_usd)}</td>
      <td className="num">{fmtMs(run.latency_ms)}</td>
      <td className="tnum">{formatDateTime(run.created_at)}</td>
    </tr>; })}
  </tbody></table></div>;
}
