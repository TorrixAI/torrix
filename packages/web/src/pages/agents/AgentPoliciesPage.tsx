import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  api,
  relTime,
  type Agent,
  type AuthorizationPolicy,
  type AuthorizationPolicyVersion,
  type PolicyPack,
  type PolicySuggestionReport,
  type ShadowReport,
  type SimulationReport,
  type SuggestedPolicy,
} from "../../api";
import { formatDateTime } from "../../api";
import { EmptyRow, ErrorText, InlineSelect, Modal, Notice, PageHead, Panel, toNullableNumber } from "../../components";
import { FormModal, SelectField, TextAreaField, TextField, useZodForm } from "../../form";
import { z } from "zod";
import { AgentNav, badgeClass, conditionsOf, listOf } from "./shared";

export default function AgentPoliciesPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["authz-policies"], queryFn: () => api<{ policies: AuthorizationPolicy[]; shadow_window_days: number }>("/api/v1/policies") });
  const [createOpen, setCreateOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestEdit, setSuggestEdit] = useState<SuggestedPolicy | null>(null);
  const [edit, setEdit] = useState<AuthorizationPolicy | null>(null);
  const [versionsFor, setVersionsFor] = useState<AuthorizationPolicy | null>(null);
  const [shadowFor, setShadowFor] = useState<AuthorizationPolicy | null>(null);
  const [simulate, setSimulate] = useState<{ policy: AuthorizationPolicy; plan: "enforce" | "disable" } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AuthorizationPolicy | null>(null);
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["authz-policies"] });
    void client.invalidateQueries({ queryKey: ["policy-packs"] });
  };
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/policies/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }), onSuccess: () => void invalidate() });
  const setMode = useMutation({
    mutationFn: ({ id, enforcement }: { id: string; enforcement: "enforce" | "shadow" }) => api(`/api/v1/policies/${id}`, { method: "PATCH", body: JSON.stringify({ enforcement }) }),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/v1/policies/${id}`, { method: "DELETE" }), onSuccess: () => { setConfirmDelete(null); void invalidate(); } });
  const policies = query.data?.policies ?? [];
  const shadowDays = query.data?.shadow_window_days ?? 7;

  return <>
    <PageHead title="Authorization policies" sub="Deny-overrides evaluation over actions and resources, with versioned conditions and observe-only mode." actions={<>
      <Button variant="outline" type="button" onClick={() => setSuggestOpen(true)}>Suggest from observed behavior</Button>
      <Button type="button" onClick={() => setCreateOpen(true)}>New policy</Button>
    </>} />
    <AgentNav />
    <PolicyPacks />
    <Panel flush title="Policies" note={`${policies.length} rules`}>
      <div className="table-wrap"><table className="table-fixed w-full">
        <colgroup>
          <col style={{ width: "36%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "25%" }} />
        </colgroup>
        <thead><tr><th>Policy</th><th>Effect</th><th>Mode</th><th className="num">Prio</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <EmptyRow colSpan={5}>Loading…</EmptyRow> : policies.length ? policies.map((policy) => {
            const shadow = policy.enforcement === "shadow";
            return <tr key={policy.id}>
              <td className="min-w-0">
                <span className="cell-truncate tcell-primary" title={policy.name}>{policy.name}{policy.enabled ? null : <span className="chip ml-1.5">disabled</span>}</span>
                <small
         className="cell-truncate tcell-sub"
         
         title={`${listOf(policy.actions).join(", ") || "all actions"} → ${listOf(policy.resources).join(", ") || "all resources"} · v${policy.latest_version}`}>
                  {listOf(policy.actions).join(", ") || "all actions"} → {listOf(policy.resources).join(", ") || "all resources"} · v{policy.latest_version}
                </small>
              </td>
              <td><span className={badgeClass(policy.effect === "allow" ? "active" : policy.effect === "deny" ? "blocked" : "pending")}><span className="dot" />{policy.effect}</span></td>
              <td>
                {shadow ? <>
                  <span className="chip" title="records what it would decide, never blocks">observe only</span>
                  <small className="tcell-sub mono" style={{ display: "block" }}>{policy.shadow ? `${policy.shadow.matched}/${policy.shadow.would_change} · ${shadowDays}d` : "no hits"}</small>
                </> : <span className="panel-note">enforce</span>}
              </td>
              <td className="num">{policy.priority}</td>
              <td>
                <div className="actions-end">
                <Button size="sm" variant="outline" type="button" onClick={() => setEdit(policy)}>Edit</Button>
                <Button size="sm" variant="outline" type="button" onClick={() => setVersionsFor(policy)}>History</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button size="sm" variant="outline" type="button" aria-label={`More actions for ${policy.name}`}>⋯</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {shadow ? <DropdownMenuItem onSelect={() => setShadowFor(policy)}>What it saw</DropdownMenuItem> : null}
                    {shadow ? <DropdownMenuItem onSelect={() => setMode.mutate({ id: policy.id, enforcement: "enforce" })}>Start enforcing</DropdownMenuItem> : null}
                    {shadow ? null : <DropdownMenuItem onSelect={() => setMode.mutate({ id: policy.id, enforcement: "shadow" })}>Observe only</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => setSimulate({ policy, plan: shadow ? "enforce" : "disable" })}>{shadow ? "Test enforcing" : "Test turning off"}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => toggle.mutate({ id: policy.id, enabled: !policy.enabled })}>{policy.enabled ? "Disable" : "Enable"}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setConfirmDelete(policy)}>Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              </td>
            </tr>;
          }) : <EmptyRow colSpan={5}>No policies yet. Without one, the engine defaults to deny.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {suggestOpen ? <SuggestionModal onClose={() => setSuggestOpen(false)} onEdit={(draft) => { setSuggestOpen(false); setSuggestEdit(draft); }} /> : null}
    {createOpen ? <PolicyEditor onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {suggestEdit ? <PolicyEditor policy={suggestedToPolicy(suggestEdit)} onClose={() => setSuggestEdit(null)} onSaved={() => { setSuggestEdit(null); void invalidate(); }} /> : null}
    {edit ? <PolicyEditor policy={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void invalidate(); }} /> : null}
    {versionsFor ? <VersionsModal policy={versionsFor} onClose={() => setVersionsFor(null)} /> : null}
    {shadowFor ? <ShadowModal policy={shadowFor} onClose={() => setShadowFor(null)} /> : null}
    {simulate ? <SimulationModal policy={simulate.policy} plan={simulate.plan} onClose={() => setSimulate(null)} onApply={() => { if (simulate.plan === "enforce") setMode.mutate({ id: simulate.policy.id, enforcement: "enforce" }); else toggle.mutate({ id: simulate.policy.id, enabled: false }); setSimulate(null); }} /> : null}
    {confirmDelete ? <Modal title="Delete policy" onClose={() => setConfirmDelete(null)}>
      <p>Delete <b>{confirmDelete.name}</b>? The permission graph is rebuilt.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete.id)}>Delete</Button></div>
    </Modal> : null}
  </>;
}

function suggestedToPolicy(draft: SuggestedPolicy): AuthorizationPolicy {
  const now = new Date().toISOString();
  return {
    id: "",
    user_id: "",
    project_id: null,
    name: draft.name,
    description: draft.description,
    enabled: 1,
    effect: draft.effect,
    priority: draft.priority,
    conditions: draft.conditions,
    actions: draft.actions,
    resources: draft.resources,
    latest_version: 0,
    created_at: now,
    updated_at: now,
    enforcement: "shadow",
  };
}

function suggestionDraft(policy: SuggestedPolicy) {
  return {
    name: policy.name,
    effect: policy.effect,
    priority: policy.priority,
    actions: policy.actions,
    resources: policy.resources,
    conditions: policy.conditions,
  };
}

function suggestionLimitText(limits: { maximum_amount?: number; automatic_approval_amount?: number; currency?: string }): string {
  const parts: string[] = [];
  if (limits.automatic_approval_amount != null) parts.push(`auto ${limits.currency ?? ""} ${limits.automatic_approval_amount}`.trim());
  if (limits.maximum_amount != null) parts.push(`max ${limits.currency ?? ""} ${limits.maximum_amount}`.trim());
  return parts.length ? parts.join(", ") : "none";
}

/** Reads governed decisions and observed tool calls, then drafts a scope to review. */
function SuggestionModal({ onClose, onEdit }: { onClose: () => void; onEdit: (draft: SuggestedPolicy) => void }) {
  const client = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/api/v1/agents") });
  const existing = useQuery({ queryKey: ["authz-policies"], queryFn: () => api<{ policies: AuthorizationPolicy[] }>("/api/v1/policies") });
  const [agentId, setAgentId] = useState("");
  const [days, setDays] = useState(30);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [simulation, setSimulation] = useState<SimulationReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!agentId && agents.data?.agents.length) setAgentId(agents.data.agents[0]!.id);
  }, [agents.data, agentId]);

  const query = useQuery({
    queryKey: ["policy-suggest", agentId, days],
    queryFn: () => api<{ suggestion: PolicySuggestionReport }>("/api/v1/policies/suggest", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, days }),
    }),
    enabled: Boolean(agentId),
  });
  const suggestion = query.data?.suggestion;

  useEffect(() => {
    if (!suggestion) return;
    const taken = new Set((existing.data?.policies ?? []).map((policy) => policy.name));
    setChosen(Object.fromEntries(suggestion.policies.map((policy) => [policy.name, !taken.has(policy.name)])));
    setSimulation(null);
    setMessage(null);
  }, [suggestion, existing.data]);

  const picked = (suggestion?.policies ?? []).filter((policy) => chosen[policy.name]);
  const simulate = useMutation({
    mutationFn: () => api<{ simulation: SimulationReport }>("/api/v1/policies/simulate", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, days, add: picked.map(suggestionDraft) }),
    }),
    onSuccess: (data) => setSimulation(data.simulation),
    onError: (error: Error) => setMessage(error.message),
  });
  const create = async () => {
    if (!picked.length) {
      setMessage("Select at least one policy.");
      return;
    }
    setSaving(true);
    setMessage(null);
    let created = 0;
    const failures: string[] = [];
    for (const policy of picked) {
      try {
        await api("/api/v1/policies", {
          method: "POST",
          body: JSON.stringify({
            ...suggestionDraft(policy),
            description: policy.description,
            enforcement: "shadow",
            note: "created from observed behavior; observe only",
          }),
        });
        created += 1;
      } catch (error) {
        failures.push(`${policy.name}: ${(error as Error).message}`);
      }
    }
    await client.invalidateQueries({ queryKey: ["authz-policies"] });
    setSaving(false);
    setMessage(created
      ? `Created ${created} observe-only polic${created === 1 ? "y" : "ies"}. Nothing is enforced until you switch a policy to enforce.${failures.length ? ` ${failures.length} failed: ${failures[0]}` : ""}`
      : `Nothing was created. ${failures[0] ?? ""}`);
  };

  const delegation = suggestion?.delegation;
  const createDelegation = useMutation({
    mutationFn: () => api("/api/v1/delegations", {
      method: "POST",
      body: JSON.stringify({
        agent_id: delegation!.agent_id,
        principal_id: delegation!.principal_id,
        allowed_actions: delegation!.allowed_actions,
        allowed_resources: delegation!.allowed_resources,
        limits: delegation!.limits,
        purpose: delegation!.purpose,
      }),
    }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["delegations"] });
      setMessage("Delegation created. Review it on the Delegations page.");
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return <Modal title="Suggest from observed behavior" onClose={onClose}>
    <div className="flex flex-wrap items-center gap-3">
      <InlineSelect className="w-[260px]" value={agentId} onValueChange={setAgentId} placeholder="Select an agent" options={(agents.data?.agents ?? []).map((agent) => ({ value: agent.id, label: agent.name }))} />
      <InlineSelect className="w-[150px]" value={String(days)} onValueChange={(value) => setDays(Number(value))} options={[7, 30, 90].map((value) => ({ value: String(value), label: `last ${value} days` }))} />
      <span className="panel-note">Reads governed decisions and observed tool calls. Nothing is written.</span>
    </div>
    {!agents.isPending && !(agents.data?.agents ?? []).length ? <div className="mt-3"><Notice>Register a governed agent first. This reads that agent's recorded requests.</Notice></div> : null}
    {query.isPending && agentId ? <p className="panel-note mt-3">Reading history...</p> : null}
    {query.isError ? <ErrorText>{query.error.message}</ErrorText> : null}
    {suggestion ? <>
      <div className="stat-tiles" style={{ marginTop: 12 }}>
        <div className="stat-tile"><span className="st-label">Governed requests</span><div className="st-value">{suggestion.sources.governed_requests}</div><div className="st-sub">{suggestion.sources.allowed} allowed, {suggestion.sources.denied} denied, {suggestion.sources.held} held</div></div>
        <div className="stat-tile"><span className="st-label">Tool calls</span><div className="st-value">{suggestion.sources.tool_calls}</div><div className="st-sub">{suggestion.sources.runs} runs in the window</div></div>
        <div className="stat-tile"><span className="st-label">Observed actions</span><div className="st-value">{suggestion.observations.actions.length}</div><div className="st-sub">{suggestion.observations.resources.length} resources</div></div>
        <div className="stat-tile"><span className="st-label">Confidence</span><div className="st-value">{suggestion.confidence}</div><div className="st-sub">{suggestion.observations.amounts.count} amounts seen</div></div>
      </div>

      {delegation ? <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <strong>Delegation draft</strong>
          <span className={badgeClass(delegation.action === "create" ? "pending" : delegation.action === "none" ? "active" : "suspended")}>{delegation.action.replace("_", " ")}</span>
        </div>
        <p className="panel-note" style={{ marginTop: 4 }}>{delegation.reason}</p>
        <div style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12.5 }}>
          <div><span className="panel-note">Actions </span>{delegation.allowed_actions.join(", ") || "-"}</div>
          <div><span className="panel-note">Resources </span>{delegation.allowed_resources.join(", ") || "-"}</div>
          <div><span className="panel-note">Limits </span>{suggestionLimitText(delegation.limits)}</div>
          {delegation.existing ? <div><span className="panel-note">Existing </span>{delegation.existing.allowed_actions.join(", ") || "-"} | {suggestionLimitText(delegation.existing.limits)}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          {delegation.action === "create" && delegation.principal_id ? <Button variant="outline" type="button" disabled={createDelegation.isPending} onClick={() => createDelegation.mutate()}>Create delegation</Button> : null}
          {delegation.action === "narrow_existing" ? <a className="btn btn-outline" href="/ui/agents/delegations">Narrow the existing delegation</a> : null}
          {delegation.action === "create" && !delegation.principal_id ? <span className="panel-note">Choose a principal on the Delegations page, then create it there.</span> : null}
        </div>
      </div> : null}

      <div className="table-wrap" style={{ maxHeight: 300, overflow: "auto", marginTop: 12 }}>
        <table>
          <thead><tr><th style={{ width: 34 }} /><th>Suggested policy</th><th>Effect</th><th>Why</th><th /></tr></thead>
          <tbody>
            {suggestion.policies.length ? suggestion.policies.map((policy) => {
              const taken = new Set((existing.data?.policies ?? []).map((entry) => entry.name)).has(policy.name);
              return <tr key={policy.name}>
                <td><input type="checkbox" aria-label={`Include ${policy.name}`} checked={Boolean(chosen[policy.name]) && !taken} disabled={taken} onChange={(event) => setChosen({ ...chosen, [policy.name]: event.target.checked })} /></td>
                <td className="min-w-0">
                  <span className="tcell-primary">{policy.name}</span>
                  <small className="tcell-sub" style={{ display: "block" }}>{policy.actions.join(", ")} | {policy.resources.join(", ")}</small>
                </td>
                <td><span className={badgeClass(policy.effect === "allow" ? "active" : policy.effect === "deny" ? "blocked" : "pending")}>{policy.effect}</span></td>
                <td style={{ whiteSpace: "normal", color: "var(--text-2)" }}>{policy.reason}{taken ? <span className="chip ml-1.5">already exists</span> : null}</td>
                <td><Button size="sm" variant="outline" type="button" onClick={() => onEdit(policy)}>Review</Button></td>
              </tr>;
            }) : <EmptyRow colSpan={5}>No policy draft: the agent has no allowed behavior in this window.</EmptyRow>}
          </tbody>
        </table>
      </div>

      {suggestion.outliers.length ? <div className="mt-3">
        <div className="panel-note mb-1.5">OUTLIERS</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-2)" }}>
          {suggestion.outliers.map((outlier) => <li key={`${outlier.kind}-${outlier.action ?? "all"}`}>{outlier.detail}</li>)}
        </ul>
      </div> : null}

      {suggestion.warnings.length ? <div className="mt-3">
        {suggestion.warnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
      </div> : null}

      {simulation ? <div className="stat-tiles" style={{ marginTop: 12 }}>
        <div className="stat-tile"><span className="st-label">Replayed</span><div className="st-value">{simulation.totals.replayed}</div><div className="st-sub">of {simulation.totals.requests} requests</div></div>
        <div className="stat-tile"><span className="st-label">Would change</span><div className="st-value">{simulation.totals.changed}</div><div className="st-sub">{simulation.totals.unchanged} unchanged</div></div>
        <div className="stat-tile"><span className="st-label">Newly denied</span><div className="st-value">{simulation.newly.denied}</div><div className="st-sub">was allowed</div></div>
        <div className="stat-tile"><span className="st-label">Newly held</span><div className="st-value">{simulation.newly.held}</div><div className="st-sub">needs approval</div></div>
      </div> : null}
      {message ? <div className="mt-3"><Notice>{message}</Notice></div> : null}

      <div className="modal-actions">
        <Button variant="outline" type="button" onClick={onClose}>Close</Button>
        <Button variant="outline" type="button" disabled={!picked.length || simulate.isPending} onClick={() => simulate.mutate()}>Test selected against history</Button>
        <Button type="button" disabled={!picked.length || saving} onClick={() => void create()}>{saving ? "Creating..." : "Create selected, observe only"}</Button>
      </div>
    </> : null}
  </Modal>;
}

/** Reviewed starting points; an install skips policies whose name already exists. */
function PolicyPacks() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["policy-packs"], queryFn: () => api<{ packs: PolicyPack[] }>("/api/v1/policy-packs") });
  const policies = useQuery({ queryKey: ["authz-policies"], queryFn: () => api<{ policies: AuthorizationPolicy[] }>("/api/v1/policies") });
  const [message, setMessage] = useState<string | null>(null);
  const install = useMutation({
    mutationFn: ({ id, enforcement }: { id: string; enforcement: "enforce" | "shadow" }) =>
      api<{ created: number; skipped: number }>(`/api/v1/policy-packs/${id}/install`, { method: "POST", body: JSON.stringify({ enforcement }) }),
    onSuccess: (result, variables) => {
      setMessage(result.created
        ? `Installed ${result.created} ${variables.enforcement === "shadow" ? "observe-only " : ""}polic${result.created === 1 ? "y" : "ies"}${result.skipped ? `, skipped ${result.skipped} already present` : ""}.`
        : "Every policy in that pack is already present.");
      void client.invalidateQueries({ queryKey: ["authz-policies"] });
      void client.invalidateQueries({ queryKey: ["policy-packs"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });
  if (query.isPending || !query.data?.packs.length) return null;
  const existing = new Set((policies.data?.policies ?? []).map((policy) => policy.name));
  return <Panel flush title="Policy packs" note="reviewed starting points; installs skip policies with the same name">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, padding: "14px 18px 18px" }}>
      {query.data.packs.map((pack) => {
        const installed = pack.policies.every((policy) => existing.has(policy.name));
        return <div key={pack.id} className="locked-card" style={{ display: "grid", gap: 10, padding: 14, border: "1px solid var(--line)", borderRadius: "var(--r-lg)", maxWidth: "none" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{pack.name}</div>
            <div className="panel-note" style={{ marginTop: 2 }}>{pack.description}</div>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {pack.policies.map((policy) => <div key={policy.name} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <span className={badgeClass(policy.effect === "allow" ? "active" : policy.effect === "deny" ? "blocked" : "pending")}>{policy.effect}</span>
              <span style={{ color: "var(--text-2)" }}>{policy.name}</span>
            </div>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" type="button" disabled={install.isPending || installed} onClick={() => install.mutate({ id: pack.id, enforcement: "shadow" })}>Install, observe only</Button>
            <Button variant="outline" type="button" disabled={install.isPending || installed} onClick={() => install.mutate({ id: pack.id, enforcement: "enforce" })}>Install and enforce</Button>
            {installed ? <span className="panel-note">all installed</span> : null}
          </div>
        </div>;
      })}
    </div>
    {message ? <div style={{ padding: "0 18px 16px" }}><Notice>{message}</Notice></div> : null}
  </Panel>;
}

/** What an observe-only policy would have decided, plus the requests it matched. */
function ShadowModal({ policy, onClose }: { policy: AuthorizationPolicy; onClose: () => void }) {
  const [days, setDays] = useState(7);
  const query = useQuery({ queryKey: ["policy-shadow", policy.id, days], queryFn: () => api<ShadowReport>(`/api/v1/policies/${policy.id}/shadow?days=${days}`) });
  const report = query.data;
  return <Modal title={`What it saw · ${policy.name}`} onClose={onClose}>
    <div className="flex items-center gap-3">
      <InlineSelect className="w-[160px]" value={String(days)} onValueChange={(value) => setDays(Number(value))} options={[7, 30, 90].map((value) => ({ value: String(value), label: `last ${value} days` }))} />
      {report ? <span className="panel-note">{report.requests_in_window} authorization requests in the window · {report.enforcement}</span> : null}
    </div>
    {query.isPending ? <p className="panel-note">Loading…</p> : query.isError ? <ErrorText>{query.error.message}</ErrorText> : report ? <>
      <div className="stat-tiles" style={{ marginTop: 12 }}>
        <div className="stat-tile"><span className="st-label">Matched</span><div className="st-value">{report.stats.matched}</div></div>
        <div className="stat-tile"><span className="st-label">Would change</span><div className="st-value">{report.stats.would_change}</div></div>
        <div className="stat-tile"><span className="st-label">Would deny</span><div className="st-value">{report.stats.would_deny}</div></div>
        <div className="stat-tile"><span className="st-label">Would hold</span><div className="st-value">{report.stats.would_hold}</div><div className="st-sub">{report.stats.last_hit_at ? `last ${relTime(report.stats.last_hit_at)}` : "no hits"}</div></div>
      </div>
      {report.examples.length ? <div className="table-wrap" style={{ maxHeight: 300, overflow: "auto", marginTop: 12 }}>
        <table>
          <thead><tr><th>When</th><th>Action</th><th>Would</th><th>Actual</th></tr></thead>
          <tbody>
            {report.examples.map((example) => <tr key={example.request_id}>
              <td className="tcell-muted tnum">{relTime(example.at)}</td>
              <td className="tnum">{example.action}{example.tool ? ` · ${example.tool}` : ""}</td>
              <td><span className={badgeClass(example.would === "allow" ? "active" : example.would === "deny" ? "blocked" : "pending")}>{example.would}</span></td>
              <td><span className={badgeClass(example.actual === "allow" ? "active" : example.actual === "deny" ? "blocked" : "pending")}>{example.actual}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <div className="mt-3"><Notice>{report.stats.matched
        ? `Matched ${report.stats.matched} request${report.stats.matched === 1 ? "" : "s"}, but none would have decided differently: enforcing it would change nothing in this window.`
        : "No request matched this policy in the window. Nothing to enforce yet."}</Notice></div>}
    </> : null}
    <div className="modal-actions"><Button type="button" onClick={onClose}>Close</Button></div>
  </Modal>;
}

/** Replays stored authorization requests against a candidate policy set. */
function SimulationModal({ policy, plan, onClose, onApply }: { policy: AuthorizationPolicy; plan: "enforce" | "disable"; onClose: () => void; onApply: () => void }) {
  const [days, setDays] = useState(30);
  const query = useQuery({
    queryKey: ["policy-simulate", policy.id, plan, days],
    queryFn: () => api<{ simulation: SimulationReport }>("/api/v1/policies/simulate", {
      method: "POST",
      body: JSON.stringify({
        days,
        ...(plan === "enforce"
          ? { replace: [{ id: policy.id, fields: { effect: policy.effect, priority: policy.priority, actions: listOf(policy.actions), resources: listOf(policy.resources), conditions: conditionsOf(policy.conditions) } }] }
          : { disable: [policy.id] }),
      }),
    }),
  });
  const report = query.data?.simulation;
  return <Modal title={`${plan === "enforce" ? "Test enforcing" : "Test turning off"} · ${policy.name}`} onClose={onClose}>
    <div className="flex items-center gap-3">
      <InlineSelect className="w-[160px]" value={String(days)} onValueChange={(value) => setDays(Number(value))} options={[7, 30, 90].map((value) => ({ value: String(value), label: `replay ${value} days` }))} />
      {report ? <span className="panel-note">{report.totals.replayed} of {report.totals.requests} requests replayed{report.window.truncated ? " (window truncated)" : ""}</span> : null}
    </div>
    <Notice>Replays stored requests against the candidate set. Nothing is written: no decisions, approvals or ledger entries.</Notice>
    {query.isPending ? <p className="panel-note">Replaying…</p> : query.isError ? <ErrorText>{query.error.message}</ErrorText> : report ? <>
      <div className="stat-tiles">
        <div className="stat-tile"><span className="st-label">Would change</span><div className="st-value">{report.totals.changed}</div><div className="st-sub">{report.totals.unchanged} unchanged</div></div>
        <div className="stat-tile"><span className="st-label">Newly denied</span><div className="st-value">{report.newly.denied}</div><div className="st-sub">was allowed before</div></div>
        <div className="stat-tile"><span className="st-label">Newly held</span><div className="st-value">{report.newly.held}</div><div className="st-sub">needs approval</div></div>
        <div className="stat-tile"><span className="st-label">Drift</span><div className="st-value">{report.totals.drifted_from_recorded}</div><div className="st-sub">today differs from the recorded decision</div></div>
      </div>
      {Object.keys(report.transitions).length ? <div className="mt-3">
        <div className="panel-note mb-1.5">TRANSITIONS · current → candidate</div>
        <div className="flex flex-wrap gap-2">{Object.entries(report.transitions).map(([key, count]) => <span key={key} className="chip mono">{key}: {count}</span>)}</div>
      </div> : null}
      {report.by_agent.length ? <div className="table-wrap mt-3" style={{ maxHeight: 200, overflow: "auto" }}>
        <table><thead><tr><th>Agent</th><th className="num">Changed</th></tr></thead><tbody>
          {report.by_agent.map((row) => <tr key={row.agent_id}><td className="tnum">{row.agent_name}</td><td className="num">{row.changed}</td></tr>)}
        </tbody></table>
      </div> : null}
      {report.samples.length ? <div className="table-wrap mt-3" style={{ maxHeight: 260, overflow: "auto" }}>
        <table><thead><tr><th>When</th><th>Agent</th><th>Action</th><th>Now</th><th>With the change</th></tr></thead><tbody>
          {report.samples.map((sample) => <tr key={sample.request_id}>
            <td className="tcell-muted tnum">{relTime(sample.at)}</td>
            <td className="tnum">{sample.agent_name}</td>
            <td className="tnum">{sample.action}{sample.target ? ` · ${sample.target}` : ""}</td>
            <td><span className={badgeClass(sample.current.decision === "allow" ? "active" : sample.current.decision === "deny" ? "blocked" : "pending")}>{sample.current.decision}</span></td>
            <td><span className={badgeClass(sample.candidate.decision === "allow" ? "active" : sample.candidate.decision === "deny" ? "blocked" : "pending")}>{sample.candidate.decision}</span></td>
          </tr>)}
        </tbody></table>
      </div> : null}
      {!report.samples.length ? <div className="mt-3"><Notice>No decision changed in this window.</Notice></div> : null}
    </> : null}
    <div className="modal-actions">
      <Button variant="outline" type="button" onClick={onClose}>Close</Button>
      <Button type="button" onClick={onApply}>{plan === "enforce" ? "Start enforcing" : "Turn it off"}</Button>
    </div>
  </Modal>;
}

const agentPolicySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
  effect: z.enum(["deny", "allow", "require_approval"]),
  enforcement: z.enum(["enforce", "shadow"]),
  priority: z.string(),
  actions: z.string().trim().min(1, "Actions are required"),
  resources: z.string().trim().min(1, "Resources are required"),
  conditions: z.string(),
  note: z.string(),
});
type AgentPolicyValues = z.infer<typeof agentPolicySchema>;

function PolicyEditor({ policy, onClose, onSaved }: { policy?: AuthorizationPolicy; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(policy?.id);
  const form = useZodForm<AgentPolicyValues>(agentPolicySchema, {
    name: policy?.name ?? "",
    description: policy?.description ?? "",
    effect: policy?.effect ?? "deny",
    enforcement: policy?.enforcement ?? "enforce",
    priority: String(policy?.priority ?? 100),
    actions: listOf(policy?.actions).join(", "),
    resources: listOf(policy?.resources).join(", "),
    conditions: policy ? JSON.stringify(conditionsOf(policy.conditions), null, 2) : "",
    note: "",
  });
  const save = useMutation({
    mutationFn: (values: AgentPolicyValues) => {
      const body: Record<string, unknown> = {
        name: values.name, description: values.description, effect: values.effect, enforcement: values.enforcement,
        priority: toNullableNumber(values.priority) ?? 100,
        actions: values.actions.split(",").map((item) => item.trim()).filter(Boolean),
        resources: values.resources.split(",").map((item) => item.trim()).filter(Boolean),
        note: values.note || undefined,
      };
      if (values.conditions.trim()) body.conditions = JSON.parse(values.conditions);
      return editing && policy ? api(`/api/v1/policies/${policy.id}`, { method: "PATCH", body: JSON.stringify(body) }) : api("/api/v1/policies", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: onSaved,
  });
  const mode = form.watch("enforcement");
  return <FormModal title={editing ? "Edit policy" : "New policy"} form={form} submitLabel={editing ? "Save" : "Create"} pending={save.isPending} error={save.isError ? (save.error.message === "SyntaxError" ? "Invalid conditions JSON" : save.error.message) : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Procurement Purchase Order Policy" autoFocus />
    <div className="grid-2-12">
      <SelectField form={form} name="effect" label="Effect" options={[{ value: "deny", label: "deny" }, { value: "allow", label: "allow" }, { value: "require_approval", label: "require_approval" }]} />
      <SelectField form={form} name="enforcement" label="Mode" options={[{ value: "enforce", label: "enforce" }, { value: "shadow", label: "observe only" }]} />
      <TextField form={form} name="priority" label="Priority" inputMode="numeric" placeholder="100" />
      <TextField form={form} name="actions" label="Actions (comma)" placeholder="createPurchaseOrder, read*" />
    </div>
    <Notice>{mode === "shadow" ? "Observe only records what the policy would have decided and never blocks. Start here for a new rule, then check \"What it saw\"." : "Lower priority wins first; deny always overrides."}</Notice>
    <TextField form={form} name="resources" label="Resources (comma)" placeholder="purchase_order" />
    <TextField form={form} name="description" label="Description" placeholder="Amount thresholds for purchase orders" />
    <TextAreaField form={form} name="conditions" label="Conditions (JSON, optional)" rows={4} placeholder='{"all":[{"field":"params.amount","op":"lte","value":1000}]}' />
    <TextField form={form} name="note" label="Change note" placeholder="what changed" />
  </FormModal>;
}

function VersionsModal({ policy, onClose }: { policy: AuthorizationPolicy; onClose: () => void }) {
  const query = useQuery({ queryKey: ["policy-versions", policy.id], queryFn: () => api<{ versions: AuthorizationPolicyVersion[] }>(`/api/v1/policies/${policy.id}/versions`) });
  const versions = query.data?.versions ?? [];
  return <Modal title={`Version history · ${policy.name}`} onClose={onClose}>
    <div className="table-wrap" style={{ maxHeight: 340, overflow: "auto" }}>
      <table>
        <thead><tr><th className="num">Ver</th><th>Note</th><th>Created</th></tr></thead>
        <tbody>
          {query.isPending ? <EmptyRow colSpan={3}>Loading…</EmptyRow> : versions.length ? versions.map((version) => <tr key={version.id}>
            <td className="num">v{version.version}</td>
            <td className="tcell-muted">{version.note || "-"}</td>
            <td className="tcell-muted tnum">{formatDateTime(version.created_at)}</td>
          </tr>) : <EmptyRow colSpan={3}>No versions.</EmptyRow>}
        </tbody>
      </table>
    </div>
    <Notice>Policies have no active revision; the latest version is evaluated.</Notice>
    <div className="modal-actions"><Button type="button" onClick={onClose}>Close</Button></div>
  </Modal>;
}
