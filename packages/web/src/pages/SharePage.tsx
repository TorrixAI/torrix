import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, fmtMs, fmtUsd, type Run, type RunEvent } from "../api";
import { formatCount, formatDateTime } from "../api";
import { Icon, ThemeToggle } from "../icons";
import { toolStep } from "../lib/conversation";

interface ShareRun extends Run {
  pii_masked?: boolean | number | null;
}

export default function SharePage() {
  const { token = "" } = useParams();
  const query = useQuery({
    queryKey: ["share", token],
    queryFn: () => api<{ run: ShareRun; events: RunEvent[] }>(`/api/share/${encodeURIComponent(token)}`),
    retry: false,
  });

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("torrix_theme", next);
  };

  const brand = (
    <div className="share-brand">
      <span className="ico"><Icon name="logo" /></span>
      <span>Torrix · shared run</span>
      <ThemeToggle onClick={toggleTheme} />
    </div>
  );

  if (query.isPending) {
    return <div className="share-page">{brand}<div className="share-error"><b>Loading…</b></div></div>;
  }

  if (query.isError) {
    const message = query.error.message === "share_expired" ? "This share link has expired." : "This share link is invalid or has been revoked.";
    return <div className="share-page">{brand}<div className="share-error"><b>Link unavailable</b>{message}</div><div className="share-foot">Torrix: self-hosted LLM observability</div></div>;
  }

  const { run, events } = query.data;
  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
  const cells: Array<[string, string]> = [
    ["Model", run.model ?? "-"],
    ["Provider", run.provider ?? "-"],
    ["Source", run.source ?? "-"],
    ["Created", formatDateTime(run.created_at)],
    ["Status", run.status != null ? String(run.status) : "-"],
    ["Total tokens", formatCount(totalTokens)],
    ["Cost", fmtUsd(run.cost_usd)],
    ["Latency", fmtMs(run.latency_ms)],
  ];

  return <div className="share-page">
    {brand}
    <div className="page-head mb-3.5">
      <div>
        <h1>{run.name || run.model || "Shared run"}</h1>
        <div className="rh-chips mt-2">
          <span className="badge accent"><span className="dot" />{run.model ?? "unknown model"}</span>
          {run.pii_masked ? <span className="badge">PII masked</span> : null}
        </div>
      </div>
    </div>
    <section className="metagrid">
      {cells.map(([label, value]) => <div className="cell" key={label}><span className="meta-label">{label}</span><div className="meta-val mono">{value}</div></div>)}
    </section>
    <section className="panel">
      <div className="panel-head"><div className="panel-title"><span className="sig" />Events</div><span className="panel-note">{events.length} captured</span></div>
      {events.length ? <div className="timeline" style={{ padding: "0 18px" }}>{events.map((event, index) => {
        const step = event.type === "tool_call" ? toolStep(event.message) : null;
        return <div className="t-item" key={event.id ?? `${event.type}-${index}`}><div className="t-head"><span className="t-type">{event.type.replace(/_/g, " ")}</span><span className="t-time">{formatDateTime(event.created_at)}</span></div><div className="t-msg">{step ? <><b>{step.name}</b>{step.detail ? <span> {step.detail}</span> : null}</> : event.message || "(empty)"}</div></div>;
      })}</div> : <div className="panel-body"><span className="panel-note">No events recorded.</span></div>}
    </section>
    <div className="share-foot">Shared read-only view · data stays on the operator&apos;s host</div>
  </div>;
}
