import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, relTime, type Agent, type Delegation, type DelegationGrant, type Principal } from "../../api";
import { formatDate, formatDateTime } from "../../api";
import { EmptyRow, ErrorText, Modal, Notice, PageHead, Panel, toNullableNumber } from "../../components";
import { FormModal, SelectField, TextField, useZodForm } from "../../form";
import { z } from "zod";
import { AgentNav, agentLabel, badgeClass, limitsOf, listOf } from "./shared";

export default function DelegationsPage() {
  const client = useQueryClient();
  const delegations = useQuery({ queryKey: ["delegations"], queryFn: () => api<{ delegations: Delegation[] }>("/api/v1/delegations") });
  const principals = useQuery({ queryKey: ["principals"], queryFn: () => api<{ principals: Principal[] }>("/api/v1/principals") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/api/v1/agents") });
  const [createOpen, setCreateOpen] = useState(false);
  const [principalOpen, setPrincipalOpen] = useState(false);
  const [revoke, setRevoke] = useState<Delegation | null>(null);
  const [grant, setGrant] = useState<Delegation | null>(null);
  const [grantsFor, setGrantsFor] = useState<Delegation | null>(null);
  const removePrincipal = useMutation({
    mutationFn: (id: string) => api(`/api/v1/principals/${id}`, { method: "DELETE" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["principals"] }); void client.invalidateQueries({ queryKey: ["delegations"] }); },
  });
  const [token, setToken] = useState<string | null>(null);

  const invalidate = () => void client.invalidateQueries({ queryKey: ["delegations"] });
  const revokeMutation = useMutation({ mutationFn: (id: string) => api<{ cascaded_children: number }>(`/api/v1/delegations/${id}/revoke`, { method: "POST" }), onSuccess: () => { setRevoke(null); invalidate(); } });

  const rows = delegations.data?.delegations ?? [];
  const agentList = agents.data?.agents ?? [];
  const principalList = principals.data?.principals ?? [];

  return <>
    <PageHead title="Delegations" sub="Grant an agent a scoped, limited authority from a principal." actions={<>
      <Button variant="outline" type="button" onClick={() => setPrincipalOpen(true)}>New principal</Button>
      <Button type="button" onClick={() => setCreateOpen(true)}>New delegation</Button>
    </>} />
    <AgentNav />

    <Panel flush title="Delegations" note={`${rows.filter((row) => (row.effective_status ?? row.status) === "active").length} active · ${rows.length} total`}>
      <div className="table-wrap"><table className="wide-table">
        <thead><tr><th>Principal</th><th>Agent</th><th>Scope</th><th data-priority="low">Limits</th><th>Status</th><th data-priority="low">Expires</th><th /></tr></thead>
        <tbody>
          {delegations.isPending ? <EmptyRow colSpan={7}>Loading…</EmptyRow> : rows.length ? rows.map((delegation) => {
            const limits = limitsOf(delegation.limits);
            const actions = listOf(delegation.allowed_actions);
            const resources = listOf(delegation.allowed_resources);
            return <tr key={delegation.id}>
              <td className="min-w-0"><span className="tcell-primary">{principalList.find((principal) => principal.id === delegation.principal_id)?.display_name ?? delegation.principal_id.slice(0, 8)}</span></td>
              <td className="min-w-0">
                <span className="tcell-primary">{agentLabel(agentList, delegation.agent_id)}</span>
                <small className="tcell-sub">depth {delegation.depth}</small>
                {delegation.delegator_agent_id ? <small className="tcell-sub">from {agentLabel(agentList, delegation.delegator_agent_id)} <span className="chip" title="created by an agent hand-off">a2a</span></small> : null}
              </td>
              <td className="min-w-0">
                <span style={{ color: "var(--text-2)" }}>{actions.length <= 3 ? actions.join(", ") : `${actions.slice(0, 3).join(", ")} +${actions.length - 3}`}</span>
                <small className="tcell-sub" title={resources.join(", ")}>{resources.length <= 3 ? resources.join(", ") : `${resources.slice(0, 3).join(", ")} +${resources.length - 3}`}</small>
              </td>
              <td className="tcell-muted tnum" data-priority="low">{limits.maximum_amount != null ? `max ${limits.currency ?? "USD"} ${limits.maximum_amount}` : limits.automatic_approval_amount != null ? `auto ≤ ${limits.currency ?? "USD"} ${limits.automatic_approval_amount}` : "none"}</td>
              <td><span className={badgeClass(delegation.effective_status ?? delegation.status)}><span className="dot" />{delegation.effective_status ?? delegation.status}</span></td>
              <td className="tcell-muted whitespace-nowrap tnum" data-priority="low">{delegation.expires_at ? formatDate(delegation.expires_at) : "never"}</td>
              <td>
                <div className="actions-end">
                  <Button size="sm" variant="outline" type="button" disabled={(delegation.effective_status ?? delegation.status) !== "active"} onClick={() => setGrant(delegation)}>Grant</Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="outline" type="button" aria-label={`More actions for ${agentLabel(agentList, delegation.agent_id)}`}>⋯</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setGrantsFor(delegation)}>Grants</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRevoke(delegation)} disabled={(delegation.effective_status ?? delegation.status) !== "active"}>Revoke</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </td>
            </tr>;
          }) : <EmptyRow colSpan={7}>No delegations yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    <Panel flush title="Principals" note={`${principalList.length} total`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Kind</th><th>Provider</th><th>External subject</th><th>Status</th><th /></tr></thead>
        <tbody>
          {principalList.length ? principalList.map((principal) => <tr key={principal.id}>
            <td className="tcell-primary">{principal.display_name}</td>
            <td className="tnum">{principal.kind}</td>
            <td className="tnum">{principal.identity_provider}</td>
            <td className="tcell-muted tnum">{principal.external_subject || principal.email || "-"}</td>
            <td><span className={badgeClass(principal.status === "active" ? "active" : "suspended")}><span className="dot" />{principal.status}</span></td>
            <td className="text-right"><Button variant="outline" type="button" disabled={removePrincipal.isPending} onClick={() => removePrincipal.mutate(principal.id)}>Delete</Button></td>
          </tr>) : <EmptyRow colSpan={6}>No principals yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {createOpen ? <CreateDelegation agents={agentList} principals={principalList} delegations={rows} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); invalidate(); }} /> : null}
    {principalOpen ? <CreatePrincipal onClose={() => setPrincipalOpen(false)} onSaved={() => { setPrincipalOpen(false); void client.invalidateQueries({ queryKey: ["principals"] }); }} /> : null}
    {revoke ? <Modal title="Revoke delegation" onClose={() => setRevoke(null)}>
      <p>Revoke this delegation? Active child delegations are cascaded.</p>
      {revokeMutation.isError ? <ErrorText>{revokeMutation.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setRevoke(null)}>Cancel</Button><Button variant="destructive" type="button" disabled={revokeMutation.isPending} onClick={() => revokeMutation.mutate(revoke.id)}>Revoke</Button></div>
    </Modal> : null}
    {grant ? <GrantDelegation delegation={grant} onClose={() => setGrant(null)} onGranted={(value) => { setGrant(null); setToken(value); }} /> : null}
    {grantsFor ? <GrantsModal delegation={grantsFor} onClose={() => setGrantsFor(null)} /> : null}
    {token ? <Modal title="Delegation grant" onClose={() => setToken(null)}>
      <p>Present this token to the gateway as <code>x-torrix-grant</code>.</p>
      <div className="keybox"><code>{token}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(token)}>Copy</Button></div>
      <div className="modal-actions"><Button type="button" onClick={() => setToken(null)}>Done</Button></div>
    </Modal> : null}
  </>;
}

