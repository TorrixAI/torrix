import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, relTime, compact, fmtMs, fmtUsd, formatCount, formatDateTime, formatPercent, userPrompt, type Dashboard, type JudgeJobState, type Run, type RunPage as RunPageData, type TraceGroup } from "../api";
import { EmptyRow, InlineSelect, Modal, PageHead, SkeletonRows } from "../components";
import { PageError } from "./DashboardPage";
import { useToast } from "../toast";
import { downloadFile } from "../download";
import { useFeature } from "../features";
import { toolLabel, toolStep } from "../lib/conversation";
import { activeFilterNames, activeRunFilters, applyRunFilter, clearRunFilters, dayToIso, isoToDay, RUN_SOURCES } from "../lib/runFilters";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { agentColorToken } from "../lib/traceGraph";
import { SecretNotice } from "../SecretNotice";

const GROUPS: Array<[string, string]> = [["None", "none"], ["By session", "session"], ["By trace", "trace"]];
const BULK_CAP = 500;

export default function RunsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const project = params.get("project") ?? "";
  const storedGroup = localStorage.getItem("torrix_run_group");
  const requestedGroup = params.get("group") ?? (storedGroup === "none" || storedGroup === "trace" || storedGroup === "session" ? storedGroup : null);
  const sortField = params.get("sort") ?? "";
  const sortDir = params.get("dir") ?? "";
  const search = params.get("q") ?? "";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState(() => localStorage.getItem("torrix_auto_refresh") === "1");
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("torrix_run_columns") ?? "[]") as string[]); } catch { return new Set(); }
  });
  const [selectedTraces, setSelectedTraces] = useState<Set<string>>(new Set());
  const [filterSelection, setFilterSelection] = useState(false);
  const [judgeConfirm, setJudgeConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [judgeJobId, setJudgeJobId] = useState<string | null>(null);
  const [rejudge, setRejudge] = useState(false);
  const [selectNotice, setSelectNotice] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = activeRunFilters(params);
  const filterCount = activeFilters.filter((chip) => chip.key !== "q").length;
  const judgeFeature = useFeature("judge");
  const judgeSettings = useQuery({
    queryKey: ["judge-settings"],
    queryFn: () => api<{ settings: { model: string | null; has_api_key: boolean } }>("/api/judge/settings"),
    enabled: judgeFeature.ready && judgeFeature.allowed,
    retry: false,
  });
  const judgeReady = judgeFeature.allowed && Boolean(judgeSettings.data?.settings.model && judgeSettings.data?.settings.has_api_key);

  const queryString = new URLSearchParams(params);
  queryString.set("limit", "50");
  if (requestedGroup) queryString.set("group", requestedGroup);
  // Keep the URL immediate, but let typing settle before a request.
  const runsKey = useDebouncedValue(queryString.toString(), 250);
  const runsQuery = useQuery({
    queryKey: ["runs", runsKey],
    queryFn: () => api<RunPageData>(`/api/runs?${runsKey}`),
    // Keep the table and toolbar mounted while a debounced search or filter
    // request is in flight, so the input keeps focus and typed characters.
    placeholderData: keepPreviousData,
    refetchInterval: auto ? 15000 : false,
  });
  const statsQuery = useQuery({
    queryKey: ["runs-stats", project],
    queryFn: () => {
      const to = new Date();
      const from = new Date(Date.now() - 30 * 86_400_000);
      const search2 = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      if (project) search2.set("project", project);
      return api<Dashboard>(`/api/dashboard?${search2}`);
    },
  });

  const setFilter = (patch: Record<string, string>, replace = false) => {
    const next = applyRunFilter(params, patch);
    setSelected(new Set());
    setSelectedTraces(new Set());
    setFilterSelection(false);
    setParams(next, { replace });
  };
  const clearAllFilters = () => {
    setSelected(new Set());
    setSelectedTraces(new Set());
    setFilterSelection(false);
    setParams(clearRunFilters(params));
  };
  const filterObject = () => {
    const out: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
      if (key !== "page" && key !== "gpage" && key !== "limit") out[key] = value;
    }
    return out;
  };
  const selectedTraceIds = [...selectedTraces];
  const judgeKind: "run" | "trace" = requestedGroup === "trace" ? "trace" : "run";
  const previewQuery = useQuery({
    queryKey: ["judge-preview", judgeKind, filterSelection, selectedTraceIds.join(","), [...selected].join(",")],
    queryFn: () => api<{ kind: "run" | "trace"; runs?: number; traces: number; queued: number; skipped: number; tokens_per_trace?: number; tokens_per_run?: number; estimated_usd: number }>("/api/runs/bulk/judge-preview", {
      method: "POST",
      body: JSON.stringify(filterSelection ? { kind: judgeKind, filter: filterObject() } : judgeKind === "trace" ? { kind: judgeKind, trace_ids: selectedTraceIds } : { kind: judgeKind, ids: [...selected] }),
    }),
    enabled: judgeConfirm && judgeReady,
    retry: false,
  });
  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ deleted?: number; updated?: number; job_id?: string; kind?: "run" | "trace"; queued?: number; skipped?: number }>("/api/runs/bulk", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (data) => {
      if (data.job_id) {
        setJudgeJobId(data.job_id);
        const unit = data.kind === "run" ? "run" : "trace";
        toast.toast(`Judging ${formatCount(data.queued ?? 0)} ${unit}${data.queued === 1 ? "" : "s"}${data.skipped ? `, ${formatCount(data.skipped)} already judged` : ""}.`, { type: "success" });
      } else {
        toast.toast(data.deleted != null ? `Deleted ${formatCount(data.deleted)} run${data.deleted === 1 ? "" : "s"}.` : `Updated ${formatCount(data.updated ?? 0)} run${(data.updated ?? 0) === 1 ? "" : "s"}.`, { type: "success" });
      }
      setSelected(new Set());
      setSelectedTraces(new Set());
      setFilterSelection(false);
      setJudgeConfirm(false);
      setDeleteConfirm(false);
      void client.invalidateQueries({ queryKey: ["runs"] });
      void client.invalidateQueries({ queryKey: ["group-runs"] });
    },
    onError: (error: Error) => {
      const messages: Record<string, string> = {
        too_many_ids: "Too many runs selected. Narrow the filters and try again.",
        too_many_traces: "Too many traces selected. Choose at most 200.",
        judge_not_configured: "Configure a judge model and API key in Settings before judging.",
        license_required: "Judging is a Pro feature. Activate a license to use it.",
        demo_read_only: "The demo is read-only, so this action is disabled.",
        judge_job_running: "A judge job is already running. Wait for it to finish or stop it.",
        no_ids: "Select runs or traces first.",
        no_traces: "Select at least one trace first.",
      };
      const key = Object.keys(messages).find((value) => error.message.includes(value));
      toast.toast(key ? messages[key]! : error.message, { type: "error" });
    },
  });
  const jobQuery = useQuery({
    queryKey: ["judge-job", judgeJobId],
    queryFn: () => api<{ job: JudgeJobState }>(`/api/runs/judge/${encodeURIComponent(judgeJobId ?? "")}`),
    enabled: Boolean(judgeJobId),
    refetchInterval: (query) => ["queued", "running"].includes(query.state.data?.job.status ?? "") ? 900 : false,
  });
  useEffect(() => {
    const job = jobQuery.data?.job;
    if (!job || !judgeJobId || !["done", "stopped"].includes(job.status)) return;
    if (job.kind === "run") {
      toast.toast(`Judge finished: ${formatCount(job.completed)} run${job.completed === 1 ? "" : "s"} judged, ${formatCount(job.failed)} failed.`, { type: job.failed ? "error" : "success", action: { label: "View runs", onClick: () => navigate("/ui/runs") } });
    } else {
      toast.toast(`Judge finished: ${formatCount(job.good)} good, ${formatCount(job.bad)} bad, ${formatCount(job.failed)} failed.`, { type: job.failed ? "error" : "success", action: { label: "View results", onClick: () => navigate(job.bad > job.good ? "/ui/runs?score=bad" : "/ui/runs?score=good") } });
    }
    setJudgeJobId(null);
    void client.invalidateQueries({ queryKey: ["runs"] });
    void client.invalidateQueries({ queryKey: ["group-runs"] });
  }, [jobQuery.data?.job.status, judgeJobId, client, toast, navigate]);

  useEffect(() => { localStorage.setItem("torrix_auto_refresh", auto ? "1" : "0"); }, [auto]);
  const showColumn = (key: string) => !hiddenCols.has(key);
  const toggleColumn = (key: string) => {
    setHiddenCols((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem("torrix_run_columns", JSON.stringify([...next]));
      return next;
    });
  };
  const visibleColumns = 11 - hiddenCols.size;

  if (runsQuery.isError) return <PageError message={runsQuery.error.message} />;
  if (!runsQuery.data) return <>
    <PageHead title="Runs" sub="Loading runs." />
    <div className="panel"><div className="table-wrap"><table data-test="primary">
      <thead><tr><th>Time</th><th>Run</th><th>Agent</th><th>Status</th><th className="num">Tokens</th><th className="num">Cost</th><th className="num">Latency</th></tr></thead>
      <tbody><SkeletonRows columns={7} rows={8} /></tbody>
    </table></div></div>
  </>;
  const data = runsQuery.data;
  const runs = data.runs;
  const group = requestedGroup ?? data.group ?? "none";
  const runTotal = data.run_total ?? data.total;
  const pageCount = Math.max(1, Math.ceil(data.total / data.limit));
  const groupInfo = new Map((data.groups ?? []).map((entry) => [entry.id, entry]));
  const groupLimit = data.group_limit ?? 10;
  const groupPage = data.group_page ?? 0;
  const groupTotal = data.group_total ?? 0;
  const groupPages = Math.max(1, Math.ceil(groupTotal / groupLimit));
  const stats = statsQuery.data;
  const summary = data.summary;
  const firstToolMap = new Map((data.firstTools ?? []).map((entry) => [entry.runId, entry.message]));
  const eventMap = new Map<string, { tools: number; think: boolean; response: boolean }>();
  for (const count of data.eventCounts ?? []) {
    const entry = eventMap.get(count.runId) ?? { tools: 0, think: false, response: false };
    if (count.type === "tool_call") entry.tools += count.count;
    if (count.type === "thinking") entry.think = true;
    if (count.type === "response") entry.response = true;
    eventMap.set(count.runId, entry);
  }
  const allSelected = runs.length > 0 && runs.slice(0, BULK_CAP).every((run) => selected.has(run.id));
  const toggleAll = () => {
    const visible = runs.map((run) => run.id);
    if (allSelected) { setSelected(new Set()); return; }
    setSelected(new Set(visible.slice(0, BULK_CAP)));
    setSelectNotice(visible.length > BULK_CAP ? `${BULK_CAP} of ${visible.length} selected; narrow the filters to select more.` : "");
  };
  const toggle = (id: string) => setSelected((prev) => {
    if (!prev.has(id) && prev.size >= BULK_CAP) {
      toast.toast(`${BULK_CAP} of ${prev.size} selected; narrow the filters to select more.`, { type: "error" });
      return prev;
    }
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleTrace = (id: string) => setSelectedTraces((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectedTraceRuns = [...selectedTraces].reduce((sum, id) => sum + (groupInfo.get(id)?.runs ?? 0), 0);
  const matching = group === "trace" ? groupTotal : data.total;
  const selectionCount = group === "trace" ? selectedTraces.size : selected.size;
  const selectionLabel = group === "trace"
    ? `${formatCount(selectedTraces.size)} trace${selectedTraces.size === 1 ? "" : "s"} selected (${formatCount(selectedTraceRuns)} runs)`
    : `${formatCount(selected.size)} run${selected.size === 1 ? "" : "s"} selected`;
  const selectAllMatching = () => {
    if (group === "trace" && matching > 200) { toast.toast("Choose at most 200 traces per judge job. Narrow the filters first.", { type: "error" }); return; }
    if (group !== "trace" && matching > BULK_CAP) { toast.toast("Select all matching is limited to 500 runs. Narrow the filters first.", { type: "error" }); return; }
    setFilterSelection(true);
    setSelectNotice(`All ${formatCount(matching)} matching ${group === "trace" ? "traces" : "runs"} selected${group === "trace" ? ` (${formatCount(runTotal)} runs)` : ""}.`);
  };
  const judgeTargets = group === "trace" ? selectedTraceIds : [...selected];
  const judgeDisabledReason = !judgeFeature.ready ? "Checking the judge license." : !judgeFeature.allowed ? "Judging is a Pro feature." : judgeSettings.isError ? "Judge settings are unavailable." : !judgeReady ? "Configure the judge model and API key in Settings." : "";
  const judgeSelected = () => {
    if (judgeDisabledReason) { toast.toast(judgeDisabledReason, { type: "error" }); return; }
    if (!filterSelection && judgeTargets.length === 0) { toast.toast("Select at least one trace first.", { type: "error" }); return; }
    setJudgeConfirm(true);
  };
  const runBulkAction = (body: Record<string, unknown>) => {
    if (filterSelection) bulk.mutate({ ...body, filter: filterObject(), expected_count: matching, ...(group === "trace" ? { granularity: "trace" } : {}) });
    else if (group === "trace") bulk.mutate({ ...body, trace_ids: selectedTraceIds, granularity: "trace" });
    else bulk.mutate({ ...body, ids: [...selected] });
  };
  const exportParams = new URLSearchParams(params); exportParams.delete("page"); exportParams.delete("limit");
  const exportRuns = async (format: string, fallback: string) => { try { await downloadFile(`/api/runs/export?${exportParams}&format=${format}`, fallback); } catch (error) { toast.toast((error as Error).message, { type: "error" }); } };

  const sortHeader = (field: string) => {
    const nextDir = sortField === field && sortDir === "desc" ? "asc" : "desc";
    setFilter({ sort: field, dir: nextDir });
  };
  const sortArrow = (field: string) => sortField === field ? (sortDir === "asc" ? " ↑" : " ↓") : "";
  const sortProps = (field: string) => ({
    onClick: () => sortHeader(field),
    onKeyDown: (event: KeyboardEvent<HTMLTableCellElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        sortHeader(field);
      }
    },
    tabIndex: 0,
    "aria-sort": sortField === field ? (sortDir === "asc" ? "ascending" as const : "descending" as const) : undefined,
  });

  const errorRate = stats?.totalRuns ? (stats.errorCount / stats.totalRuns) * 100 : 0;
  const agentOptions = [{ value: "", label: "All agents" }, ...Array.from(new Set(runs.map((run) => run.agent_name).filter(Boolean))).map((agent) => ({ value: String(agent), label: String(agent) }))];
  const modelHints = Array.from(new Set([...runs.map((run) => run.model), params.get("model")].filter((model): model is string => Boolean(model))));
  const providerHints = Array.from(new Set([...runs.map((run) => run.provider), params.get("provider")].filter((provider): provider is string => Boolean(provider))));
  const sourceOptions = [
    { value: "", label: "All sources" },
    ...RUN_SOURCES.map((source) => ({ value: source, label: source === "a2a" ? "A2A" : source.replace(/_/g, " ").replace(/^mcp/i, "MCP") })),
  ];
  const exportMenu = (align: "start" | "end" = "end") => <DropdownMenuContent align={align}>
    <DropdownMenuLabel>Export</DropdownMenuLabel>
    <DropdownMenuItem onSelect={() => void exportRuns("csv", "torrix-runs.csv")}>CSV</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void exportRuns("ndjson", "torrix-runs.ndjson")}>NDJSON</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void exportRuns("jsonl", "torrix-runs.jsonl")}>OpenAI JSONL</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => void exportRuns("slm", "torrix-runs-slm.jsonl")}>SLM JSONL</DropdownMenuItem>
  </DropdownMenuContent>;

  return <>
    <SecretNotice />
    <PageHead title="Runs" sub={`${formatCount(runTotal)} run${runTotal === 1 ? "" : "s"} matched · showing ${formatCount(runs.length)}${group !== "none" ? ` · grouped by ${group}` : ""}`} />

    <div className="stat-tiles runs-stats">
      <div className="stat-tile"><span className="st-label">Runs</span><div className="st-value">{formatCount(runTotal)}</div><div className="st-sub">{formatCount(summary?.agents ?? 0)} agent{summary?.agents === 1 ? "" : "s"} · {formatCount(summary?.subagents ?? 0)} subagent run{summary?.subagents === 1 ? "" : "s"}</div></div>
      {summary?.sessions ? <div className="stat-tile"><span className="st-label">Sessions</span><div className="st-value">{formatCount(summary.sessions)}</div><div className="st-sub">conversations in this view</div></div> : null}
      {summary?.traces ? <div className="stat-tile"><span className="st-label">Traces</span><div className="st-value">{formatCount(summary.traces)}</div><div className="st-sub">end-to-end turns</div></div> : null}
      {stats ? <div className="stat-tile"><span className="st-label">Cost · 30d</span><div className="st-value">{fmtUsd(stats.totalCost)}</div><div className="st-sub">current project scope</div></div> : null}
      {stats ? <div className="stat-tile"><span className="st-label">Error rate</span><div className="st-value">{formatPercent(errorRate)}</div><div className="st-sub">{formatCount(stats.errorCount)} error{stats.errorCount === 1 ? "" : "s"} · {formatCount(stats.flaggedCount)} flagged</div></div> : null}
      {stats && stats.scoredCount > 0 ? <div className="stat-tile"><span className="st-label">{stats.scoredCount >= 10 ? "Mean eval score" : "Scored runs"}</span><div className="st-value">{stats.scoredCount >= 10 ? (stats.avgScore == null ? "-" : stats.avgScore.toFixed(3)) : `${formatCount(stats.scoredCount)} scored`}</div><div className="st-sub">{stats.scoredCount >= 10 ? `${formatCount(stats.scoredCount)} scored runs` : "mean appears at 10 scored runs"}</div></div> : null}
    </div>

    <div className="runs-toolbar">
      <label className="filter-search runs-search">
        <span aria-hidden="true">⌕</span>
        <Input className="h-auto" type="text" aria-label="Search runs" placeholder="Search names, models, notes…" value={search} onChange={(event) => setFilter({ q: event.target.value }, true)} />
      </label>
      <InlineSelect className="filter-select" aria-label="Status filter" value={params.get("status") ?? ""} onValueChange={(value) => setFilter({ status: value })} options={[{ value: "", label: "All statuses" }, { value: "error", label: "Errors" }, { value: "200", label: "Success (200)" }]} />
      <InlineSelect className="filter-select" aria-label="Agent filter" value={params.get("agent") ?? ""} onValueChange={(value) => setFilter({ agent: value })} options={agentOptions} />
      <Button
        variant="outline"
        type="button"
        aria-expanded={filtersOpen}
        aria-controls="filter-panel"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        Filters{filterCount ? ` · ${filterCount}` : ""}
      </Button>
      <InlineSelect className="runs-group" aria-label="Group runs" value={group} onValueChange={(value) => { localStorage.setItem("torrix_run_group", value); setFilter({ group: value }); }} options={GROUPS.map(([label, value]) => ({ value, label }))} />
      <div className="runs-toolbar-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" type="button">Export</Button></DropdownMenuTrigger>
          {exportMenu()}
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" type="button">Columns</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={showColumn("source")} onCheckedChange={() => toggleColumn("source")}>Source</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showColumn("score")} onCheckedChange={() => toggleColumn("score")}>Score</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={showColumn("flags")} onCheckedChange={() => toggleColumn("flags")}>Flags</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" type="button" onClick={() => void runsQuery.refetch()}>Refresh</Button>
        <label className="auto-toggle" htmlFor="runs-auto"><Checkbox id="runs-auto" checked={auto} onCheckedChange={(value) => setAuto(value === true)} /><span>Auto</span></label>
      </div>
    </div>

    {filtersOpen ? <div className="filter-panel" id="filter-panel">
      <div className="filter-field">
        <label htmlFor="rf-model">Model</label>
        <Input id="rf-model" type="text" list="rf-models" autoComplete="off" placeholder="Any model" value={params.get("model") ?? ""} onChange={(event) => setFilter({ model: event.target.value }, true)} />
        <datalist id="rf-models">{modelHints.map((model) => <option key={model} value={model} />)}</datalist>
      </div>
      <div className="filter-field">
        <label htmlFor="rf-provider">Provider</label>
        <Input id="rf-provider" type="text" list="rf-providers" autoComplete="off" placeholder="Any provider" value={params.get("provider") ?? ""} onChange={(event) => setFilter({ provider: event.target.value }, true)} />
        <datalist id="rf-providers">{providerHints.map((name) => <option key={name} value={name} />)}</datalist>
      </div>
      <div className="filter-field">
        <label htmlFor="rf-source">Source</label>
        <InlineSelect id="rf-source" className="filter-control" value={params.get("source") ?? ""} onValueChange={(value) => setFilter({ source: value })} options={sourceOptions} />
      </div>
      <div className="filter-field">
        <label htmlFor="rf-from">From</label>
        <Input id="rf-from" type="date" className="filter-control" value={isoToDay(params.get("from"))} onChange={(event) => setFilter({ from: dayToIso(event.target.value) }, true)} />
      </div>
      <div className="filter-field">
        <label htmlFor="rf-to">To</label>
        <Input id="rf-to" type="date" className="filter-control" value={isoToDay(params.get("to"))} onChange={(event) => setFilter({ to: dayToIso(event.target.value, true) }, true)} />
      </div>
      <div className="filter-field">
        <label htmlFor="rf-tag">Tag</label>
        <Input id="rf-tag" type="text" autoComplete="off" placeholder="Any tag" value={params.get("tag") ?? ""} onChange={(event) => setFilter({ tag: event.target.value }, true)} />
      </div>
      <div className="filter-field">
        <label htmlFor="rf-score">Score</label>
        <InlineSelect id="rf-score" className="filter-control" value={params.get("score") ?? ""} onValueChange={(value) => setFilter({ score: value })} options={[{ value: "", label: "Any score" }, { value: "good", label: "Good" }, { value: "bad", label: "Bad" }, { value: "unscored", label: "Unscored" }]} />
      </div>
      <div className="filter-field">
        <label htmlFor="rf-golden">Golden</label>
        <InlineSelect id="rf-golden" className="filter-control" value={params.get("is_golden") ?? ""} onValueChange={(value) => setFilter({ is_golden: value })} options={[{ value: "", label: "Any" }, { value: "1", label: "Golden only" }, { value: "0", label: "Not golden" }]} />
      </div>
      <div className="filter-field">
        <span className="filter-label">Anomaly</span>
        <label className="filter-check" htmlFor="rf-anomaly"><Checkbox id="rf-anomaly" checked={params.get("anomaly") === "1"} onCheckedChange={(value) => setFilter({ anomaly: value === true ? "1" : "" })} /><span>Only anomalies</span></label>
      </div>
      <div className="filter-field">
        <label htmlFor="rf-end-user">End user</label>
        <Input id="rf-end-user" type="text" autoComplete="off" placeholder="Any end user" value={params.get("end_user") ?? ""} onChange={(event) => setFilter({ end_user: event.target.value }, true)} />
      </div>
      <div className="filter-actions">
        <span className="panel-note">{formatCount(runTotal)} matched</span>
        <Button variant="ghost" type="button" onClick={clearAllFilters} disabled={!activeFilters.length}>Clear all</Button>
        <Button variant="outline" type="button" onClick={() => setFiltersOpen(false)}>Done</Button>
      </div>
    </div> : null}

    {activeFilters.length ? <div className="filter-chips" aria-label="Active filters">
      <span className="filter-cap">Active</span>
      {activeFilters.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-chip"
          aria-label={`Remove ${chip.label} filter: ${chip.value}`}
          onClick={() => setFilter({ [chip.key]: "" })}
        >
          <span className="filter-chip-key">{chip.label}</span>{chip.value}<span aria-hidden="true">×</span>
        </button>
      ))}
      <Button variant="ghost" size="sm" type="button" onClick={clearAllFilters}>Clear all</Button>
    </div> : null}

    {judgeJobId && !selectionCount && !filterSelection ? <div className="action-row mb-3">
      <span className="judge-progress">Judging {jobQuery.data?.job.completed ?? 0} of {jobQuery.data?.job.total ?? 0} {jobQuery.data?.job.kind === "run" ? "runs" : "traces"}<Button variant="ghost" type="button" onClick={() => void api(`/api/runs/judge/${judgeJobId}/stop`, { method: "POST" })}>Stop</Button></span>
    </div> : selectionCount || filterSelection ? <div className="action-row mb-3">
      <span className="panel-note">{filterSelection ? selectNotice : selectionLabel}</span>
      {!filterSelection && selected.size < Math.min(BULK_CAP, matching) ? <Button variant="ghost" type="button" onClick={selectAllMatching}>Select all {formatCount(matching)} matching</Button> : null}
      {selectNotice && !filterSelection ? <span className="panel-note">{selectNotice}</span> : null}
      <Button variant="outline" type="button" onClick={() => runBulkAction({ action: "score", score: "good" })}>Mark good</Button>
      <Button variant="outline" type="button" onClick={() => runBulkAction({ action: "score", score: "bad" })}>Mark bad</Button>
      <Button variant="outline" type="button" onClick={() => runBulkAction({ action: "score", score: "unscored" })}>Clear score</Button>
      <Button variant="outline" type="button" disabled={Boolean(judgeDisabledReason)} title={judgeDisabledReason || "Judge selected traces"} onClick={judgeSelected}>Judge selected</Button>
      {judgeDisabledReason ? <span className="panel-note">{judgeDisabledReason} <Link to="/ui/settings">Open Settings</Link></span> : null}
      <Button variant="outline" type="button" disabled={group === "trace"} title={group === "trace" ? "Switch to an ungrouped list to delete runs." : "Delete selected runs"} onClick={() => {
        if (group === "trace") { toast.toast("Switch to an ungrouped list to delete runs.", { type: "error" }); return; }
        if (filterSelection) { setDeleteConfirm(true); setDeleteText(""); } else runBulkAction({ action: "delete" });
      }}>Delete</Button>
      <Button variant="outline" type="button" disabled={selected.size < 2 || selected.size > 4 || group === "trace"} onClick={() => navigate(`/ui/compare?ids=${encodeURIComponent([...selected].slice(0, 4).join(","))}`)}>Compare</Button>
      {judgeJobId && jobQuery.data?.job ? <span className="judge-progress">Judging {jobQuery.data.job.completed} of {jobQuery.data.job.total} {jobQuery.data.job.kind === "run" ? "runs" : "traces"}<Button variant="ghost" type="button" onClick={() => void api(`/api/runs/judge/${jobQuery.data!.job.id}/stop`, { method: "POST" })}>Stop</Button></span> : null}
    </div> : null}

    {judgeConfirm ? <Modal title={judgeKind === "trace" ? "Judge selected traces" : "Judge selected runs"} onClose={() => setJudgeConfirm(false)}>
      {previewQuery.isPending ? <p className="panel-note">Estimating judge work.</p> : previewQuery.isError ? <p className="field-error">{previewQuery.error.message}</p> : previewQuery.data ? <div className="judge-confirm">
        {previewQuery.data.kind === "run"
          ? <p>{formatCount(previewQuery.data.runs ?? 0)} run{(previewQuery.data.runs ?? 0) === 1 ? "" : "s"}, about {formatCount(previewQuery.data.tokens_per_run ?? 0)} judge tokens each, about {fmtUsd(previewQuery.data.estimated_usd)}.</p>
          : <p>{formatCount(previewQuery.data.traces)} trace{previewQuery.data.traces === 1 ? "" : "s"}, about {formatCount(previewQuery.data.tokens_per_trace ?? 0)} judge tokens each, about {fmtUsd(previewQuery.data.estimated_usd)}.</p>}
        {previewQuery.data.kind === "trace" && previewQuery.data.skipped ? <p className="field-hint">{formatCount(previewQuery.data.skipped)} already judged will be skipped.</p> : null}
        {previewQuery.data.kind === "trace" ? <label className="flex items-center gap-2 text-[13px] text-text-2"><Checkbox checked={rejudge} onCheckedChange={(value) => setRejudge(value === true)} /> Re-judge traces that already have a score</label> : null}
        <div className="modal-actions">
          <Button variant="outline" type="button" onClick={() => setJudgeConfirm(false)}>Cancel</Button>
          <Button type="button" disabled={bulk.isPending} onClick={() => {
            if (filterSelection) bulk.mutate({ action: "judge", kind: judgeKind, filter: filterObject(), expected_count: matching, rejudge });
            else if (judgeKind === "trace") bulk.mutate({ action: "judge", trace_ids: selectedTraceIds, rejudge });
            else bulk.mutate({ action: "judge", kind: "run", ids: [...selected], rejudge });
          }}>Start judging</Button>
        </div>
      </div> : null}
    </Modal> : null}

    {deleteConfirm ? <Modal title="Delete matching runs" onClose={() => setDeleteConfirm(false)}>
      <p>This deletes <b>{formatCount(matching)}</b> runs. Type <b>{formatCount(matching)}</b> to confirm.</p>
      <Input aria-label="Type the run count to confirm deletion" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder={formatCount(matching)} autoFocus />
      <div className="modal-actions">
        <Button variant="outline" type="button" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
        <Button variant="outline" type="button" disabled={deleteText.trim() !== String(matching) || bulk.isPending} onClick={() => bulk.mutate({ action: "delete", filter: filterObject(), expected_count: matching })}>Delete {formatCount(matching)}</Button>
      </div>
    </Modal> : null}

    <section className="panel mb-4">
      <div className="table-wrap"><table className="table-fixed w-full wide-table runs-table" data-test="primary">
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: "8%" }} />
          <col />
          <col style={{ width: "13%" }} />
          {showColumn("source") ? <col style={{ width: "9%" }} /> : null}
          <col style={{ width: "8%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} />
          {showColumn("score") ? <col style={{ width: "6%" }} /> : null}
          {showColumn("flags") ? <col style={{ width: "11%" }} /> : null}
        </colgroup>
        <thead><tr>
          <th style={{ width: 30 }}>{group === "trace" ? null : <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={toggleAll} />}</th>
          <th className="sortable" {...sortProps("created")}>Time{sortArrow("created")}</th>
          <th>Run</th><th>Agent</th>{showColumn("source") ? <th data-priority="low">Source</th> : null}<th>Status</th>
          <th className="num sortable" {...sortProps("tokens")}>Tokens{sortArrow("tokens")}</th>
          <th className="num sortable" {...sortProps("cost")}>Cost{sortArrow("cost")}</th>
          <th className="num sortable" {...sortProps("latency")}>Latency{sortArrow("latency")}</th>
          {showColumn("score") ? <th className="sortable" data-priority="low" {...sortProps("score")}>Score{sortArrow("score")}</th> : null}
          {showColumn("flags") ? <th data-priority="low">Flags</th> : null}
        </tr></thead>
        <tbody>
          {runs.length ? runs.map((run, index) => {
            const failed = !!run.status && run.status >= 400;
            const counts = eventMap.get(run.id);
            const groupId = group === "session" ? run.session_id : run.trace_id;
            const showGroup = group !== "none" && (index === 0 || (group === "session" ? runs[index - 1].session_id !== run.session_id : runs[index - 1].trace_id !== run.trace_id));
            return <FragmentRow key={run.id} run={run} group={group} groupId={groupId} aggregate={groupId ? groupInfo.get(groupId) : undefined} showGroup={showGroup} selected={selected.has(run.id)} onToggle={() => toggle(run.id)} selectedTrace={Boolean(groupId && selectedTraces.has(groupId))} onToggleTrace={() => groupId && toggleTrace(groupId)} failed={failed} counts={counts} firstTool={firstToolMap.get(run.id)} hiddenCols={hiddenCols} />;
          }) : <EmptyRow colSpan={visibleColumns}>
            <span>No runs match these filters{activeFilters.length ? `: ${activeFilterNames(activeFilters)}` : ""}. </span>
            {activeFilters.length
              ? <Button variant="ghost" size="sm" type="button" onClick={clearAllFilters}>Clear all filters</Button>
              : <span>Send a run through the proxy to see it here.</span>}
          </EmptyRow>}
        </tbody>
      </table></div>
      <div className="pager">
        {group === "none" ? <span>Showing <b>{data.total ? (page - 1) * data.limit + 1 : 0}–{Math.min(page * data.limit, data.total)}</b> of <b>{data.total}</b></span> : <span>Groups <b>{groupTotal ? groupPage * groupLimit + 1 : 0}–{Math.min((groupPage + 1) * groupLimit, groupTotal)}</b> of <b>{groupTotal}</b> · showing <b>{runs.length}</b> runs</span>}
        <div className="pager-links">
          {group === "none" ? <>
            {page > 1 ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.set("page", String(page - 1)); return current; })}>← Prev</Button> : <span>← Prev</span>}
            {page > 1 ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.delete("page"); return current; })}>Top</Button> : null}
            {page < pageCount ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.set("page", String(page + 1)); return current; })}>Next →</Button> : <span>Next →</span>}
          </> : <>
            {groupPage > 0 ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.set("gpage", String(groupPage - 1)); return current; })}>← Prev</Button> : <span>← Prev</span>}
            {groupPage > 0 ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.delete("gpage"); return current; })}>Top</Button> : null}
            {groupPage + 1 < groupPages ? <Button variant="ghost" type="button" onClick={() => setParams((current) => { current.set("gpage", String(groupPage + 1)); return current; })}>Next →</Button> : <span>Next →</span>}
          </>}
        </div>
      </div>
    </section>
  </>;
}

