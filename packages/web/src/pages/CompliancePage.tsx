import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageError, PageLoading } from "./DashboardPage";
import { api, compact, fmtUsd, formatCount, formatDate, formatDateTime, shortStamp, type AuditEntry, type AuditorToken, type ComplianceSummary, type GovernanceReport, type LedgerAnchor } from "../api";
import { EmptyRow, Modal, Notice, PageHead, Panel, clipCell } from "../components";
import { LockedNotice, useFeature } from "../features";
import { downloadFile } from "../download";

const RANGES = [7, 30, 90, 365];

export default function CompliancePage() {
  const [days, setDays] = useState(30);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const reportQuery = useQuery({ queryKey: ["compliance-report", days], queryFn: () => api<GovernanceReport>(`/api/compliance/eu-ai-act?days=${days}`), retry: false });
  const summaryQuery = useQuery({ queryKey: ["compliance-summary"], queryFn: () => api<ComplianceSummary>("/api/compliance/summary"), retry: false });
  const auditQuery = useQuery({
    queryKey: ["compliance-audit"],
    queryFn: () => api<{ entries: AuditEntry[]; total: number }>("/api/audit?limit=10"),
    retry: false,
    enabled: true,
  });
  const { allowed, ready } = useFeature("compliance");

  const download = async (url: string, name: string) => {
    setDownloadError(null);
    try { await downloadFile(url, name); } catch (error) { setDownloadError((error as Error).message); }
  };

  if (!ready) return <PageLoading />;
  if (!allowed) return <>
    <PageHead title="Compliance" sub="EU AI Act readiness reporting." />
    <LockedNotice feature="compliance" label="EU AI Act compliance reporting" />
  </>;
  if (reportQuery.isPending) return <PageLoading />;
  if (reportQuery.isError) return <PageError message={reportQuery.error.message} />;
  const report = reportQuery.data;
  const summary = summaryQuery.data;

  return <>
    <PageHead title="Compliance" sub={`EU AI Act readiness report · ${formatDate(report.window.from)} to ${formatDate(report.window.to)}`} actions={<>
      <ToggleGroup className="range" type="single" value={String(days)} onValueChange={(value) => { if (value) setDays(Number(value)); }}>{RANGES.map((value) => <ToggleGroupItem key={value} value={String(value)} className={value === days ? "active" : ""}>{value}d</ToggleGroupItem>)}</ToggleGroup>
      <Button variant="outline" type="button" onClick={() => void download(`/api/compliance/eu-ai-act/markdown?days=${days}`, "torrix-eu-ai-act.md")}>Download report</Button>
      <Button variant="outline" type="button" onClick={() => void download("/api/compliance/report.csv", "torrix-compliance.csv")}>Download CSV</Button>
    </>} />
    {downloadError ? <Notice>Download failed: {downloadError}</Notice> : null}

    <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Total runs</span><div className="st-value">{compact(summary?.total_runs ?? report.inventory.totalRuns)}</div><div className="st-sub">{fmtUsd(report.inventory.totalSpendUsd)} captured</div></div>
      <div className="stat-tile"><span className="st-label">Flagged runs</span><div className="st-value">{compact(summary?.flagged_runs ?? report.inventory.flaggedRuns)}</div><div className="st-sub">{report.inventory.blockedRuns} blocked by policy</div></div>
      <div className="stat-tile"><span className="st-label">Pending review</span><div className="st-value">{compact(report.inventory.pendingReview)}</div><div className="st-sub">{report.inventory.approvedRuns} approved · {report.inventory.rejectedRuns} rejected</div></div>
      <div className="stat-tile"><span className="st-label">Audit events</span><div className="st-value">{compact(report.dataGovernance.auditEvents)}</div><div className="st-sub">recordkeeping {report.article12Recordkeeping ? "ready" : "incomplete"}</div></div>
    </div>

    <div className="db-mid compliance-cards">
      <Panel className="compliance-panel" title="Transparency (Art. 13)" note={report.transparency.retentionDays ? `retention ${report.transparency.retentionDays} days` : "retention not set"}>
        <div className="db-hero-stats" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <Stat label="Logged request bodies" value={formatCount(report.transparency.loggedRequestBodies)} />
          <Stat label="Logged responses" value={formatCount(report.transparency.loggedResponses)} />
          <Stat label="Thinking traces" value={formatCount(report.transparency.loggedThinking)} />
          <Stat label="Tool calls" value={formatCount(report.transparency.loggedToolCalls)} />
        </div>
        <div className="pii-summary">
          <span className="pii-summary-label">PII masking {report.transparency.piiMasking.enabled ? "on" : "off"}</span>
          <div className="pii-chips">{report.transparency.piiMasking.types.length ? report.transparency.piiMasking.types.map((type) => <span className="chip" key={type}>{type}</span>) : <span className="empty-value">No detector types selected.</span>}</div>
          <span className="field-hint">{report.transparency.piiMasking.enabled ? [report.transparency.piiMasking.inputMasked ? "Requests" : null, report.transparency.piiMasking.outputMasked ? "responses" : null].filter(Boolean).join(" and ") || "No fields selected" : "No masking applied"}.</span>
        </div>
      </Panel>
      <Panel className="compliance-panel" title="Human oversight (Art. 14)" note={`${formatCount(report.humanOversight.policyCount)} policies`}>
        <div className="db-hero-stats" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <Stat label="Review enabled" value={report.humanOversight.reviewEnabled ? "yes" : "no"} />
          <Stat label="Blocking policies" value={formatCount(report.humanOversight.blockingPolicyCount)} />
        </div>
        <div className="mt-2.5">
          <div className="panel-note mb-1.5">Recent decisions</div>
          {report.humanOversight.lastReviewDecisions.length ? report.humanOversight.lastReviewDecisions.map((decision, index) => <div key={index} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--sans)", fontSize: 11.5 }}>
            <span>{decision.state}</span><span className="tcell-muted">{formatDateTime(decision.decidedAt)}</span>
          </div>) : <Notice>No review decisions yet.</Notice>}
        </div>
      </Panel>
    </div>

    <Panel title="Data governance (Art. 12)" note={report.dataGovernance.externalExportConfigured ? "external export configured" : "no external export"}>
      <div className="db-hero-stats" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <Stat label="Audit events" value={compact(report.dataGovernance.auditEvents)} />
        <Stat label="First event" value={formatDate(report.dataGovernance.firstAuditEvent)} />
        <Stat label="Last event" value={formatDate(report.dataGovernance.lastAuditEvent)} />
      </div>
    </Panel>

    <EvidencePanel days={days} />

    <Panel title="Top risks">
      {report.topRisks.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8, color: "var(--text)" }}>{report.topRisks.map((risk, index) => <li key={index}>{risk}</li>)}</ul> : <Notice>No risks detected for this window.</Notice>}
    </Panel>

    <Panel flush title="Activity by day" note={`${report.byDay.length} days`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th className="num">Runs</th><th className="num">Cost</th><th className="num">Errors</th></tr></thead>
        <tbody>
          {report.byDay.length ? report.byDay.map((day) => <tr key={day.date}>
            <td className="tnum">{formatDate(day.date)}</td>
            <td className="num">{compact(day.runs)}</td>
            <td className="num">{fmtUsd(day.cost)}</td>
            <td className="num">{day.errors}</td>
          </tr>) : <tr><td colSpan={4} className="panel-note" style={{ padding: 16, textAlign: "center" }}>No activity in this window.</td></tr>}
        </tbody>
      </table></div>
    </Panel>

    <Panel flush title="Audit log" note={`${formatCount(auditQuery.data?.total ?? report.dataGovernance.auditEvents)} total · latest ${formatCount(auditQuery.data?.entries.length ?? 0)} (read-only)`} actions={<Button variant="outline" type="button" onClick={() => void download("/api/audit/export", "torrix-audit-log.csv")}>Download audit CSV</Button>}>
      <div className="table-wrap"><table className="table-fixed w-full compliance-audit-table" data-test="primary">
        <colgroup>
          <col style={{ width: "15%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "26%" }} />
        </colgroup>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {auditQuery.data?.entries.length ? auditQuery.data.entries.map((entry) => <tr key={entry.id}>
            <td className="tcell-muted whitespace-nowrap tnum" title={formatDateTime(entry.created_at)}>{shortStamp(entry.created_at)}</td>
            <td className="tnum"><span title={entry.actor} style={clipCell}>{entry.actor}</span></td>
            <td className="tnum"><span title={entry.action} style={clipCell}>{entry.action}</span></td>
            <td className="mono"><span title={`${entry.target_type}${entry.target_id ? `:${entry.target_id}` : ""}`} style={clipCell}>{entry.target_type}{entry.target_id ? `:${entry.target_id.slice(0, 8)}` : ""}</span></td>
            <td><span title={entry.detail ?? undefined} style={{ ...clipCell, color: "var(--text-3)" }}>{entry.detail || "-"}</span></td>
          </tr>) : <EmptyRow colSpan={5}>No audit entries yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    <Panel title="System inventory" note={report.system.dataResidency}>
      <div className="table-wrap"><table>
        <thead><tr><th>Model</th><th>Provider</th><th className="num">Runs</th><th className="num">Cost</th></tr></thead>
        <tbody>
          {report.system.modelProviders.length ? report.system.modelProviders.map((item) => <tr key={`${item.provider}-${item.model}`}>
            <td className="tnum">{item.model}</td>
            <td className="tnum">{item.provider}</td>
            <td className="num">{compact(item.runs)}</td>
            <td className="num">{fmtUsd(item.costUsd)}</td>
          </tr>) : <tr><td colSpan={4} className="panel-note" style={{ padding: 16, textAlign: "center" }}>No model usage recorded.</td></tr>}
        </tbody>
      </table></div>
    </Panel>
  </>;
}

/** Signed ledger anchors, the downloadable evidence pack and read-only auditor tokens. */
function EvidencePanel({ days }: { days: number }) {
  const client = useQueryClient();
  const whoami = useQuery({ queryKey: ["whoami"], queryFn: () => api<{ is_admin: boolean | number }>("/api/whoami") });
  const isAdmin = whoami.data ? whoami.data.is_admin === true || String(whoami.data.is_admin) === "1" : false;
  const anchors = useQuery({ queryKey: ["evidence-anchors"], queryFn: () => api<{ anchors: LedgerAnchor[] }>("/api/v1/evidence/anchors") });
  const tokens = useQuery({ queryKey: ["auditor-tokens"], queryFn: () => api<{ tokens: AuditorToken[] }>("/api/v1/evidence/auditor-tokens"), enabled: isAdmin });
  const [message, setMessage] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("External auditor");
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["evidence-anchors"] });
    void client.invalidateQueries({ queryKey: ["auditor-tokens"] });
  };
  const anchor = useMutation({
    mutationFn: () => api<{ anchor: LedgerAnchor }>("/api/v1/evidence/anchors", { method: "POST", body: "{}" }),
    onSuccess: (data) => { setMessage(`Anchored ledger head ${data.anchor.seq} at ${data.anchor.hash.slice(0, 12)}. The receipt verifies offline.`); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const mint = useMutation({
    mutationFn: () => api<{ token: string }>("/api/v1/evidence/auditor-tokens", {
      method: "POST",
      body: JSON.stringify({ name: tokenName || "External auditor", expires_in_days: 90 }),
    }),
    onSuccess: (data) => { setNewToken(data.token); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/v1/evidence/auditor-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => { setMessage("Auditor token revoked."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const download = async () => {
    setMessage(null);
    try {
      await downloadFile(`/api/v1/evidence/pack?days=${days}&download=1`, `torrix-evidence-pack-${days}d.json`);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const anchorList = anchors.data?.anchors ?? [];
  const tokenList = tokens.data?.tokens ?? [];
  return <Panel flush title="Evidence pack and anchors" note={`${anchorList.length} anchor${anchorList.length === 1 ? "" : "s"}`} actions={
    <div className="action-row">
      {isAdmin ? <Button variant="outline" type="button" disabled={anchor.isPending} onClick={() => anchor.mutate()}>Create anchor</Button> : null}
      <Button variant="outline" type="button" onClick={() => void download()}>Download evidence pack</Button>
    </div>
  }>
    <div style={{ padding: "0 18px 14px" }}>
      <p className="panel-note" style={{ margin: 0 }}>
        The pack contains the agent inventory, delegations, policy versions, decision totals, approval oversight,
        containment drill results, the signed ledger export and any anchors. It maps the evidence to EU AI Act
        Articles 12 and 14, the NIST AI RMF, ISO 42001 and the NAIC language.
      </p>
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th>Head</th><th>Hash</th><th>Witness</th><th>Anchored</th></tr></thead>
      <tbody>
        {anchors.isPending ? <EmptyRow colSpan={4}>Loading...</EmptyRow> : anchorList.length ? anchorList.slice(0, 8).map((anchor) => <tr key={anchor.id}>
          <td className="num">{anchor.seq}</td>
          <td className="tnum mono" title={anchor.hash}>{anchor.hash.slice(0, 16)}</td>
          <td className="tnum">{anchor.witness_id ?? (anchor.witness_url ? "witnessed" : "local signature")}</td>
          <td className="tnum">{formatDateTime(anchor.created_at)}</td>
        </tr>) : <EmptyRow colSpan={4}>No anchors yet. An anchor signs the current ledger head so later history cannot be rewritten quietly.</EmptyRow>}
      </tbody>
    </table></div>
    {isAdmin ? <div style={{ padding: "14px 18px 18px" }}>
      <div className="action-row" style={{ alignItems: "end" }}>
        <label style={{ display: "grid", gap: 6, minWidth: 260 }}>
          <span className="panel-note">New auditor token name</span>
          <input className="input" value={tokenName} onChange={(event) => setTokenName(event.target.value)} />
        </label>
        <Button variant="outline" type="button" disabled={mint.isPending} onClick={() => mint.mutate()}>New auditor token</Button>
      </div>
      <p className="panel-note">Auditor tokens can read the evidence pack, anchors and ledger verification only. They cannot read runs, prompts or settings.</p>
      {tokenList.length ? <div className="table-wrap" style={{ marginTop: 8 }}><table>
        <thead><tr><th>Name</th><th>Prefix</th><th>Expires</th><th>Status</th><th /></tr></thead>
        <tbody>{tokenList.map((token) => <tr key={token.id}>
          <td className="tnum">{token.name}</td>
          <td className="tnum mono">{token.token_prefix}...</td>
          <td className="tnum">{token.expires_at ? formatDate(token.expires_at) : "never"}</td>
          <td className="tnum">{token.revoked_at ? "revoked" : "active"}</td>
          <td className="text-right">{token.revoked_at ? null : <Button size="sm" variant="outline" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(token.id)}>Revoke</Button>}</td>
        </tr>)}</tbody>
      </table></div> : null}
    </div> : null}
    {message ? <div style={{ padding: "0 18px 16px" }}><Notice>{message}</Notice></div> : null}
    {newToken ? <Modal title="Auditor token" onClose={() => setNewToken(null)}>
      <p>Copy this token now. It is shown once and only grants the evidence routes.</p>
      <div className="keybox"><code>{newToken}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(newToken)}>Copy</Button></div>
      <div className="modal-actions"><Button type="button" onClick={() => setNewToken(null)}>Done</Button></div>
    </Modal> : null}
  </Panel>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="panel-note">{label}</div><div className="tnum" style={{ fontSize: 20, fontWeight: 600, color: "var(--heading)", marginTop: 4 }}>{value}</div></div>;
}
