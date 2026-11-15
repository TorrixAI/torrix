import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtMs, fmtUsd, relTime, userPrompt, type TraceGroup, type TracesResponse } from "../api";
import { formatCount } from "../api";
import { InlineSelect, SkeletonRows } from "../components";
import { activeRunFilters, clearRunFilters, dayToIso, isoToDay, RUN_SOURCES } from "../lib/runFilters";
import { useDebouncedValue } from "../lib/useDebouncedValue";


export default function TracesPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"all" | "sessions" | "traces">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hideSingle = params.get("singles") !== "1";
  const [auto, setAuto] = useState(() => localStorage.getItem("torrix_auto_refresh") === "1");
  useEffect(() => { localStorage.setItem("torrix_auto_refresh", auto ? "1" : "0"); }, [auto]);

  const search = params.get("q") ?? "";
  const activeFilters = activeRunFilters(params);
  const filterCount = activeFilters.filter((chip) => chip.key !== "q").length;
  const setFilter = (patch: Record<string, string>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) { value ? next.set(key, value) : next.delete(key); }
    // A new filter starts at the first page of each list.
    next.delete("spage");
    next.delete("tpage");
    setParams(next, { replace });
  };
  const setPage = (kind: "session" | "trace", page: number) => {
    const key = kind === "session" ? "spage" : "tpage";
    const next = new URLSearchParams(params);
    if (page > 1) next.set(key, String(page)); else next.delete(key);
    setParams(next);
  };
  const clearAllFilters = () => setParams(clearRunFilters(params));

  // The URL is immediate so views stay deep-linkable, but the request waits
  // for typing to settle instead of firing once per keystroke.
  const apiParams = new URLSearchParams(params);
  if (hideSingle && !activeFilters.length) apiParams.set("multi", "1");
  else apiParams.delete("multi");
  const queryKey = useDebouncedValue(apiParams.toString(), 250);
  const query = useQuery({
    queryKey: ["traces", queryKey],
    queryFn: () => api<TracesResponse>(`/api/traces${queryKey ? `?${queryKey}` : ""}`),
    // Keep the toolbar mounted while a debounced filter request is in flight,
    // so the text inputs keep focus and every typed character.
    placeholderData: keepPreviousData,
    refetchInterval: auto ? 15000 : false,
  });

  const sessions = query.data?.sessions ?? [];
  const traces = query.data?.traces ?? [];
  const roots = query.data?.roots ?? {};
  // Single-run hiding happens in the group query so pages contain only the
  // groups a user can actually see. Filters narrow a group's runs, so the
  // toggle is disabled while filtering (a busy trace can have one matching step).
  const filtersActive = activeFilters.length > 0;
  const shownSessions = sessions;
  const shownTraces = traces;
  const totalSessions = query.data?.totals?.sessions ?? sessions.length;
  const totalTraces = query.data?.totals?.traces ?? traces.length;
  const groupLimit = query.data?.paging?.limit ?? 50;
  const sessionPage = query.data?.paging?.sessions.page ?? 1;
  const tracePage = query.data?.paging?.traces.page ?? 1;
  const sessionPages = Math.max(1, Math.ceil(totalSessions / groupLimit));
  const tracePages = Math.max(1, Math.ceil(totalTraces / groupLimit));
  // The footer and tab counts follow the visible tab; without this, the
  // Sessions tab reported the traces it was not showing.
  const tabShown = tab === "sessions" ? shownSessions.length : tab === "traces" ? shownTraces.length : shownSessions.length + shownTraces.length;
  const tabTotal = tab === "sessions" ? totalSessions : tab === "traces" ? totalTraces : totalSessions + totalTraces;
  const shownGroups = tabShown;
  const totalGroups = tabTotal;
  const agentHints = Array.from(new Set([...sessions, ...traces].flatMap((group) => group.agents).filter(Boolean))).sort();
  const modelHints = Array.from(new Set([...sessions, ...traces].flatMap((group) => group.models).filter(Boolean))).sort();
  const sourceOptions = [
    { value: "", label: "All sources" },
    ...RUN_SOURCES.map((source) => ({ value: source, label: source === "a2a" ? "A2A" : source.replace(/_/g, " ").replace(/^mcp/i, "MCP") })),
  ];
  const countLabel = `${formatCount(shownGroups)} of ${formatCount(totalGroups)} groups${!filtersActive && hideSingle ? " · single-run hidden" : ""}`;

  if (query.isError) return <div className="startup"><span>Could not load traces: {query.error.message}</span></div>;
  if (!query.data) return <>
    <div className="page-head"><div><h1>Traces & Sessions</h1><p className="page-sub">Loading traces.</p></div></div>
    <div className="panel"><div className="table-wrap"><table data-test="primary">
      <thead><tr><th>Last activity</th><th>Trace</th><th>Root agent</th><th>Agents</th><th className="num">Runs</th><th className="num">Cost</th><th className="num">Errors</th></tr></thead>
      <tbody><SkeletonRows columns={7} rows={6} /></tbody>
    </table></div></div>
  </>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Traces & Sessions</h1>
          <p className="page-sub">
            Sessions group whole multi-turn conversations; traces follow agent execution, including spawned subagents.
          </p>
        </div>
        <div className="head-actions">
          <ToggleGroup type="single" value={tab} onValueChange={(value) => { if (value) setTab(value as "all" | "sessions" | "traces"); }}>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="sessions">Sessions ({formatCount(totalSessions)})</ToggleGroupItem>
            <ToggleGroupItem value="traces">Traces ({formatCount(totalTraces)})</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" type="button" onClick={() => void query.refetch()}>
            Refresh
          </Button>
          <label className="flex items-center gap-2 text-[12.5px] text-text-2">
            <Checkbox checked={auto} onCheckedChange={(value) => setAuto(value === true)} />
            <span>Auto · 15s</span>
          </label>
        </div>
      </div>

      <div className="trace-filters mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Filter groups"
          placeholder="Search trace id, agent, model or prompt"
          className="max-w-[320px]"
          value={search}
          onChange={(event) => setFilter({ q: event.target.value }, true)}
        />
        <InlineSelect className="filter-select" aria-label="Status filter" value={params.get("status") ?? ""} onValueChange={(value) => setFilter({ status: value })} options={[{ value: "", label: "All statuses" }, { value: "error", label: "Errors" }, { value: "200", label: "Success (200)" }]} />
        <Input
          aria-label="Agent filter"
          list="trace-agents"
          autoComplete="off"
          placeholder="Any agent"
          className="max-w-[190px]"
          value={params.get("agent") ?? ""}
          onChange={(event) => setFilter({ agent: event.target.value }, true)}
        />
        <datalist id="trace-agents">{agentHints.map((agent) => <option key={agent} value={agent} />)}</datalist>
        <Button
          variant="outline"
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="trace-filter-panel"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{filterCount ? ` · ${filterCount}` : ""}
        </Button>
        <label className="flex items-center gap-2 text-[12.5px] text-text-2" style={{ opacity: filtersActive ? 0.55 : 1 }} title={filtersActive ? "Clear the filters to hide single-run groups" : "Hide groups with one run"}>
          <Checkbox checked={hideSingle} disabled={filtersActive} onCheckedChange={(value) => setFilter({ singles: value === true ? "" : "1" })} />
          <span>hide single-run</span>
        </label>
        <span className="panel-note">{countLabel}</span>
      </div>

      {filtersOpen ? <div className="filter-panel" id="trace-filter-panel">
        <div className="filter-field">
          <label htmlFor="tf-model">Model</label>
          <Input id="tf-model" type="text" list="trace-models" autoComplete="off" placeholder="Any model" value={params.get("model") ?? ""} onChange={(event) => setFilter({ model: event.target.value }, true)} />
          <datalist id="trace-models">{modelHints.map((model) => <option key={model} value={model} />)}</datalist>
        </div>
        <div className="filter-field">
          <label htmlFor="tf-source">Source</label>
          <InlineSelect id="tf-source" className="filter-control" value={params.get("source") ?? ""} onValueChange={(value) => setFilter({ source: value })} options={sourceOptions} />
        </div>
        <div className="filter-field">
          <label htmlFor="tf-from">From</label>
          <Input id="tf-from" type="date" className="filter-control" value={isoToDay(params.get("from"))} onChange={(event) => setFilter({ from: dayToIso(event.target.value) }, true)} />
        </div>
        <div className="filter-field">
          <label htmlFor="tf-to">To</label>
          <Input id="tf-to" type="date" className="filter-control" value={isoToDay(params.get("to"))} onChange={(event) => setFilter({ to: dayToIso(event.target.value, true) }, true)} />
        </div>
        <div className="filter-actions">
          <span className="panel-note">{formatCount(shownGroups)} of {formatCount(totalGroups)} groups</span>
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

      {(tab === "all" || tab === "sessions") && (
        <TraceGroupPanel title="Sessions" note="grouped by session_id" kind="session" groups={shownSessions} roots={roots} empty={sessions.length > 0} filtered={filtersActive} page={sessionPage} pages={sessionPages} total={totalSessions} limit={groupLimit} onPage={(next) => setPage("session", next)} />
      )}

      {(tab === "all" || tab === "traces") && (
        <TraceGroupPanel title="Traces" note="grouped by trace_id" kind="trace" groups={shownTraces} roots={roots} empty={traces.length > 0} filtered={filtersActive} page={tracePage} pages={tracePages} total={totalTraces} limit={groupLimit} onPage={(next) => setPage("trace", next)} />
      )}
    </>
  );
}

