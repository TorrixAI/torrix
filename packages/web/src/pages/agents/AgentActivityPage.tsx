import { Button } from "@/components/ui/button";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { api, relTime, shortStamp, fmtMs, formatCount, type Agent, type AuthorizationDecisionRecord } from "../../api";
import { formatDateTime } from "../../api";
import { DecisionStrip, EmptyRow, EvidenceChip, InlineSelect, PageHead, Panel } from "../../components";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { PageError, PageLoading } from "../DashboardPage";
import { AgentNav, agentLabel, badgeClass } from "./shared";

const DECISIONS = ["", "allow", "deny", "require_approval"];
const PROTOCOLS = ["", "rest", "sdk", "mcp", "a2a"];

export default function AgentActivityPage() {
  const [decision, setDecision] = useState("");
  const [agentId, setAgentId] = useState("");
  const [action, setAction] = useState("");
  const [protocol, setProtocol] = useState("");
  const [page, setPage] = useState(1);
  const debouncedAction = useDebouncedValue(action, 250);
  const params = new URLSearchParams({ page: String(page), limit: "50" });
  if (decision) params.set("decision", decision);
  if (agentId) params.set("agent_id", agentId);
  if (debouncedAction) params.set("action", debouncedAction);
  if (protocol) params.set("protocol", protocol);
  const query = useQuery({
    queryKey: ["decisions", decision, agentId, debouncedAction, protocol, page],
    queryFn: () => api<{ decisions: AuthorizationDecisionRecord[]; total: number; page: number; limit: number }>(`/api/v1/decisions?${params}`),
    placeholderData: keepPreviousData,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/api/v1/agents") });
  if (query.isError) return <PageError message={query.error.message} />;
  if (!query.data) return <PageLoading />;
  const decisions = query.data.decisions;
  const agentList = agents.data?.agents ?? [];
  const pageCount = Math.max(1, Math.ceil(query.data.total / query.data.limit));

  return <>
    <PageHead title="Authorization activity" sub="Every engine decision, with the policy, risk and latency behind it." />
    <AgentNav />
    <div className="filters-card">
      <ToggleGroup type="single" value={decision === "" ? "all" : decision} onValueChange={(value) => { if (!value) return; setDecision(value === "all" ? "" : value); setPage(1); }}>{DECISIONS.map((value) => <ToggleGroupItem key={value || "all"} value={value === "" ? "all" : value}>{value || "all"}</ToggleGroupItem>)}</ToggleGroup>
      <div className="action-row">
        <InlineSelect className="w-[150px]" value={protocol} onValueChange={(value) => { setProtocol(value); setPage(1); }} placeholder="All protocols" options={PROTOCOLS.map((value) => ({ value, label: value ? value : "All protocols" }))} />
        <Input className="w-[180px]" aria-label="Filter by action" placeholder="action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} />
        <InlineSelect className="w-[200px]" value={agentId} onValueChange={(value) => { setAgentId(value); setPage(1); }} placeholder="All agents" options={[{ value: "", label: "All agents" }, ...agentList.map((agent) => ({ value: agent.id, label: agent.name }))]} />
      </div>
    </div>
    <Panel flush className="record-surface" title="Decisions" note={`${formatCount(query.data.total)} total`}>
      <div className="table-wrap"><table className="table-fixed w-full wide-table activity-table" data-test="primary">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col style={{ width: "29%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead><tr><th>Decision</th><th>Action</th><th>Agent</th><th>Risk</th><th className="num">Latency</th><th>Created</th></tr></thead>
        <tbody>
          {decisions.length ? decisions.map((record) => <tr key={record.id}>
            <td>
              <Link className="tcell-primary" to={`/ui/agents/activity/${record.id}`}>
                <DecisionStrip decision={record.decision === "allow" ? "allowed" : record.decision === "deny" ? "denied" : "held"} policy={record.policy_name} />
              </Link>
            </td>
            <td className="min-w-0">
              <span className="cell-truncate tcell-primary mono" title={record.action}>{record.action}</span>
              <small className="tcell-sub">{record.resource_type || "-"}{record.resource_id ? `:${record.resource_id.slice(0, 8)}` : ""} <span className="chip">{record.protocol || "rest"}</span> <EvidenceChip id={record.id} /></small>
            </td>
            <td>{agentLabel(agentList, record.agent_id)}</td>
            <td>{record.risk_level ? <span className={`${badgeClass(record.risk_level === "critical" || record.risk_level === "high" ? "blocked" : "pending")} risk`}>{record.risk_level}</span> : "-"}</td>
            <td className="num">{record.latency_ms != null ? fmtMs(record.latency_ms) : "-"}</td>
            <td className="tcell-muted whitespace-nowrap tnum" title={`${shortStamp(record.created_at)} (${formatDateTime(record.created_at)})`}>{relTime(record.created_at)}</td>
          </tr>) : <EmptyRow colSpan={6}>No decisions match these filters.</EmptyRow>}
        </tbody>
      </table></div>
      <div className="pager">
        <span>Page <b>{page}</b> of <b>{pageCount}</b></span>
        <div className="pager-links">
          {page > 1 ? <Button variant="ghost" type="button" onClick={() => setPage(page - 1)}>Previous</Button> : <span>Previous</span>}
          {page < pageCount ? <Button variant="ghost" type="button" onClick={() => setPage(page + 1)}>Next</Button> : <span>Next</span>}
        </div>
      </div>
    </Panel>
  </>;
}
