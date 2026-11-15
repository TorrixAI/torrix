import { buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQuery } from "@tanstack/react-query";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { AriaComponent, GraphicComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  compact,
  fmtMs,
  fmtUsd,
  formatCount,
  formatPercent,
  type AnalyticsAgentsResponse,
  type AnalyticsRow,
  type AnalyticsToolsResponse,
  type AnalyticsUsersResponse,
  type Dashboard,
  type LeaderboardResponse,
} from "../api";
import { axisBase, baseOption, barSeries, donutSeries, gridBase, seriesColors, splitLine, tooltipBase } from "../charts";
import { Trend } from "../components";
import { cssVar, useTheme } from "../theme";

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, GraphicComponent, CanvasRenderer]);

export default function AnalyticsPage() {
  const theme = useTheme();
  const [params, setParams] = useSearchParams();
  const range = [7, 14, 30].includes(Number(params.get("range"))) ? Number(params.get("range")) : 14;
  const project = params.get("project") ?? "";

  const statsQuery = useQuery({
    queryKey: ["analytics-stats", range, project],
    queryFn: () => {
      const to = new Date();
      const from = new Date(Date.now() - (range - 1) * 86_400_000);
      const search = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (project) search.set("project", project);
      return api<Dashboard>(`/api/dashboard?${search}`);
    },
  });

  const modelsQuery = useQuery({
    queryKey: ["analytics-models", range, project],
    queryFn: () => {
      const search = new URLSearchParams({ days: String(range) });
      if (project) search.set("project", project);
      return api<LeaderboardResponse>(`/api/analytics/leaderboard?${search}`);
    },
  });

  const agentsQuery = useQuery({
    queryKey: ["analytics-agents", range, project],
    queryFn: () => {
      const search = new URLSearchParams({ days: String(range) });
      if (project) search.set("project", project);
      return api<AnalyticsAgentsResponse>(`/api/analytics/by-agent?${search}`);
    },
  });

  const usersQuery = useQuery({
    queryKey: ["analytics-users", range, project],
    queryFn: () => {
      const search = new URLSearchParams({ days: String(range) });
      if (project) search.set("project", project);
      return api<AnalyticsUsersResponse>(`/api/analytics/by-user?${search}`);
    },
  });

  const toolsQuery = useQuery({
    queryKey: ["analytics-tools", range, project],
    queryFn: () => {
      const search = new URLSearchParams({ days: String(range) });
      if (project) search.set("project", project);
      return api<AnalyticsToolsResponse>(`/api/analytics/by-tool?${search}`);
    },
  });

  const projectsQuery = useQuery({
    queryKey: ["analytics-projects", range, project],
    queryFn: () => {
      const search = new URLSearchParams({ days: String(range) });
      if (project) search.set("project", project);
      return api<{ projects: AnalyticsRow[] }>(`/api/analytics/by-project?${search}`);
    },
  });
  const namesQuery = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: Array<{ id: string; name: string }> }>("/api/projects") });

  const stats = statsQuery.data;
  const models = modelsQuery.data?.models ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const users = usersQuery.data?.end_users ?? [];
  const tools = toolsQuery.data?.tools ?? [];
  const byProject = projectsQuery.data?.projects ?? [];
  const projectNames = new Map((namesQuery.data?.projects ?? []).map((entry) => [entry.id, entry.name]));

  const previous = stats?.previous ?? null;
  const prevErrorRate = previous && previous.totalRuns > 0 ? (previous.errorCount / previous.totalRuns) * 100 : 0;
  const trendSuffix = ` vs previous ${range}d`;
  const scopedName = project ? projectNames.get(project) ?? null : null;

  const sourceChart = useMemo(() => {
    if (!stats?.bySource || !stats.bySource.length) return {};
    const total = stats.bySource.reduce((sum, row) => sum + row.runs, 0);
    return {
      ...baseOption(),
      color: seriesColors(),
      tooltip: { ...tooltipBase("item"), formatter: "{b}: {c} runs ({d}%)" },
      series: [donutSeries(stats.bySource.map((row) => ({ name: row.source, value: row.runs })))],
      graphic: [
        { type: "text", left: "center", top: "43%", style: { text: compact(total), fill: cssVar("--heading"), font: "600 18px Geist, sans-serif", textAlign: "center" } },
        { type: "text", left: "center", top: "55%", style: { text: "runs", fill: cssVar("--text-3"), font: "11px Geist, sans-serif", textAlign: "center" } },
      ],
    };
  }, [stats, theme]);

  const latencyChart = useMemo(() => {
    if (!stats?.latencyBuckets || !stats.latencyBuckets.length) return {};
    return {
      ...baseOption(),
      color: [cssVar("--hero-series")],
      grid: gridBase({ left: 8, right: 28, top: 8, bottom: 4 }),
      tooltip: { ...tooltipBase("axis"), valueFormatter: (value: number) => `${value} runs` },
      xAxis: { type: "value", splitLine: splitLine(), axisLabel: { color: cssVar("--text-3"), fontSize: 11 } },
      yAxis: { type: "category", data: stats.latencyBuckets.map((b) => b.bucket), ...axisBase() },
      series: [{
        ...barSeries("Runs", cssVar("--hero-series"), stats.latencyBuckets.map((b) => b.count)),
        itemStyle: { borderRadius: [0, 2, 2, 0], color: cssVar("--hero-series") },
        label: { show: true, position: "right", color: cssVar("--text-3"), fontSize: 11, fontFamily: "Geist" },
      }],
    };
  }, [stats, theme]);

  if (statsQuery.isPending) return <div className="startup loading-page"><span>Loading analytics…</span></div>;
  if (statsQuery.isError) return <div className="startup"><span>Could not load analytics: {statsQuery.error.message}</span></div>;
  if (!stats) return null;

  const errorRate = stats.totalRuns > 0 ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  const avgTokens = stats.totalRuns > 0 ? Math.round(stats.totalTokens / stats.totalRuns) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="page-sub">
            Last {range} days{scopedName ? ` · project ${scopedName}` : project ? " · selected project" : " · all projects"} · deep breakdowns: models, agents, users and MCP tools
          </p>
        </div>
        <div className="head-actions">
          <Link className={buttonVariants({ variant: "outline" })} to="/ui/dashboard">
            Dashboard home
          </Link>
          <ToggleGroup
            className="range"
            type="single"
            value={String(range)}
            onValueChange={(value) => {
              if (!value) return;
              const next = new URLSearchParams(params);
              next.set("range", value);
              setParams(next);
            }}
          >
            {[7, 14, 30].map((value) => (
              <ToggleGroupItem key={value} value={String(value)} className={value === range ? "active" : ""}>
                {value}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="stat-tiles analytics-stats">
        <Link className="stat-tile" to="/ui/runs?sort=cost&dir=desc">
          <span className="st-label">Spend</span>
          <div className="st-value">{fmtUsd(stats.totalCost)}</div>
          <div className="st-sub">{previous ? <Trend metric="spend" current={stats.totalCost} previous={previous.totalCost} suffix={trendSuffix} /> : `${compact(stats.totalTokens)} tokens`}</div>
        </Link>
        <Link className="stat-tile" to="/ui/runs">
          <span className="st-label">Runs</span>
          <div className="st-value">{formatCount(stats.totalRuns)}</div>
          <div className="st-sub"><Trend metric="runs" current={stats.totalRuns} previous={previous?.totalRuns} suffix={trendSuffix} /> this window</div>
        </Link>
        <Link className={`stat-tile${errorRate >= 5 ? " tone-bad" : ""}`} to="/ui/runs?status=error">
          <span className="st-label">Error rate</span>
          <div className="st-value">{formatPercent(errorRate, 2)}</div>
          <div className="st-sub">{formatCount(stats.errorCount)} error{stats.errorCount === 1 ? "" : "s"} <Trend metric="errors" current={errorRate} previous={prevErrorRate} suffix={trendSuffix} /></div>
        </Link>
        <Link className="stat-tile" to="/ui/runs?sort=latency&dir=desc">
          <span className="st-label">Latency (p95)</span>
          <div className="st-value">{fmtMs(stats.p95LatencyMs)}</div>
          <div className="st-sub">
            p50 {fmtMs(stats.p50LatencyMs ?? stats.avgLatencyMs)} · p99 {fmtMs(stats.p99LatencyMs ?? stats.p95LatencyMs)}
          </div>
        </Link>
        <Link className="stat-tile" to="/ui/runs?sort=tokens&dir=desc">
          <span className="st-label">Tokens</span>
          <div className="st-value">{compact(stats.totalTokens)}</div>
          <div className="st-sub">avg {formatCount(avgTokens)} / run</div>
        </Link>
        <Link className="stat-tile" to="/ui/runs?sort=score&dir=desc">
          <span className="st-label">Mean score</span>
          <div className="st-value">{stats.avgScore == null ? <span className="empty-value" style={{ color: "var(--text-3)", fontWeight: 500 }}>-</span> : stats.avgScore.toFixed(3)}</div>
          <div className="st-sub">{stats.avgScore == null ? "score runs to compare" : `${formatCount(stats.scoredCount ?? 0)} scored`}</div>
        </Link>
      </div>

      <AnalyticsTable
        title="Model leaderboard"
        note="per-model spend, efficiency and quality for the window"
        firstHeader="Model"
        rows={models}
        link={(row) => `/ui/runs?model=${encodeURIComponent(row.key)}`}
      />

      <AnalyticsTable
        title="Cost by agent"
        note="agent_name / agent_id from every ingestion path"
        firstHeader="Agent"
        rows={agents}
        link={(row) => `/ui/runs?agent=${encodeURIComponent(row.key)}`}
      />

      <AnalyticsTable
        title="Cost by end user"
        note="x-torrix-user-id or record.end_user_id"
        firstHeader="End user"
        rows={users}
        link={(row) => `/ui/runs?end_user=${encodeURIComponent(row.key)}`}
      />

      <AnalyticsTable
        title="Cost by project"
        note="project_id from proxy, SDK, ingest and OTLP runs"
        firstHeader="Project"
        rows={byProject}
        label={(row) => projectNames.get(row.key) ?? row.key}
        link={(row) => `/ui/runs?project=${encodeURIComponent(row.key)}`}
      />

      <AnalyticsTable
        title="MCP tools"
        note="tool calls from /mcp, /mcp/proxy and the governed gateway"
        firstHeader="Tool"
        rows={tools}
        link={(row) => `/ui/runs?q=${encodeURIComponent(row.key)}`}
      />

      <div className="db-mid">
        <section className="panel">
          <div className="panel-head">
            <div className="panel-title"><span className="sig" />By provider</div>
            <span className="panel-note">{formatCount((stats.bySource ?? []).reduce((sum, row) => sum + row.runs, 0))} runs</span>
          </div>
          <div className="panel-body">
            {stats.bySource && stats.bySource.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <ReactEChartsCore echarts={echarts} option={sourceChart} style={{ height: 220, flex: "0 0 240px" }} notMerge />
                <div className="donut-legend">
                  {stats.bySource.map((row, index) => (
                    <Link className="row" key={row.source} to={`/ui/runs?source=${encodeURIComponent(row.source)}`}>
                      <span className={`sw s${index + 1}`} />
                      <span className="lbl">{row.source}</span>
                      <span className="val">{compact(row.runs)} runs</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <p className="panel-note" style={{ padding: 16 }}>No source breakdown available.</p>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div className="panel-title"><span className="sig" />Latency distribution</div>
            <span className="panel-note">Bucketed run counts</span>
          </div>
          <div className="panel-body">
            {stats.latencyBuckets && stats.latencyBuckets.length > 0 ? (
              <ReactEChartsCore echarts={echarts} option={latencyChart} style={{ height: 220 }} notMerge />
            ) : (
              <p className="panel-note" style={{ padding: 16 }}>No latency bucket data available.</p>
            )}
            <span className="fig-caption"><b>Fig. 03</b> · latency buckets, p95 marked in the tile above</span>
          </div>
        </section>
      </div>
    </>
  );
}

function AnalyticsTable({
  title,
  note,
  firstHeader,
  rows,
  link,
  label,
}: {
  title: string;
  note: string;
  firstHeader: string;
  rows: AnalyticsRow[];
  link?: (row: AnalyticsRow) => string;
  label?: (row: AnalyticsRow) => string;
}) {
  // A column of dashes is noise. Show score only where the window has one.
  const showScore = rows.some((row) => row.avgScore != null);
  return (
    <div className="panel mb-4.5">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-note">{note}</span>
      </div>
      <div className="table-wrap">
        <table className="analytics-table" data-test="primary">
          <thead>
            <tr>
              <th>{firstHeader}</th>
              <th className="num">Runs</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
              <th className="num">Cost / 1k</th>
              <th className="num">Errors</th>
              <th className="num">Avg latency</th>
              {showScore ? <th className="num">Avg score</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.key}>
                  <td className="tnum">
                    {(() => {
                      const text = (label ? label(row) : row.key) || "-";
                      return link ? <Link to={link(row)}>{text}</Link> : text;
                    })()}
                  </td>
                  <td className="num">{formatCount(row.runs)}</td>
                  <td className="num">{compact(row.tokens)}</td>
                  <td className="num">{fmtUsd(row.cost)}</td>
                  <td className="num">
                    {row.cost_per_1k_tokens != null
                      ? fmtUsd(row.cost_per_1k_tokens)
                      : row.tokens > 0
                      ? fmtUsd((row.cost / row.tokens) * 1000)
                      : "-"}
                  </td>
                  <td className="num">
                    {row.runs > 0 ? (() => {
                      const rate = (row.errorCount / row.runs) * 100;
                      return rate >= 5 ? (
                        <span className="badge bad">
                          <span className="dot" />
                          {formatPercent(rate)} ({formatCount(row.errorCount)})
                        </span>
                      ) : (
                        <span className="error-plain">{row.errorCount ? `${formatPercent(rate)} (${formatCount(row.errorCount)})` : "0"}</span>
                      );
                    })() : (
                      "-"
                    )}
                  </td>
                  <td className="num">{fmtMs(row.avgLatencyMs)}</td>
                  {showScore ? <td className="num">{row.avgScore == null ? <span className="tcell-muted empty-table">-</span> : row.avgScore.toFixed(2)}</td> : null}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={showScore ? 8 : 7} className="p-[14px] panel-note">
                  No data in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