const delegationSchema = z.object({
  agentId: z.string(),
  principalId: z.string(),
  parentId: z.string(),
  actions: z.string().trim().min(1, "Allowed actions are required"),
  resources: z.string().trim().min(1, "Allowed resources are required"),
  purpose: z.string(),
  maxAmount: z.string(),
  autoAmount: z.string(),
  currency: z.string().trim().min(1, "Currency is required"),
  expiresAt: z.string(),
}).refine((values) => values.agentId !== "" && (values.principalId !== "" || values.parentId !== ""), { message: "Select an agent and a principal or parent delegation", path: ["principalId"] });
type DelegationValues = z.infer<typeof delegationSchema>;

function CreateDelegation({ agents, principals, delegations, onClose, onSaved }: { agents: Agent[]; principals: Principal[]; delegations: Delegation[]; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<DelegationValues>(delegationSchema, { agentId: agents[0]?.id ?? "", principalId: principals[0]?.id ?? "", parentId: "", actions: "", resources: "", purpose: "", maxAmount: "", autoAmount: "", currency: "USD", expiresAt: "" });
  const parentId = form.watch("parentId");
  const create = useMutation({
    mutationFn: (values: DelegationValues) => api("/api/v1/delegations", {
      method: "POST",
      body: JSON.stringify({
        agent_id: values.agentId,
        principal_id: values.parentId ? undefined : values.principalId || undefined,
        parent_delegation_id: values.parentId || undefined,
        allowed_actions: values.actions.split(",").map((item) => item.trim()).filter(Boolean),
        allowed_resources: values.resources.split(",").map((item) => item.trim()).filter(Boolean),
        limits: { maximum_amount: toNullableNumber(values.maxAmount) ?? undefined, automatic_approval_amount: toNullableNumber(values.autoAmount) ?? undefined, currency: values.currency },
        purpose: values.purpose || undefined,
        expires_at: values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined,
      }),
    }),
    onSuccess: onSaved,
  });
  return <FormModal title="New delegation" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <Notice>A delegation needs a principal or a parent delegation. Scope must be a subset of the parent.</Notice>
    <div className="grid-2-12">
      <SelectField form={form} name="agentId" label="Agent" options={agents.map((agent) => ({ value: agent.id, label: agent.name }))} />
      <SelectField form={form} name="principalId" label="Principal" disabled={!!parentId} options={[{ value: "", label: "select" }, ...principals.map((principal) => ({ value: principal.id, label: principal.display_name }))]} />
      <SelectField form={form} name="parentId" label="Parent delegation (optional)" options={[{ value: "", label: "none" }, ...delegations.map((delegation) => ({ value: delegation.id, label: `${delegation.id.slice(0, 8)} · ${delegation.status}` }))]} />
      <TextField form={form} name="purpose" label="Purpose" placeholder="purchase orders under 10k" />
      <TextField form={form} name="actions" label="Allowed actions (comma)" placeholder="readPurchaseOrder, createPurchaseOrder" />
      <TextField form={form} name="resources" label="Allowed resources (comma)" placeholder="SAP, billing-system" />
      <TextField form={form} name="maxAmount" label="Maximum amount" inputMode="decimal" placeholder="100000" />
      <TextField form={form} name="autoAmount" label="Automatic approval amount" inputMode="decimal" placeholder="10000" />
      <TextField form={form} name="currency" label="Currency" placeholder="USD" />
      <TextField form={form} name="expiresAt" label="Expires at" type="datetime-local" />
    </div>
  </FormModal>;
}

const principalSchema = z.object({
  kind: z.enum(["human", "service", "application", "external"]),
  provider: z.enum(["local", "oidc", "entra", "okta", "sap_ias"]),
  displayName: z.string().trim().min(1, "Display name is required"),
  email: z.string(),
  externalSubject: z.string(),
}).refine((values) => values.provider === "local" || values.externalSubject.trim() !== "", { message: "External subject is required", path: ["externalSubject"] });
type PrincipalValues = z.infer<typeof principalSchema>;

function CreatePrincipal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<PrincipalValues>(principalSchema, { kind: "human", provider: "local", displayName: "", email: "", externalSubject: "" });
  const provider = form.watch("provider");
  const create = useMutation({ mutationFn: (values: PrincipalValues) => api("/api/v1/principals", { method: "POST", body: JSON.stringify({ kind: values.kind, identity_provider: values.provider, display_name: values.displayName, email: values.email || undefined, external_subject: values.externalSubject || undefined }) }), onSuccess: onSaved });
  return <FormModal title="New principal" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <div className="grid-2-12">
      <SelectField form={form} name="kind" label="Kind" options={[{ value: "human", label: "human" }, { value: "service", label: "service" }, { value: "application", label: "application" }, { value: "external", label: "external" }]} />
      <SelectField form={form} name="provider" label="Identity provider" options={[{ value: "local", label: "local" }, { value: "oidc", label: "oidc" }, { value: "entra", label: "entra" }, { value: "okta", label: "okta" }, { value: "sap_ias", label: "sap_ias" }]} />
    </div>
    <TextField form={form} name="displayName" label="Display name" placeholder="Dana Owner" autoFocus />
    <TextField form={form} name="email" label="Email" placeholder="dana.owner@corp.example" />
    {provider !== "local" ? <TextField form={form} name="externalSubject" label="External subject" placeholder="required when the provider is not local" /> : null}
  </FormModal>;
}