function TraceGroupPanel({
  title,
  note,
  kind,
  groups,
  roots,
  empty,
  filtered = false,
  page,
  pages,
  total,
  limit,
  onPage,
}: {
  title: string;
  note: string;
  kind: "session" | "trace";
  groups: TraceGroup[];
  roots: NonNullable<TracesResponse["roots"]>;
  empty: boolean;
  filtered?: boolean;
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="panel mb-4.5">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-note">{note}</span>
      </div>
      <div className="table-wrap">
        <table className="wide-table traces-table" data-test="primary">
          <thead>
            <tr>
              <th>Last activity</th>
              <th>{kind === "session" ? "Session" : "Trace"}</th>
              <th>Root agent</th>
              <th>Agents</th>
              <th className="num" title={filtered ? "Runs matching the filter; cost, duration and errors reflect those runs" : undefined}>Runs</th>
              <th className="num" data-priority="low">Subagents</th>
              <th className="num" data-priority="low">Duration</th>
              <th className="num">Cost</th>
              <th className="num">Errors</th>
            </tr>
          </thead>
          <tbody>
            {groups.length ? (
              groups.map((group) => {
                const targetUrl = `/ui/${kind}s/${encodeURIComponent(group.id)}`;
                const root = roots[group.id];
                const prompt = userPrompt(root?.requestBody);
                const spanMs = Math.max(0, (Date.parse(group.lastAt) || 0) - (Date.parse(group.firstAt) || 0));
                return (
                  <tr key={group.id} className="clickable">
                    <td className="tnum" style={{ color: "var(--text-3)", fontSize: "11.5px" }}>
                      {relTime(group.lastAt)}
                    </td>
                    <td>
                      <Link to={targetUrl} className="text-[12px] tcell-primary mono" title={group.id}>
                        {group.id.length > 22 ? `${group.id.slice(0, 22)}…` : group.id}
                      </Link>
                      {prompt ? <span className="tcell-sub" style={{ whiteSpace: "normal", overflowWrap: "break-word" }} title={prompt}>{prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt}</span> : null}
                      <span className="cell-truncate tcell-sub" title={group.models.join(", ")}>
                        {group.models[0]}
                        {group.models.length > 1 ? ` +${group.models.length - 1}` : ""}
                      </span>
                    </td>
                    <td>{root?.agentName ? <span className="chip">{root.agentName}</span> : <span className="panel-note">-</span>}</td>
                    <td>
                      {group.agents.length ? (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {group.agents.slice(0, 3).map((agent) => (
                            <span key={agent} className="chip">
                              {agent}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="panel-note">-</span>
                      )}
                    </td>
                    <td className="num" title={filtered ? `${formatCount(group.runs)} matching run${group.runs === 1 ? "" : "s"}` : undefined}>{formatCount(group.runs)}</td>
                    <td className="num" data-priority="low">{formatCount(group.subagents)}</td>
                    <td className="num" data-priority="low">{spanMs ? fmtMs(spanMs) : "-"}</td>
                    <td className="num">{fmtUsd(group.cost)}</td>
                    <td className="num">
                      {(group.runs > 0 ? (group.errorCount / group.runs) * 100 : 0) >= 5 ? (
                        <span className="badge bad">
                          <span className="dot" />
                          {formatCount(group.errorCount)}
                        </span>
                      ) : (
                        <span className="error-plain">{formatCount(group.errorCount)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="p-[14px] panel-note">
                  {empty ? `No ${kind}s match these filters; clear a filter or include single runs.` : `No ${kind}s yet; send a run through the proxy.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? <div className="group-pager flex flex-wrap items-center gap-2" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
        <span className="panel-note">
          Showing groups {formatCount((page - 1) * limit + 1)}–{formatCount(Math.min(page * limit, total))} of {formatCount(total)}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="outline" size="sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div> : null}
    </div>
  );
}
