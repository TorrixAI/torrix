import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type AgentControlSettings, type AgentIdentityKind, type AgentIdentityProvider, type ContainmentState } from "../../api";
import { formatDateTime } from "../../api";
import { EmptyRow, ErrorText, Field, InlineSelect, Modal, Notice, PageHead, Panel, toNullableNumber } from "../../components";
import { FormModal, SelectField, TextField, useZodForm } from "../../form";
import { z } from "zod";
import { PageError, PageLoading } from "../DashboardPage";
import { useFeature } from "../../features";
import { AgentNav, agentLabel, badgeClass } from "./shared";

const ESCALATION = ["allow", "require_approval", "deny"];

export default function AgentSettingsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["agent-settings"], queryFn: () => api<{ settings: AgentControlSettings }>("/api/v1/agent-settings") });
  const [posture, setPosture] = useState("deny");
  const [timeout, setTimeoutMinutes] = useState("60");
  const [depth, setDepth] = useState("4");
  const [high, setHigh] = useState("require_approval");
  const [critical, setCritical] = useState("deny");
  const [alerts, setAlerts] = useState(true);
  const [webhook, setWebhook] = useState("");
  const [secret, setSecret] = useState("");
  const [requireGrant, setRequireGrant] = useState(false);
  const [retention, setRetention] = useState("");
  const [approvalMinRisk, setApprovalMinRisk] = useState("low");
  const [rubberSeconds, setRubberSeconds] = useState("2");
  const [rubberRate, setRubberRate] = useState("95");
  const [canaryHours, setCanaryHours] = useState("0");
  const [quarantineAfter, setQuarantineAfter] = useState("0");
  const [quarantineWindow, setQuarantineWindow] = useState("60");
  const { allowed: canaryAllowed } = useFeature("compliance");
  const settings = query.data?.settings;

  useEffect(() => {
    if (!settings) return;
    setPosture(settings.default_posture);
    setTimeoutMinutes(String(settings.approval_timeout_minutes));
    setDepth(String(settings.max_delegation_depth));
    try {
      const parsed = JSON.parse(settings.risk_escalation || "{}") as { high?: string; critical?: string };
      setHigh(parsed.high ?? "require_approval");
      setCritical(parsed.critical ?? "deny");
    } catch {
      setHigh("require_approval");
      setCritical("deny");
    }
    setAlerts(settings.approval_alerts === 1);
    setWebhook(settings.approval_webhook_url ?? "");
    setSecret(settings.webhook_secret ?? "");
    setRequireGrant(settings.require_grant === 1);
    setRetention(settings.authorization_retention_days != null ? String(settings.authorization_retention_days) : "");
    setApprovalMinRisk(settings.approval_min_risk ?? "low");
    setRubberSeconds(String(settings.rubber_stamp_seconds ?? 2));
    setRubberRate(String(settings.rubber_stamp_rate ?? 95));
    setCanaryHours(String(settings.canary_interval_hours ?? 0));
    setQuarantineAfter(String(settings.quarantine_after_denials ?? 0));
    setQuarantineWindow(String(settings.quarantine_window_minutes ?? 60));
  }, [settings]);

  const save = useMutation({
    mutationFn: () => api("/api/v1/agent-settings", {
      method: "PUT",
      body: JSON.stringify({
        default_posture: posture,
        approval_timeout_minutes: toNullableNumber(timeout) ?? 60,
        max_delegation_depth: toNullableNumber(depth) ?? 4,
        risk_escalation: { high, critical },
        approval_alerts: alerts,
        approval_webhook_url: webhook,
        webhook_secret: secret,
        require_grant: requireGrant,
        approval_min_risk: approvalMinRisk,
        rubber_stamp_seconds: toNullableNumber(rubberSeconds) ?? 2,
        rubber_stamp_rate: toNullableNumber(rubberRate) ?? 95,
        canary_interval_hours: toNullableNumber(canaryHours) ?? 0,
        quarantine_after_denials: toNullableNumber(quarantineAfter) ?? 0,
        quarantine_window_minutes: toNullableNumber(quarantineWindow) ?? 60,
      }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agent-settings"] }),
  });

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;

  return <>
    <PageHead title="Agent settings" sub="Engine posture, approval behavior and the permission graph retention." />
    <AgentNav />
    <Panel title="Authorization engine" note={`updated ${settings ? formatDateTime(settings.updated_at) : "-"}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <Field label="Default posture"><InlineSelect value={posture} onValueChange={setPosture} options={[{ value: "deny", label: "deny" }, { value: "allow", label: "allow" }]} /></Field>
        <Field label="Approval timeout (minutes)"><Input value={timeout} inputMode="numeric" placeholder="60" onChange={(event) => setTimeoutMinutes(event.target.value)} /></Field>
        <Field label="Max delegation depth"><Input value={depth} inputMode="numeric" placeholder="4" onChange={(event) => setDepth(event.target.value)} /></Field>
        <Field label="Risk escalation · high"><InlineSelect value={high} onValueChange={setHigh} options={ESCALATION.map((option) => ({ value: option, label: option }))} /></Field>
        <Field label="Risk escalation · critical"><InlineSelect value={critical} onValueChange={setCritical} options={ESCALATION.map((option) => ({ value: option, label: option }))} /></Field>
      </div>
      <div className="flex items-center gap-2"><Checkbox id="cb-11" checked={requireGrant} onCheckedChange={(value) => setRequireGrant(value === true)} /><label htmlFor="cb-11" className="text-[13px] text-text-2">Require a delegation grant token on every governed call</label></div>
      {settings && retention ? <Notice>Authorization retention: {retention} days.</Notice> : null}
    </Panel>
    <Panel title="Oversight">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <Field label="Auto-approve below risk"><InlineSelect value={approvalMinRisk} onValueChange={setApprovalMinRisk} options={["low", "medium", "high", "critical"].map((option) => ({ value: option, label: option }))} /></Field>
        <Field label="Fast decision threshold (seconds)"><Input value={rubberSeconds} inputMode="numeric" placeholder="2" onChange={(event) => setRubberSeconds(event.target.value)} /></Field>
        <Field label="Rubber-stamp approval rate (%)"><Input value={rubberRate} inputMode="numeric" placeholder="95" onChange={(event) => setRubberRate(event.target.value)} /></Field>
        {canaryAllowed ? <Field label="Canary every N hours (0 = off)"><Input value={canaryHours} inputMode="numeric" placeholder="0" onChange={(event) => setCanaryHours(event.target.value)} /></Field> : null}
        <Field label="Quarantine after N denials (0 = off)"><Input value={quarantineAfter} inputMode="numeric" placeholder="0" onChange={(event) => setQuarantineAfter(event.target.value)} /></Field>
        <Field label="Quarantine window (minutes)"><Input value={quarantineWindow} inputMode="numeric" placeholder="60" onChange={(event) => setQuarantineWindow(event.target.value)} /></Field>
      </div>
      <Notice>Low risk means every held request waits for a person. The rubber-stamp flag is a heuristic: a high approval rate with very fast decisions. It is not a validated measure. Per-reviewer figures are opt-in and administrator-only. Automatic quarantine freezes an agent after the denial budget is spent.</Notice>
    </Panel>
    <ContainmentPanel />
    <Panel title="Approval notifications">
      <div className="flex items-center gap-2"><Checkbox id="cb-12" checked={alerts} onCheckedChange={(value) => setAlerts(value === true)} /><label htmlFor="cb-12" className="text-[13px] text-text-2">Notify on pending approvals</label></div>
      <Field label="Webhook URL"><Input value={webhook} placeholder="Slack or generic HTTPS" onChange={(event) => setWebhook(event.target.value)} /></Field>
      <Field label="Webhook secret"><Input type="password" value={secret} placeholder="adds x-torrix-signature" onChange={(event) => setSecret(event.target.value)} /></Field>
    </Panel>
    {save.isError ? <ErrorText>{save.error.message}</ErrorText> : null}
    <div className="action-row"><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save settings</Button>{save.isSuccess ? <span className="badge good"><span className="dot" />saved</span> : null}</div>
    <IdentityProviders />
  </>;
}

const providerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  kind: z.enum(["entra", "okta", "agentcore", "id_jag", "custom"]),
  issuer: z.string().trim().min(1, "Issuer is required"),
  audience: z.string().trim().min(1, "Audience is required"),
  agentProvider: z.string().trim().min(1, "Agent provider is required"),
  jwksUri: z.string(),
  discoveryUrl: z.string(),
  agentClaim: z.string(),
  principalClaim: z.string(),
  principalProvider: z.string(),
  subjectClaim: z.string(),
  ttl: z.string(),
});
type ProviderValues = z.infer<typeof providerSchema>;

const KINDS: Array<{ value: AgentIdentityKind; label: string }> = [
  { value: "entra", label: "Entra Agent ID" },
  { value: "okta", label: "Okta" },
  { value: "agentcore", label: "AgentCore" },
  { value: "id_jag", label: "ID-JAG (enterprise-managed authorization)" },
  { value: "custom", label: "Custom OIDC" },
];

/** Global, per-agent and per-tool freeze, a rate limit and a recorded drill. */
function ContainmentPanel() {
  const client = useQueryClient();
  const whoami = useQuery({ queryKey: ["whoami"], queryFn: () => api<{ is_admin: boolean | number }>("/api/whoami") });
  const isAdmin = whoami.data ? whoami.data.is_admin === true || String(whoami.data.is_admin) === "1" : false;
  const query = useQuery({ queryKey: ["containment"], queryFn: () => api<{ containment: ContainmentState }>("/api/v1/containment") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Array<{ id: string; name: string; frozen?: number | null }> }>("/api/v1/agents") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api<{ projects: Array<{ id: string; name: string }> }>("/api/projects") });
  const [reason, setReason] = useState("incident response");
  const [agentId, setAgentId] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolAgent, setToolAgent] = useState("");
  const [drillAgent, setDrillAgent] = useState("");
  const [limitScope, setLimitScope] = useState<"agent" | "project">("agent");
  const [limitTarget, setLimitTarget] = useState("");
  const [limitUsd, setLimitUsd] = useState("50");
  const [limitPeriod, setLimitPeriod] = useState<"daily" | "monthly">("monthly");
  const [message, setMessage] = useState<string | null>(null);
  const agentList = agents.data?.agents ?? [];
  const projectList = projects.data?.projects ?? [];
  const containment = query.data?.containment;
  const limitTargets = limitScope === "agent" ? agentList : projectList;
  useEffect(() => {
    if (!agentId && agentList.length) setAgentId(agentList[0]!.id);
    if (!drillAgent && agentList.length) setDrillAgent(agentList[0]!.id);
  }, [agentList, agentId, drillAgent]);
  useEffect(() => {
    if (!limitTargets.some((target) => target.id === limitTarget)) setLimitTarget(limitTargets[0]?.id ?? "");
  }, [limitTargets, limitTarget]);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["containment"] });
    void client.invalidateQueries({ queryKey: ["agents"] });
  };
  const freeze = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/v1/containment/freeze", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { setMessage("Freeze applied. Governed calls now return agents_frozen."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const unfreeze = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api("/api/v1/containment/unfreeze", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => { setMessage("Unfreeze applied."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const drill = useMutation({
    mutationFn: () => api<{ passed: boolean; restored: boolean; reason_code: string }>("/api/v1/containment/drill", {
      method: "POST",
      body: JSON.stringify({ agent_id: drillAgent }),
    }),
    onSuccess: (data) => {
      setMessage(data.passed
        ? `Drill passed: the engine returned ${data.reason_code}${data.restored ? " and the agent was restored." : "."}`
        : `Drill failed: the engine returned ${data.reason_code}.`);
      invalidate();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const saveLimit = useMutation({
    mutationFn: () => api("/api/v1/containment/spend-limits", {
      method: "POST",
      body: JSON.stringify({ scope: limitScope, scope_id: limitTarget, limit_usd: Number(limitUsd), period: limitPeriod }),
    }),
    onSuccess: () => { setMessage("Spend limit saved. Calls over the limit now return spend_limit_reached before policy."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  const removeLimit = useMutation({
    mutationFn: (id: string) => api(`/api/v1/containment/spend-limits/${id}`, { method: "DELETE" }),
    onSuccess: () => { setMessage("Spend limit removed."); invalidate(); },
    onError: (error: Error) => setMessage(error.message),
  });
  if (query.isPending) return <Panel title="Containment"><p className="panel-note">Loading...</p></Panel>;
  if (query.isError || !containment) return <Panel title="Containment"><Notice>{query.error?.message ?? "Containment is unavailable."}</Notice></Panel>;
  return <Panel title="Containment" note={containment.global.frozen ? "global freeze is on" : "ready"}>
    {!isAdmin ? <Notice>Only administrators can freeze or unfreeze agents and tools.</Notice> : null}
    <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Global</span><div className="st-value">{containment.global.frozen ? "Frozen" : "Clear"}</div><div className="st-sub">{containment.global.reason || "no active freeze"}</div></div>
      <div className="stat-tile"><span className="st-label">Frozen agents</span><div className="st-value">{containment.agents.length}</div><div className="st-sub">one click each</div></div>
      <div className="stat-tile"><span className="st-label">Frozen tools</span><div className="st-value">{containment.tools.length}</div><div className="st-sub">all agents or one</div></div>
      <div className="stat-tile"><span className="st-label">Quarantine</span><div className="st-value">{containment.quarantine.after_denials || "off"}</div><div className="st-sub">{containment.quarantine.window_minutes} minute window</div></div>
      <div className="stat-tile"><span className="st-label">Spend limits</span><div className="st-value">{containment.spend_limits.length}</div><div className="st-sub">{containment.spend_limits.filter((limit) => limit.paused).length} paused</div></div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginTop: 12 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <Field label="Global freeze reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <div className="action-row">
          {containment.global.frozen
            ? <Button variant="outline" type="button" disabled={!isAdmin || unfreeze.isPending} onClick={() => unfreeze.mutate({ scope: "all" })}>Unfreeze all</Button>
            : <Button variant="outline" type="button" disabled={!isAdmin || freeze.isPending} onClick={() => freeze.mutate({ scope: "all", reason })}>Freeze all agents</Button>}
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <Field label="One agent"><InlineSelect value={agentId} onValueChange={setAgentId} options={agentList.map((agent) => ({ value: agent.id, label: agent.name }))} /></Field>
        <div className="action-row"><Button variant="outline" type="button" disabled={!isAdmin || !agentId || freeze.isPending} onClick={() => freeze.mutate({ scope: "agent", agent_id: agentId, reason })}>Freeze agent</Button></div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <Field label="Tool name"><Input value={toolName} placeholder="createPurchaseOrder or Bash" onChange={(event) => setToolName(event.target.value)} /></Field>
        <Field label="Tool scope"><InlineSelect value={toolAgent} onValueChange={setToolAgent} options={[{ value: "", label: "all agents" }, ...agentList.map((agent) => ({ value: agent.id, label: agent.name }))]} /></Field>
        <div className="action-row"><Button variant="outline" type="button" disabled={!isAdmin || !toolName.trim() || freeze.isPending} onClick={() => freeze.mutate({ scope: "tool", agent_id: toolAgent || undefined, tool_name: toolName.trim(), reason })}>Freeze tool</Button></div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <Field label="Drill agent"><InlineSelect value={drillAgent} onValueChange={setDrillAgent} options={agentList.map((agent) => ({ value: agent.id, label: agent.name }))} /></Field>
        <div className="action-row"><Button variant="outline" type="button" disabled={!isAdmin || !drillAgent || drill.isPending} onClick={() => drill.mutate()}>{drill.isPending ? "Running..." : "Run freeze drill"}</Button></div>
      </div>
    </div>
    <div className="mt-3">
      <div className="panel-note mb-1.5">SPEND LIMITS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <Field label="Scope"><InlineSelect value={limitScope} onValueChange={(value) => setLimitScope(value === "project" ? "project" : "agent")} options={[{ value: "agent", label: "agent" }, { value: "project", label: "project" }]} /></Field>
        <Field label={limitScope === "agent" ? "Agent" : "Project"}><InlineSelect value={limitTarget} onValueChange={setLimitTarget} options={limitTargets.map((target) => ({ value: target.id, label: target.name }))} /></Field>
        <Field label="Limit (USD)"><Input value={limitUsd} inputMode="decimal" placeholder="50" onChange={(event) => setLimitUsd(event.target.value)} /></Field>
        <Field label="Window"><InlineSelect value={limitPeriod} onValueChange={(value) => setLimitPeriod(value === "daily" ? "daily" : "monthly")} options={[{ value: "daily", label: "daily" }, { value: "monthly", label: "monthly" }]} /></Field>
      </div>
      <div className="action-row"><Button variant="outline" type="button" disabled={!isAdmin || !limitTarget || saveLimit.isPending || !(Number(limitUsd) > 0)} onClick={() => saveLimit.mutate()}>{saveLimit.isPending ? "Saving..." : "Save spend limit"}</Button></div>
      <Notice>Spend limits pause an agent before identity or policy once recorded run cost reaches the limit in the selected window. The next day or month starts a fresh window, so no one has to unfreeze anything.</Notice>
      {containment.spend_limits.length ? <div className="table-wrap mt-3">
        <table><thead><tr><th>Scope</th><th>Target</th><th>Limit</th><th>Window</th><th>Spent</th><th>State</th><th /></tr></thead><tbody>
          {containment.spend_limits.map((limit) => <tr key={limit.id}>
            <td className="tnum">{limit.scope}</td>
            <td className="tnum">{limit.scope_name}</td>
            <td className="tnum">${limit.limit_usd.toFixed(2)}</td>
            <td className="tnum">{limit.period}</td>
            <td className="tnum">${limit.spend.toFixed(2)}</td>
            <td>{limit.paused ? <span className="badge bad"><span className="dot" />paused</span> : <span className="badge good"><span className="dot" />clear</span>}</td>
            <td className="text-right"><Button size="sm" variant="outline" type="button" disabled={!isAdmin || removeLimit.isPending} onClick={() => removeLimit.mutate(limit.id)}>Remove</Button></td>
          </tr>)}</tbody></table>
      </div> : null}
    </div>
    {containment.agents.length ? <div className="mt-3">
      <div className="panel-note mb-1.5">FROZEN AGENTS</div>
      <div className="table-wrap"><table><thead><tr><th>Agent</th><th>Reason</th><th>Since</th><th /></tr></thead><tbody>
        {containment.agents.map((agent) => <tr key={agent.id}>
          <td className="tnum">{agent.name}</td>
          <td style={{ whiteSpace: "normal" }}>{agent.reason || "-"}</td>
          <td className="tnum">{agent.at ? formatDateTime(agent.at) : "-"}</td>
          <td className="text-right"><Button size="sm" variant="outline" type="button" disabled={!isAdmin || unfreeze.isPending} onClick={() => unfreeze.mutate({ scope: "agent", agent_id: agent.id })}>Unfreeze</Button></td>
        </tr>)}</tbody></table></div>
    </div> : null}
    {containment.tools.length ? <div className="mt-3">
      <div className="panel-note mb-1.5">FROZEN TOOLS</div>
      <div className="table-wrap"><table><thead><tr><th>Tool</th><th>Scope</th><th>Reason</th><th /></tr></thead><tbody>
        {containment.tools.map((tool) => <tr key={tool.id}>
          <td className="tnum">{tool.tool_name}</td>
          <td className="tnum">{tool.agent_id ? agentLabel(agentList, tool.agent_id) : "all agents"}</td>
          <td style={{ whiteSpace: "normal" }}>{tool.reason || "-"}</td>
          <td className="text-right"><Button size="sm" variant="outline" type="button" disabled={!isAdmin || unfreeze.isPending} onClick={() => unfreeze.mutate({ scope: "tool", freeze_id: tool.id })}>Unfreeze</Button></td>
        </tr>)}</tbody></table></div>
    </div> : null}
    {containment.recent.length ? <div className="mt-3">
      <div className="panel-note mb-1.5">RECORDED CONTAINMENT EVENTS</div>
      <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto" }}><table><thead><tr><th>When</th><th>Action</th><th>Scope</th><th>Detail</th></tr></thead><tbody>
        {containment.recent.map((entry) => {
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(entry.payload) as Record<string, unknown>; } catch { /* keep empty */ }
          return <tr key={entry.id}>
            <td className="tnum">{formatDateTime(entry.created_at)}</td>
            <td className="tnum">{String(payload.action ?? "containment")}</td>
            <td className="tnum">{String(payload.scope ?? (payload.agent_id ? "agent" : "tool"))}</td>
            <td className="tnum">{String(payload.reason ?? payload.tool_name ?? payload.agent_id ?? (payload.passed ? "passed" : "-"))}</td>
          </tr>;
        })}</tbody></table></div>
    </div> : null}
    {message ? <div className="mt-3"><Notice>{message}</Notice></div> : null}
  </Panel>;
}

/** Trusted issuers for agent access tokens and ID-JAG assertions (administrators only). */
function IdentityProviders() {
  const client = useQueryClient();
  const whoami = useQuery({ queryKey: ["whoami"], queryFn: () => api<{ email: string; is_admin: boolean }>("/api/whoami") });
  const isAdmin = whoami.data ? whoami.data.is_admin === true || String(whoami.data.is_admin) === "1" : false;
  const query = useQuery({
    queryKey: ["agent-identity-providers"],
    queryFn: () => api<{ providers: AgentIdentityProvider[] }>("/api/v1/agent-identity-providers"),
    enabled: isAdmin,
  });
  const [editorFor, setEditorFor] = useState<AgentIdentityProvider | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgentIdentityProvider | null>(null);
  const invalidate = () => void client.invalidateQueries({ queryKey: ["agent-identity-providers"] });
  const patch = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/agent-identity-providers/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/agent-identity-providers/${id}`, { method: "DELETE" }),
    onSuccess: () => { setConfirmDelete(null); invalidate(); },
  });
  const providers = query.data?.providers ?? [];

  return <Panel flush title="Agent identity providers" note={isAdmin ? "Entra Agent ID, Okta, AgentCore, ID-JAG" : "administrators only"} actions={isAdmin ? <Button variant="outline" type="button" onClick={() => setEditorFor("new")}>New provider</Button> : null}>
    <div style={{ padding: "0 18px 14px" }}>
      <p className="panel-note" style={{ margin: 0 }}>Trusted issuers for agent access tokens and ID-JAG assertions. A valid token resolves to the agent whose identity provider and external subject match; an ID-JAG also binds the end-user principal. Authority still comes from delegations and grants.</p>
    </div>
    <div className="table-wrap"><table className="table-fixed w-full">
      <colgroup>
        <col style={{ width: "40%" }} />
        <col style={{ width: "16%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "32%" }} />
      </colgroup>
      <thead><tr><th>Provider</th><th>Kind</th><th>Status</th><th /></tr></thead>
      <tbody>
        {!isAdmin ? <EmptyRow colSpan={4}>Only administrators can manage identity providers.</EmptyRow>
          : query.isPending ? <EmptyRow colSpan={4}>Loading…</EmptyRow>
            : providers.length ? providers.map((provider) => <tr key={provider.id}>
              <td className="min-w-0">
                <span className="cell-truncate tcell-primary" title={provider.name}>{provider.name}</span>
                <small className="cell-truncate tcell-sub mono" title={provider.issuer}>{provider.issuer}</small>
                <small className="cell-truncate tcell-sub" title={`${provider.audience} · ${provider.agent_provider}`}>aud {provider.audience} · via {provider.agent_provider}</small>
              </td>
              <td className="tnum">{provider.kind}</td>
              <td>{provider.enabled ? <span className={badgeClass("active")}><span className="dot" />enabled</span> : <span className={badgeClass("suspended")}><span className="dot" />disabled</span>}</td>
              <td>
                <div className="actions-end">
                  <Button size="sm" variant="outline" type="button" onClick={() => setEditorFor(provider)}>Edit</Button>
                  <Button size="sm" variant="outline" type="button" disabled={patch.isPending} onClick={() => patch.mutate({ id: provider.id, enabled: !provider.enabled })}>{provider.enabled ? "Disable" : "Enable"}</Button>
                  <Button size="sm" variant="outline" type="button" onClick={() => setConfirmDelete(provider)}>Delete</Button>
                </div>
              </td>
            </tr>) : <EmptyRow colSpan={4}>No identity providers. Agents authenticate with `trxa_` credentials and grants until one is added.</EmptyRow>}
      </tbody>
    </table></div>
    {editorFor ? <ProviderEditor provider={editorFor === "new" ? null : editorFor} onClose={() => setEditorFor(null)} onSaved={() => { setEditorFor(null); invalidate(); }} /> : null}
    {confirmDelete ? <Modal title="Delete identity provider" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b>? Agents relying on its tokens are denied until they present a grant or credential.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </Panel>;
}

function ProviderEditor({ provider, onClose, onSaved }: { provider: AgentIdentityProvider | null; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<ProviderValues>(providerSchema, {
    name: provider?.name ?? "",
    kind: provider?.kind ?? "entra",
    issuer: provider?.issuer ?? "",
    audience: provider?.audience ?? "",
    agentProvider: provider?.agent_provider ?? "entra",
    jwksUri: provider?.jwks_uri ?? "",
    discoveryUrl: provider?.discovery_url ?? "",
    agentClaim: provider?.agent_claim ?? "client_id",
    principalClaim: provider?.principal_claim ?? "sub",
    principalProvider: provider?.principal_provider ?? "oidc",
    subjectClaim: provider?.subject_claim ?? "",
    ttl: String(provider?.token_ttl_seconds ?? 300),
  });
  const save = useMutation({
    mutationFn: (values: ProviderValues) => {
      const body = {
        name: values.name,
        kind: values.kind,
        issuer: values.issuer,
        audience: values.audience,
        agent_provider: values.agentProvider,
        jwks_uri: values.jwksUri.trim() || null,
        discovery_url: values.discoveryUrl.trim() || null,
        agent_claim: values.agentClaim.trim() || "client_id",
        principal_claim: values.principalClaim.trim() || "sub",
        principal_provider: values.principalProvider.trim() || "oidc",
        subject_claim: values.subjectClaim.trim() || null,
        token_ttl_seconds: toNullableNumber(values.ttl) ?? 300,
      };
      return provider
        ? api(`/api/v1/agent-identity-providers/${provider.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : api("/api/v1/agent-identity-providers", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
  });
  return <FormModal title={provider ? `Edit ${provider.name}` : "New identity provider"} form={form} submitLabel={provider ? "Save" : "Add provider"} pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Entra agents" autoFocus />
    <SelectField form={form} name="kind" label="Kind" options={KINDS} />
    <TextField form={form} name="issuer" label="Issuer" placeholder="https://login.microsoftonline.com/<tenant>/v2.0" />
    <TextField form={form} name="audience" label="Audience" placeholder="api://torrix-agents" />
    <TextField form={form} name="agentProvider" label="Agent identity provider" placeholder="entra" />
    <TextField form={form} name="jwksUri" label="JWKS URI (optional)" placeholder="Discovered from the issuer when empty" />
    <TextField form={form} name="discoveryUrl" label="Discovery URL (optional)" placeholder="https://issuer/.well-known/openid-configuration" />
    <div className="grid-2-12">
      <TextField form={form} name="agentClaim" label="Agent claim" placeholder="client_id" />
      <TextField form={form} name="principalClaim" label="Principal claim" placeholder="sub" />
      <TextField form={form} name="principalProvider" label="Principal provider" placeholder="oidc" />
      <TextField form={form} name="subjectClaim" label="External subject claim (optional)" placeholder="azp" />
      <TextField form={form} name="ttl" label="Token TTL (seconds, 60-3600)" inputMode="numeric" placeholder="300" />
    </div>
  </FormModal>;
}