const grantSchema = z.object({ ttl: z.string() });
type GrantValues = z.infer<typeof grantSchema>;

function GrantDelegation({ delegation, onClose, onGranted }: { delegation: Delegation; onClose: () => void; onGranted: (token: string) => void }) {
  const form = useZodForm<GrantValues>(grantSchema, { ttl: "1440" });
  const grant = useMutation({ mutationFn: (values: GrantValues) => api<{ token: string }>(`/api/v1/delegations/${delegation.id}/grant`, { method: "POST", body: JSON.stringify({ ttl_minutes: toNullableNumber(values.ttl) ?? 1440 }) }), onSuccess: (data) => onGranted(data.token) });
  return <FormModal title="Mint delegation grant" form={form} submitLabel="Mint" pending={grant.isPending} error={grant.isError ? grant.error.message : null} onClose={onClose} onSubmit={(values) => grant.mutate(values)}>
    <Notice>Signed, time-boxed token that pins this delegation chain at the gateway.</Notice>
    <TextField form={form} name="ttl" label="TTL (minutes)" inputMode="numeric" placeholder="60" />
  </FormModal>;
}

/** Grants minted from this delegation: list, revoke one, or revoke all of them. */
function GrantsModal({ delegation, onClose }: { delegation: Delegation; onClose: () => void }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["delegation-grants", delegation.id],
    queryFn: () => api<{ grants: DelegationGrant[] }>(`/api/v1/delegations/${delegation.id}/grants`),
  });
  const invalidate = () => void client.invalidateQueries({ queryKey: ["delegation-grants", delegation.id] });
  const revokeOne = useMutation({
    mutationFn: (jti: string) => api(`/api/v1/grants/${encodeURIComponent(jti)}/revoke`, { method: "POST", body: JSON.stringify({ reason: "revoked in console" }) }),
    onSuccess: invalidate,
  });
  const revokeAll = useMutation({
    mutationFn: () => api<{ revoked: number }>(`/api/v1/delegations/${delegation.id}/grants/revoke`, { method: "POST", body: JSON.stringify({ reason: "revoked in console" }) }),
    onSuccess: invalidate,
  });
  const grants = query.data?.grants ?? [];
  const active = grants.filter((entry) => entry.status === "active").length;
  return <Modal title={`Delegation grants · ${delegation.id.slice(0, 8)}`} onClose={onClose}>
    <p className="panel-note mt-0">Tokens minted from this delegation. Revoking one denies agents holding it immediately; the delegation itself stays active.</p>
    <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
      <table>
        <thead><tr><th>Grant</th><th>Status</th><th>Issued</th><th>Expires</th><th /></tr></thead>
        <tbody>
          {query.isPending ? <EmptyRow colSpan={5}>Loading…</EmptyRow> : grants.length ? grants.map((entry) => <tr key={entry.jti}>
            <td className="mono" title={entry.jti}>{entry.jti.slice(0, 12)}…</td>
            <td>{entry.status === "active"
              ? <span className={badgeClass("active")}><span className="dot" />active</span>
              : entry.status === "revoked"
                ? <span className={badgeClass("revoked")} title={entry.revocation_reason ?? ""}><span className="dot" />revoked</span>
                : <span className={badgeClass("expired")}><span className="dot" />expired</span>}</td>
            <td className="tcell-muted tnum">{relTime(entry.created_at)}</td>
            <td className="tcell-muted tnum">{formatDateTime(entry.expires_at)}</td>
            <td className="text-right">{entry.status === "active" ? <Button variant="outline" type="button" disabled={revokeOne.isPending} onClick={() => revokeOne.mutate(entry.jti)}>Revoke</Button> : null}</td>
          </tr>) : <EmptyRow colSpan={5}>No grants issued.</EmptyRow>}
        </tbody>
      </table>
    </div>
    {revokeOne.isError ? <ErrorText>{revokeOne.error.message}</ErrorText> : null}
    {revokeAll.isError ? <ErrorText>{revokeAll.error.message}</ErrorText> : null}
    <div className="modal-actions">
      <Button variant="outline" type="button" onClick={onClose}>Close</Button>
      <Button type="button" disabled={revokeAll.isPending || active === 0} onClick={() => revokeAll.mutate()}>Revoke all active</Button>
    </div>
  </Modal>;
}