function FragmentRow({ run, group, groupId, aggregate, showGroup, selected, onToggle, selectedTrace, onToggleTrace, failed, counts, firstTool, hiddenCols }: {
  run: Run;
  group: string;
  groupId?: string | null;
  aggregate?: TraceGroup;
  showGroup: boolean;
  selected: boolean;
  onToggle: () => void;
  selectedTrace: boolean;
  onToggleTrace: () => void;
  failed: boolean;
  counts?: { tools: number; think: boolean; response: boolean };
  firstTool?: string;
  hiddenCols: Set<string>;
}) {
  const spanMs = aggregate ? Math.max(0, Date.parse(aggregate.lastAt) - Date.parse(aggregate.firstAt)) : 0;
  const fullStep = firstTool ? toolLabel(firstTool) : counts?.think ? "Thinking" : counts?.response ? "Answer" : run.name || run.id.slice(0, 8);
  const step = fullStep.length > 60 ? `${fullStep.slice(0, 57)}...` : fullStep;
  const toolName = firstTool ? toolStep(firstTool).name : null;
  const prompt = userPrompt(run.request_body) ?? run.name ?? "";
  const toolExtra = counts?.tools && counts.tools > 1 ? ` +${counts.tools - 1}` : "";
  return <>
    {showGroup ? <tr className="group-row"><td colSpan={11 - hiddenCols.size}><div className="group-head-row">
      {group === "trace" ? <Checkbox aria-label={`Select trace ${groupId ?? ""}`} checked={selectedTrace} onCheckedChange={onToggleTrace} /> : null}
      <span className="group-kind">{group === "session" ? "session" : "trace"}</span>
      <Link className="group-id" to={`/ui/${group === "session" ? "sessions" : "traces"}/${encodeURIComponent(groupId ?? "")}`}>{groupId?.slice(0, 12)}</Link>
      {aggregate ? <span className="group-meta">
        {group === "trace" && aggregate.trace_score != null ? <span className={`badge ${aggregate.trace_score === 1 ? "good" : "bad"}`} title={aggregate.trace_score_reason ?? ""}>{aggregate.trace_score === 1 ? "Good" : "Bad"}</span> : null}
        {group === "session" && aggregate.session_judged ? <span className="badge neutral" title={`${aggregate.session_good ?? 0} of ${aggregate.session_judged} traces good`}>{Math.round(((aggregate.session_good ?? 0) / aggregate.session_judged) * 100)}% good</span> : null}
        {group === "trace" && aggregate.first_failing_run_id ? <Link className="quiet-link" to={`/ui/runs/${encodeURIComponent(aggregate.first_failing_run_id)}`}>first failing step</Link> : null}
        <span className="chip">{aggregate.runs} run{aggregate.runs === 1 ? "" : "s"}</span>
        {aggregate.subagents ? <span className="chip">{aggregate.subagents} subagent{aggregate.subagents === 1 ? "" : "s"}</span> : null}
        <span className="chip">{fmtUsd(aggregate.cost)}</span>
        {spanMs ? <span className="chip">{fmtMs(spanMs)}</span> : null}
        {aggregate.errorCount ? <span className="chip">{aggregate.errorCount} error{aggregate.errorCount === 1 ? "" : "s"}</span> : null}
      </span> : null}
    </div></td></tr> : null}
    <tr className={[failed ? "row-error" : "", selected ? "row-selected" : ""].filter(Boolean).join(" ") || undefined}>
      <td>{group === "trace" ? null : <Checkbox aria-label="Select run" checked={selected} onCheckedChange={onToggle} />}</td>
      <td className="tcell-muted whitespace-nowrap tnum" title={formatDateTime(run.created_at)}>{relTime(run.created_at)}</td>
      <td className="run-cell">
        <Link className="tcell-primary" to={`/ui/runs/${run.id}`} title={fullStep}>{step}</Link>
        <small className="tcell-sub" title={prompt}>{run.model || "unknown model"}{run.parent_run_id ? <> · <Link to={`/ui/traces/${encodeURIComponent(run.trace_id ?? "")}`} onClick={(event) => event.stopPropagation()}>trace …{(run.trace_id ?? "").slice(-8)}</Link></> : null}</small>
      </td>
      <td>{run.agent_name ? <span className="chip agent-chip" title={run.agent_name} style={{ boxShadow: `inset 2px 0 0 var(${agentColorToken(run.agent_name)})` }}>{run.agent_name}</span> : <span className="panel-note">-</span>}</td>
      {!hiddenCols.has("source") ? <td data-priority="low">{run.source || "direct"}</td> : null}
      <td><span className={`badge ${failed ? "bad" : "good"}`}><span className="dot" />{failed ? run.status : "OK"}</span></td>
      <td className="num">{compact((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}</td>
      <td className="num">{fmtUsd(run.cost_usd)}</td>
      <td className="num">{fmtMs(run.latency_ms)}</td>
      {!hiddenCols.has("score") ? <td data-priority="low">{run.score === 1 ? <span className="score-badge good">good</span> : run.score === 0 ? <span className="score-badge bad">bad</span> : <span className="score-badge none">-</span>}</td> : null}
      {!hiddenCols.has("flags") ? <td data-priority="low" style={{ whiteSpace: "nowrap" }}>
        {run.is_golden ? <span className="chip" title="golden">★</span> : null}
        {run.pii_masked ? <span className="chip" title="PII masked">PII</span> : null}
        {run.policy_flags && run.policy_flags !== "[]" ? <span className="chip" title="policy flagged">⚑</span> : null}
        {run.parent_run_id ? <span className="chip">sub</span> : null}
        {run.media_count ? <span className="chip">{run.media_count} media</span> : null}
        {counts?.tools ? <span className="chip" title={`${counts.tools} tool call${counts.tools === 1 ? "" : "s"}`}>{toolName ? `${toolName}${toolExtra}` : `${counts.tools} tools`}</span> : null}
        {counts?.think ? <span className="chip">think</span> : null}
        {run.review_state ? <span className="chip">{run.review_state}</span> : null}
      </td> : null}
    </tr>
  </>;
}
