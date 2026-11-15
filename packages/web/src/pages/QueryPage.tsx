import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type QueryResult, type SettingsPermissions } from "../api";
import { PageHead, Panel } from "../components";

const DEFAULT_SQL = `SELECT model, COUNT(*) AS runs, ROUND(SUM(cost_usd), 4) AS cost
FROM runs
GROUP BY model
ORDER BY cost DESC`;

export default function QueryPage() {
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: () => api<SettingsPermissions>("/api/settings/permissions") });
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState<QueryResult | null>(null);
  const run = useMutation({
    mutationFn: () => api<QueryResult>("/api/query", { method: "POST", body: JSON.stringify({ sql }) }),
    onSuccess: setResult,
    onError: () => setResult(null),
  });

  if (permissions.isPending) return <div className="startup loading-page"><span>Loading SQL console…</span></div>;
  if (permissions.isError) return <div className="empty mt-6.5"><span className="empty-title">Could not load the console</span><span className="empty-sub">{permissions.error.message}</span></div>;
  if (!permissions.data.is_admin) return <div className="empty mt-6.5"><span className="empty-title">Admins only</span><span className="empty-sub">The SQL console is restricted to administrators.</span></div>;

  const columns = result?.columns ?? [];
  return <>
    <PageHead title="SQL console" sub="Read-only queries against the Torrix store: one SELECT or WITH statement, capped at 500 rows. Writes are rejected." />
    <Panel title="Query">
      <Textarea
        value={sql}
        rows={7}
        spellCheck={false}
        onChange={(event) => setSql(event.target.value)}
        className="max-w-none font-mono text-[12.5px] leading-[1.6]"
      />
      <div className="action-row mt-2.5">
        <Button type="button" disabled={run.isPending || !sql.trim()} onClick={() => run.mutate()}>{run.isPending ? "Running…" : "Run query"}</Button>
        <Button variant="outline" type="button" onClick={() => { setResult(null); run.reset(); }}>Clear</Button>
        <span className="panel-note">{run.isError ? run.error.message : result ? `${result.rowCount} row(s) · ${result.elapsedMs} ms${result.truncated ? " · truncated to 500" : ""}` : ""}</span>
      </div>
    </Panel>
    {result ? <Panel flush title="Result" note={`${result.rowCount} rows`}>
      <div className="table-wrap" style={{ maxHeight: 520, overflow: "auto" }}><table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {result.rows.length ? result.rows.map((row, index) => <tr key={index}>{columns.map((column) => {
            const value = row[column];
            const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
            return <td key={column} className="mono" title={text} style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</td>;
          })}</tr>) : <tr><td colSpan={Math.max(1, columns.length)} className="panel-note" style={{ padding: 16, textAlign: "center" }}>No rows.</td></tr>}
        </tbody>
      </table></div>
    </Panel> : null}
  </>;
}
