import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useState } from "react";
import { api, formatCount, formatDateTime, formatDuration, formatPercent, relTime, type Agent, type Approval, type OversightMetrics, type Principal } from "../../api";
import { DecisionStrip, EmptyRow, EvidenceChip, Notice, PageHead, Panel, SkeletonRows } from "../../components";
import { useFeature } from "../../features";
import { FormModal, TextAreaField, useZodForm } from "../../form";
import { z } from "zod";
import { AgentNav, agentLabel, badgeClass } from "./shared";

const STATES = ["pending", "approved", "rejected", "expired", "consumed", "cancelled"];

export default function ApprovalsPage() {
  const client = useQueryClient();
  const [state, setState] = useState("pending");
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["approvals", state, page], queryFn: () => api<{ approvals: Approval[]; total: number; page: number; limit: number }>(`/api/v1/approvals?state=${state}&page=${page}&limit=50`) });
  const counts = useQuery({
    queryKey: ["approval-counts"],
    queryFn: async () => {
      const entries = await Promise.all(STATES.map(async (value) => {
        const result = await api<{ total: number }>(`/api/v1/approvals?state=${value}&page=1&limit=1`);
        return [value, result.total] as const;
      }));
      return Object.fromEntries(entries) as Record<string, number>;
    },
    staleTime: 15_000,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/api/v1/agents") });
  const principals = useQuery({ queryKey: ["principals"], queryFn: () => api<{ principals: Principal[] }>("/api/v1/principals") });
  const [decision, setDecision] = useState<{ approval: Approval; state: "approved" | "rejected" } | null>(null);
  const decide = useMutation({ mutationFn: ({ id, next, note }: { id: string; next: string; note: string }) => api(`/api/v1/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ state: next, note }) }), onSuccess: () => { setDecision(null); void client.invalidateQueries({ queryKey: ["approvals"] }); void client.invalidateQueries({ queryKey: ["approval-counts"] }); } });

  const approvals = query.data?.approvals ?? [];
  const agentList = agents.data?.agents ?? [];
  const principalList = principals.data?.principals ?? [];
  const pageCount = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1;

  return <>
    <PageHead title="Approvals" sub="Actions held for human decision by a require_approval policy." />
    <AgentNav />
    <OversightPanel />
    <Panel flush title="Queue" note={`${formatCount(query.data?.total ?? 0)} in ${state}`} actions={
      <ToggleGroup className="approval-filter" type="single" value={state} onValueChange={(value) => { if (value) { setState(value); setPage(1); } }}>{STATES.map((value) => <ToggleGroupItem key={value} value={value}>{value}{counts.data ? ` ${formatCount(counts.data[value] ?? 0)}` : ""}</ToggleGroupItem>)}</ToggleGroup>
    }>
      <div className="table-wrap"><table className="approvals-table" data-test="primary">
        <colgroup><col style={{ width: "17%" }} /><col style={{ width: "13%" }} /><col style={{ width: "9%" }} /><col style={{ width: "11%" }} /><col style={{ width: "7%" }} /><col style={{ width: "19%" }} /><col style={{ width: "12%" }} /><col style={{ width: "12%" }} /></colgroup>
        <thead><tr><th>Action</th><th>Agent</th><th>Principal</th><th>Resource</th><th className="num">Amount</th><th>Decision</th><th>When</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <SkeletonRows columns={8} rows={5} /> : approvals.length ? approvals.map((approval) => <tr key={approval.id}>
            <td><span className="tcell-primary approval-action">{approval.action}</span><small className="tcell-sub"><EvidenceChip id={approval.id} /></small><small className="tcell-sub approval-mobile-meta">{approval.resource_type || "-"}{approval.resource_id ? `:${approval.resource_id}` : ""} · {approvalAmount(approval)}</small></td>
            <td className="approval-agent">{agentLabel(agentList, approval.agent_id)}</td>
            <td className="approval-principal" style={{ color: "var(--text-2)" }}>{principalList.find((principal) => principal.id === approval.principal_id)?.display_name ?? "-"}</td>
            <td className="mono approval-resource" title={`${approval.resource_type || ""}${approval.resource_id ? `:${approval.resource_id}` : ""}`}>{approval.resource_type || "-"}{approval.resource_id ? `:${approval.resource_id}` : ""}</td>
            <td className="num">{approvalAmount(approval)}</td>
            <td>
              <div className="approval-decision">
                <div className="approval-decision-head">
                  <DecisionStrip
                    decision={approval.state === "pending" || approval.state === "expired" ? "held" : approval.state === "approved" || approval.state === "consumed" ? "allowed" : "denied"}
                    approver={approval.reviewer_user_id ? approval.reviewer_user_id.slice(0, 8) : null}
                  />
                  {approval.risk_level ? <span className={`${badgeClass(approval.risk_level === "low" ? "active" : approval.risk_level === "medium" ? "pending" : "blocked")} risk`}>{approval.risk_level} risk</span> : null}
                  {approval.canary ? <span className="chip" title="A known-bad request injected to test review quality">canary</span> : null}
                  {Number(approval.required_approvals ?? 1) > 1 ? <span className="chip">{Number(approval.approvals_count ?? 0)} of {approval.required_approvals} approvals</span> : null}
                </div>
                <p className="approval-reason" title={approval.reason ?? "human review"}>{approval.reason ?? "human review"}</p>
              </div>
            </td>
            <td className="tcell-muted whitespace-nowrap tnum">{relTime(approval.created_at)}
              <small className="tcell-sub" title={`expires ${formatDateTime(approval.expires_at)}`}>{approval.expires_at ? `expires ${relTime(approval.expires_at)}` : "no expiry"}</small>
            </td>
            <td>
              {approval.state === "pending"
                ? <div className="approval-actions">
                    <Button size="sm" variant="outline" type="button" onClick={() => setDecision({ approval, state: "approved" })}>Approve</Button>
                    <Button size="sm" variant="outline" type="button" onClick={() => setDecision({ approval, state: "rejected" })}>Reject</Button>
                  </div>
                : <span className="text-right tcell-sub">closed</span>}
            </td>
          </tr>) : <EmptyRow colSpan={8}>Nothing in this queue; held agent actions will appear here.</EmptyRow>}
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
    {decision ? <DecisionModal approval={decision.approval} state={decision.state} pending={decide.isPending} error={decide.error?.message} onClose={() => setDecision(null)} onSubmit={(note) => decide.mutate({ id: decision.approval.id, next: decision.state, note })} /> : null}
  </>;
}

/** Approval quality: rates, time to decide, rubber-stamp evidence and canary results. */
function OversightPanel() {
  const client = useQueryClient();
  const { allowed: enterprise } = useFeature("compliance");
  const whoami = useQuery({ queryKey: ["whoami"], queryFn: () => api<{ is_admin: boolean | number }>("/api/whoami") });
  const isAdmin = whoami.data ? whoami.data.is_admin === true || String(whoami.data.is_admin) === "1" : false;
  const [days, setDays] = useState(30);
  const [includeReviewers, setIncludeReviewers] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["oversight", enterprise, days, includeReviewers],
    queryFn: () => api<{ oversight: OversightMetrics }>(`/api/v1/oversight/${enterprise ? "report" : "metrics"}?days=${days}${includeReviewers ? "&include_reviewers=1" : ""}`),
  });
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["oversight"] });
    void client.invalidateQueries({ queryKey: ["approvals"] });
    void client.invalidateQueries({ queryKey: ["approval-counts"] });
  };
  const canary = useMutation({
    mutationFn: () => api<{ approval: { id: string } }>("/api/v1/oversight/canary", { method: "POST", body: "{}" }),
    onSuccess: () => { setMessage("Canary injected into the queue. Reject it to record a catch."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const sign = useMutation({
    mutationFn: () => api<{ ledger: { hash: string } }>("/api/v1/oversight/report/sign", {
      method: "POST",
      body: JSON.stringify({ days, include_reviewers: includeReviewers }),
    }),
    onSuccess: (data) => { setMessage(`Report signed into the ledger. Hash ${data.ledger.hash.slice(0, 16)}.`); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const data = query.data?.oversight;
  return <Panel flush title="Oversight" note={`${days} days, aggregate by default`} actions={
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" value={String(days)} onValueChange={(value) => { if (value) setDays(Number(value)); }}>
        {[7, 30, 90].map((value) => <ToggleGroupItem key={value} value={String(value)}>{value}d</ToggleGroupItem>)}
      </ToggleGroup>
      {isAdmin ? <label className="panel-note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={includeReviewers} onChange={(event) => setIncludeReviewers(event.target.checked)} />
        per reviewer
      </label> : null}
      {enterprise && isAdmin ? <Button size="sm" variant="outline" type="button" disabled={canary.isPending} onClick={() => canary.mutate()}>Inject canary</Button> : null}
      {enterprise ? <Button size="sm" variant="outline" type="button" disabled={sign.isPending} onClick={() => sign.mutate()}>Sign report</Button> : null}
    </div>
  }>
    {query.isPending ? <SkeletonRows columns={4} rows={2} /> : query.isError ? <div style={{ padding: 16 }}><Notice>{query.error.message}</Notice></div> : data ? <div style={{ padding: "14px 18px 18px" }}>
      <div className="stat-tiles">
        <div className="stat-tile"><span className="st-label">Approval rate</span><div className="st-value">{formatPercent(data.rates.approval_rate == null ? null : data.rates.approval_rate * 100, 1)}</div><div className="st-sub">{data.totals.approved} approved, {data.totals.rejected} rejected</div></div>
        <div className="stat-tile"><span className="st-label">Median decision</span><div className="st-value">{formatDuration(data.timing.median_seconds == null ? null : data.timing.median_seconds * 1000)}</div><div className="st-sub">{data.totals.decided} decided, {data.totals.pending} pending</div></div>
        <div className="stat-tile"><span className="st-label">Fast approvals</span><div className="st-value">{data.rubber_stamp.fast_approvals}</div><div className="st-sub">within {data.rubber_stamp.threshold_seconds}s</div></div>
        <div className="stat-tile"><span className="st-label">Rubber-stamp flag</span><div className="st-value">{data.rubber_stamp.flagged ? "Flagged" : "Clear"}</div><div className="st-sub">{data.rubber_stamp.sample} decisions, {data.rubber_stamp.threshold_rate}% threshold</div></div>
        <div className="stat-tile"><span className="st-label">Canaries</span><div className="st-value">{data.canaries.injected}</div><div className="st-sub">{data.canaries.caught} caught, {data.canaries.missed} missed, {data.canaries.pending} pending</div></div>
        <div className="stat-tile"><span className="st-label">Canary catch rate</span><div className="st-value">{formatPercent(data.canaries.catch_rate == null ? null : data.canaries.catch_rate * 100, 0)}</div><div className="st-sub">{enterprise ? "known-bad requests reviewers rejected" : "Enterprise"}</div></div>
      </div>
      {data.rubber_stamp.flagged ? <div className="mt-3"><Notice>{data.rubber_stamp.note}</Notice></div> : null}
      {data.by_tool.length ? <div className="table-wrap mt-3" style={{ maxHeight: 220, overflow: "auto" }}>
        <table>
          <thead><tr><th>Tool</th><th className="num">Approvals</th><th className="num">Approved</th><th className="num">Rejected</th><th className="num">Median</th><th className="num">Fast</th></tr></thead>
          <tbody>{data.by_tool.slice(0, 8).map((row) => <tr key={row.tool}>
            <td className="tnum">{row.tool}</td>
            <td className="num">{row.approvals}</td>
            <td className="num">{row.approved}</td>
            <td className="num">{row.rejected}</td>
            <td className="num">{formatDuration(row.median_seconds == null ? null : row.median_seconds * 1000)}</td>
            <td className="num">{row.fast_approvals}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
      {isAdmin && includeReviewers && data.reviewers?.length ? <div className="table-wrap mt-3" style={{ maxHeight: 200, overflow: "auto" }}>
        <table>
          <thead><tr><th>Reviewer</th><th className="num">Approvals</th><th className="num">Approved</th><th className="num">Rejected</th><th className="num">Median</th><th className="num">Fast</th></tr></thead>
          <tbody>{data.reviewers.map((row) => <tr key={row.reviewer_user_id}>
            <td className="tnum mono">{row.reviewer_user_id.slice(0, 8)}</td>
            <td className="num">{row.approvals}</td>
            <td className="num">{row.approved}</td>
            <td className="num">{row.rejected}</td>
            <td className="num">{formatDuration(row.median_seconds == null ? null : row.median_seconds * 1000)}</td>
            <td className="num">{row.fast_approvals}</td>
          </tr>)}</tbody>
        </table>
      </div> : null}
      {!enterprise ? <div className="mt-3"><Notice>Canary approvals and signed oversight reports are Enterprise. Approval metrics are included in Pro.</Notice></div> : null}
      {message ? <div className="mt-3"><Notice>{message}</Notice></div> : null}
    </div> : null}
  </Panel>;
}

/** Approval requests carry the amount inside their canonical params. */
function approvalAmount(approval: Approval): string {
  try {
    const params = JSON.parse(approval.params_summary || "{}") as Record<string, unknown>;
    const amount = params.amount;
    if (typeof amount === "number") return formatCount(amount);
    if (typeof amount === "string" && amount.trim()) return amount;
    return "-";
  } catch {
    return "-";
  }
}

const decisionSchema = z.object({ note: z.string() });
type DecisionValues = z.infer<typeof decisionSchema>;

function DecisionModal({ approval, state, pending, error, onClose, onSubmit }: { approval: Approval; state: string; pending: boolean; error?: string; onClose: () => void; onSubmit: (note: string) => void }) {
  const form = useZodForm<DecisionValues>(decisionSchema, { note: "" });
  return <FormModal title={`${state === "approved" ? "Approve" : "Reject"} action`} form={form} submitLabel={state === "approved" ? "Approve" : "Reject"} pending={pending} error={error ?? null} onClose={onClose} onSubmit={(values) => onSubmit(values.note)}>
    <p><b>{approval.action}</b> on {approval.resource_type || "resource"}. Approval is hash-bound and single-use.</p>
    <TextAreaField form={form} name="note" label="Note (optional)" rows={3} />
  </FormModal>;
}
