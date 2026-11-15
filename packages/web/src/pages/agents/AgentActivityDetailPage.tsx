import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, fmtMs, type DecisionExplain } from "../../api";
import { formatDateTime } from "../../api";
import { DecisionStrip, EmptyRow, EvidenceChip, Notice, PageHead, Panel } from "../../components";
import { PageError, PageLoading } from "../DashboardPage";
import { AgentNav, badgeClass, limitsOf, listOf } from "./shared";

export default function AgentActivityDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["decision", id], queryFn: () => api<DecisionExplain>(`/api/v1/decisions/${encodeURIComponent(id)}/explain`) });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const { decision, request, approval, delegationChain, policyVersion } = query.data;

  const handoff = (() => {
    if (decision.protocol !== "a2a" || !request?.context) return null;
    try {
      const parsed = JSON.parse(request.context) as { a2a?: Record<string, unknown> };
      if (!parsed.a2a || typeof parsed.a2a !== "object") return null;
      return {
        fromAgent: String(parsed.a2a.from_agent_slug ?? parsed.a2a.from_agent_id ?? "-"),
        parentDelegation: String(parsed.a2a.parent_delegation_id ?? "-"),
        depth: String(parsed.a2a.depth ?? "-"),
      };
    } catch {
      return null;
    }
  })();

  const riskFactors = (() => {
    if (!decision.risk_factors) return [];
    try { const parsed = JSON.parse(decision.risk_factors) as Array<{ signal: string; value: number; detail: string }>; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  })();

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/agents/activity">← Authorization activity</Link></div>
    <PageHead title={decision.action} sub={`${decision.protocol} · ${formatDateTime(decision.created_at)}`} actions={
      <div className="action-row">
        <DecisionStrip decision={decision.decision === "allow" ? "allowed" : decision.decision === "deny" ? "denied" : "held"} policy={decision.policy_name} />
        <EvidenceChip id={decision.id} />
      </div>
    } />
    <AgentNav />

    <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Risk</span><div className="st-value">{decision.risk_level || "-"}</div><div className="st-sub">{decision.risk_score != null ? `score ${decision.risk_score.toFixed(2)}` : "no score"}</div></div>
      <div className="stat-tile"><span className="st-label">Latency</span><div className="st-value">{decision.latency_ms != null ? fmtMs(decision.latency_ms) : "-"}</div><div className="st-sub">engine evaluation</div></div>
      <div className="stat-tile"><span className="st-label">Policy</span><div className="st-value" style={{ fontSize: 15 }}>{decision.policy_name || "-"}</div><div className="st-sub">{decision.policy_version != null ? `v${decision.policy_version}` : decision.reason_code}</div></div>
      <div className="stat-tile"><span className="st-label">Chain depth</span><div className="st-value">{delegationChain.length}</div><div className="st-sub">{request?.state || "no request"}</div></div>
    </div>

    {handoff ? <Panel title="Agent hand-off" note="Authority passed from the delegating agent">
      <div className="metagrid mb-0">
        <Cell label="From agent" value={handoff.fromAgent} />
        <Cell label="To agent" value={decision.agent_id} />
        <Cell label="Parent delegation" value={handoff.parentDelegation} />
        <Cell label="Depth" value={handoff.depth} />
      </div>
    </Panel> : null}

    <Panel title="Reason">
      <p style={{ margin: 0, color: "var(--text)" }}>{decision.reason}</p>
      {decision.error_code ? <Notice>Error code: {decision.error_code}</Notice> : null}
    </Panel>

    <div className="db-mid">
      <Panel title="Request">
        <div className="metagrid mb-0">
          <Cell label="Agent" value={decision.agent_id} />
          <Cell label="Principal" value={decision.principal_id || "-"} />
          <Cell label="Resource" value={`${decision.resource_type || "-"}${decision.resource_id ? `:${decision.resource_id}` : ""}`} />
          <Cell label="Tool" value={decision.tool_name || "-"} />
          <Cell label="Target system" value={request?.target_system || "-"} />
          <Cell label="Trace" value={decision.trace_id || "-"} />
        </div>
        {request?.params ? <pre className="rd-code mt-3">{pretty(request.params)}</pre> : null}
      </Panel>
      <Panel title="Risk factors">
        {riskFactors.length ? riskFactors.map((factor, index) => <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--sans)", fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <span>{factor.signal}</span><span className="tcell-muted">{factor.detail} ({factor.value.toFixed(2)})</span>
        </div>) : <Notice>No risk factors recorded.</Notice>}
      </Panel>
    </div>

    <Panel flush title="Delegation chain" note={`${delegationChain.length} hops`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Delegation</th><th>Principal</th><th>Agent</th><th>Actions</th><th>Limits</th><th className="num">Depth</th><th>Status</th></tr></thead>
        <tbody>
          {delegationChain.length ? delegationChain.map((delegation) => <tr key={delegation.id}>
            <td className="mono">{delegation.id.slice(0, 8)}</td>
            <td className="mono">{delegation.principal_id.slice(0, 8)}</td>
            <td className="mono">{delegation.agent_id.slice(0, 8)}</td>
            <td>{listOf(delegation.allowed_actions).slice(0, 3).map((action) => <span key={action} className="chip mr-1">{action}</span>)}</td>
            <td className="tcell-muted tnum">{limitsOf(delegation.limits).maximum_amount != null ? `max ${limitsOf(delegation.limits).maximum_amount}` : "none"}</td>
            <td className="num">{delegation.depth}</td>
            <td><span className={badgeClass(delegation.effective_status ?? delegation.status)}><span className="dot" />{delegation.effective_status ?? delegation.status}</span></td>
          </tr>) : <EmptyRow colSpan={7}>No delegation chain.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {approval ? <Panel title="Approval">
      <div className="metagrid mb-0">
        <Cell label="State" value={approval.state} />
        <Cell label="Reason" value={approval.reason || "-"} />
        <Cell label="Note" value={approval.note || "-"} />
        <Cell label="Decided" value={approval.decided_at ? formatDateTime(approval.decided_at) : "-"} />
      </div>
    </Panel> : null}

    {policyVersion ? <Panel title={`Policy snapshot · v${policyVersion.version}`}>
      <pre className="rd-code">{pretty(policyVersion.snapshot)}</pre>
    </Panel> : null}
  </>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="cell"><span className="meta-label">{label}</span><div className="meta-val mono">{value}</div></div>;
}

function pretty(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}
