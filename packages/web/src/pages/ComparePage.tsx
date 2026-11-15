import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageError, PageLoading } from "./DashboardPage";
import { api, compact, fmtMs, fmtUsd, type Run, type RunEvent } from "../api";
import { formatDateTime } from "../api";
import { PageHead, Panel } from "../components";

type Entry = { run: Run; events: RunEvent[] };

const FIELDS: Array<[string, (run: Run) => string]> = [
  ["Name", (run) => run.name ?? "-"],
  ["Created", (run) => formatDateTime(run.created_at)],
  ["Model", (run) => run.model ?? "-"],
  ["Provider", (run) => run.provider ?? "-"],
  ["Source", (run) => run.source ?? "-"],
  ["Status", (run) => (run.status == null ? "-" : String(run.status))],
  ["Tokens", (run) => compact((run.input_tokens ?? 0) + (run.output_tokens ?? 0))],
  ["Cost", (run) => fmtUsd(run.cost_usd)],
  ["Latency", (run) => fmtMs(run.latency_ms)],
  ["Score", (run) => (run.score == null ? "-" : run.score >= 1 ? "good" : "bad")],
  ["Agent", (run) => run.agent_name ?? "-"],
  ["Session", (run) => (run.session_id ? run.session_id.slice(0, 22) : "-")],
  ["Trace", (run) => (run.trace_id ? run.trace_id.slice(0, 22) : "-")],
];

export default function ComparePage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 4);
  const query = useQuery({
    queryKey: ["compare", ids.join(",")],
    queryFn: () => api<{ runs: Entry[] }>(`/api/runs/compare?ids=${encodeURIComponent(ids.join(","))}`),
    enabled: ids.length >= 2,
  });

  if (ids.length < 2) {
    return <div className="empty mt-6.5"><span className="empty-title">Nothing to compare</span><span className="empty-sub">Open the Runs page, select two to four runs, then choose Compare.</span></div>;
  }
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const entries = query.data.runs;

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/runs">← All runs</Link></div>
    <PageHead title="Compare runs" sub={`${entries.length} runs side by side · prompts and responses stay on this host`} />
    <Panel flush>
      <div className="table-wrap"><table>
        <thead><tr><th>Field</th>{entries.map((entry) => <th key={entry.run.id}>
          <Link to={`/ui/runs/${entry.run.id}`}>{entry.run.name ?? entry.run.id}</Link>
          <small className="tcell-sub mono">{entry.run.id.slice(0, 8)}</small>
        </th>)}</tr></thead>
        <tbody>
          {FIELDS.map(([label, read]) => <tr key={label}>
            <td className="tcell-muted">{label}</td>
            {entries.map((entry) => <td key={entry.run.id}>{read(entry.run)}</td>)}
          </tr>)}
        </tbody>
      </table></div>
    </Panel>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
      {entries.map((entry) => {
        const responses = entry.events.filter((event) => event.type === "response");
        const text = responses.map((event) => event.message).join("\n\n");
        return <Panel key={entry.run.id} title={entry.run.name ?? entry.run.id} note={`${responses.length} response event${responses.length === 1 ? "" : "s"}`}>
          {text ? <pre className="rd-code" style={{ maxHeight: 420 }}>{text.length > 6000 ? `${text.slice(0, 6000)}…` : text}</pre> : <div className="empty-value"><p>No response recorded.</p><span className="field-hint">This run has no response event.</span></div>}
        </Panel>;
      })}
    </div>
  </>;
}
