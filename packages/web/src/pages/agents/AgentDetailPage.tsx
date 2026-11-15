import { Button } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, relTime, type Agent, type AgentCredential, type AgentTool, type Delegation } from "../../api";
import { formatDate, formatDateTime } from "../../api";
import { EmptyRow, ErrorText, Modal, Notice, PageHead, Panel } from "../../components";
import { FormModal, TextField, useZodForm } from "../../form";
import { z } from "zod";
import { AgentNav, badgeClass, listOf } from "./shared";

const STATUSES = ["active", "suspended", "blocked", "expired", "revoked"];

export default function AgentDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["agent", id], queryFn: () => api<{ agent: Agent; credentials: AgentCredential[]; tools: AgentTool[] }>(`/api/v1/agents/${encodeURIComponent(id)}`) });
  const delegationsQuery = useQuery({ queryKey: ["delegations"], queryFn: () => api<{ delegations: Delegation[] }>("/api/v1/delegations") });
  const [editOpen, setEditOpen] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const invalidate = () => { void client.invalidateQueries({ queryKey: ["agent", id] }); void client.invalidateQueries({ queryKey: ["agents"] }); };
  const setStatus = useMutation({ mutationFn: (status: string) => api(`/api/v1/agents/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: () => api(`/api/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => navigate("/ui/agents") });
  const revokeCredential = useMutation({ mutationFn: (credentialId: string) => api(`/api/v1/agent-credentials/${credentialId}`, { method: "DELETE" }), onSuccess: invalidate });

  if (query.isPending) return <div className="startup loading-page"><span>Loading agent…</span></div>;
  if (query.isError) return <div className="empty mt-6.5"><span className="empty-title">Agent not found</span><span className="empty-sub">{query.error.message}</span></div>;
  const { agent, credentials, tools } = query.data;
  const delegations = (delegationsQuery.data?.delegations ?? []).filter((delegation) => delegation.agent_id === agent.id);

  return <>
    <div className="rd-links"><Link className="back-link" to="/ui/agents">← All agents</Link></div>
    <PageHead title={agent.name} sub={`${agent.slug} · ${agent.environment}`} actions={<>
      <Button variant="outline" type="button" onClick={() => setEditOpen(true)}>Edit</Button>
      <Button variant="outline" type="button" onClick={() => setCredentialOpen(true)}>New credential</Button>
      <Button variant="outline" type="button" onClick={() => setConfirmDelete(true)}>Delete</Button>
    </>} />
    <AgentNav />

    <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Status</span><div className="st-value"><span className={badgeClass(agent.status)}><span className="dot" />{agent.status}</span></div><div className="st-sub">{agent.identity_provider ? `via ${agent.identity_provider}` : "first-party"}</div></div>
      <div className="stat-tile"><span className="st-label">Credentials</span><div className="st-value">{credentials.length}</div><div className="st-sub">{credentials.filter((credential) => !credential.revoked_at).length} active</div></div>
      <div className="stat-tile"><span className="st-label">Tools</span><div className="st-value">{tools.length}</div><div className="st-sub">granted MCP tools</div></div>
      <div className="stat-tile"><span className="st-label">Delegations</span><div className="st-value">{delegations.length}</div><div className="st-sub">{delegations.filter((delegation) => delegation.effective_status === "active").length} active</div></div>
    </div>

    <Panel title="Lifecycle" note="change the runtime posture">
      <div className="action-row">
        {STATUSES.map((status) => <Button key={status} variant={status === agent.status ? "default" : "outline"} type="button" disabled={setStatus.isPending || status === agent.status} onClick={() => setStatus.mutate(status)}>{status}</Button>)}
      </div>
      {setStatus.isError ? <ErrorText>{setStatus.error.message}</ErrorText> : null}
      <Notice>Revoking clears and stamps the agent; suspending or blocking pauses new authorization decisions.</Notice>
    </Panel>

    <Panel title="Profile">
      <div className="metagrid mb-0">
        <Cell label="Description" value={agent.description || "-"} />
        <Cell label="Purpose" value={agent.purpose || "-"} />
        <Cell label="Owner" value={agent.owner_user_id || "-"} />
        <Cell label="Business owner" value={agent.business_owner || "-"} />
        <Cell label="Model" value={agent.model || "-"} />
        <Cell label="Provider" value={agent.provider || "-"} />
        <Cell label="External" value={agent.identity_provider ? `${agent.identity_provider} · ${agent.external_subject || ""}` : "-"} />
        <Cell label="Expires" value={agent.expires_at ? formatDateTime(agent.expires_at) : "never"} />
        <Cell label="Agent ID" value={agent.id} />
        <Cell label="Created" value={formatDateTime(agent.created_at)} />
        <Cell label="Updated" value={relTime(agent.updated_at)} />
      </div>
    </Panel>

    <Panel flush title="Credentials" note={`${credentials.length} total`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Expires</th><th /></tr></thead>
        <tbody>
          {credentials.length ? credentials.map((credential) => <tr key={credential.id}>
            <td className="tcell-primary">{credential.name}</td>
            <td className="mono">{credential.key_prefix}…</td>
            <td>{listOf(credential.scopes).map((scope) => <span key={scope} className="chip mr-1">{scope}</span>)}</td>
            <td className="tcell-muted tnum">{credential.last_used_at ? formatDateTime(credential.last_used_at) : "never"}</td>
            <td className="tcell-muted tnum">{credential.expires_at ? formatDate(credential.expires_at) : "never"}</td>
            <td className="text-right">{credential.revoked_at ? <span className="badge bad"><span className="dot" />revoked</span> : <Button variant="outline" type="button" onClick={() => revokeCredential.mutate(credential.id)}>Revoke</Button>}</td>
          </tr>) : <EmptyRow colSpan={6}>No credentials yet.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    <Panel flush title="Granted tools" note={`${tools.length} tools`}>
      <div className="table-wrap"><table>
        <thead><tr><th>Tool</th><th>Action</th><th>Server</th></tr></thead>
        <tbody>
          {tools.length ? tools.map((tool) => <tr key={tool.id}><td className="tcell-primary mono">{tool.tool_name}</td><td className="mono">{tool.action || "-"}</td><td className="tcell-muted tnum">{tool.server_id.slice(0, 8)}</td></tr>) : <EmptyRow colSpan={3}>No tools granted.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>

    {editOpen ? <EditAgent agent={agent} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); invalidate(); }} /> : null}
    {credentialOpen ? <CreateCredential agentId={agent.id} onClose={() => setCredentialOpen(false)} onCreated={(value) => { setCredentialOpen(false); setSecret(value); invalidate(); }} /> : null}
    {secret ? <Modal title="Copy credential now" onClose={() => setSecret(null)}>
      <p>Shown once. The agent uses it as a bearer token (<code>trxa_…</code>).</p>
      <div className="keybox"><code>{secret}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>Copy key</Button></div>
      <div className="modal-actions"><Button type="button" onClick={() => setSecret(null)}>Done</Button></div>
    </Modal> : null}
    {confirmDelete ? <Modal title="Delete agent" onClose={() => setConfirmDelete(false)}>
      <p>Delete <b>{agent.name}</b>? Active delegations must be revoked first. Credentials are revoked and tool links removed.</p>
      {remove.isError ? <ErrorText>{remove.error.message}</ErrorText> : null}
      <div className="modal-actions"><Button variant="outline" type="button" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>Delete</Button></div>
    </Modal> : null}
  </>;
}

function Cell({ label, value }: { label: string; value: string }) {
  return <div className="cell"><span className="meta-label">{label}</span><div className="meta-val mono">{value}</div></div>;
}

const editAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
  purpose: z.string(),
  environment: z.string().trim().min(1, "Environment is required"),
  model: z.string(),
  provider: z.string(),
});
type EditAgentValues = z.infer<typeof editAgentSchema>;

function EditAgent({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<EditAgentValues>(editAgentSchema, {
    name: agent.name,
    description: agent.description ?? "",
    purpose: agent.purpose ?? "",
    environment: agent.environment,
    model: agent.model ?? "",
    provider: agent.provider ?? "",
  });
  const save = useMutation({ mutationFn: (values: EditAgentValues) => api(`/api/v1/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(values) }), onSuccess: onSaved });
  return <FormModal title="Edit agent" form={form} submitLabel="Save" pending={save.isPending} error={save.isError ? save.error.message : null} onClose={onClose} onSubmit={(values) => save.mutate(values)}>
    <TextField form={form} name="name" label="Name" autoFocus />
    <div className="grid-2-12">
      <TextField form={form} name="environment" label="Environment" />
      <TextField form={form} name="model" label="Model" />
      <TextField form={form} name="provider" label="Provider" />
      <TextField form={form} name="purpose" label="Purpose" />
    </div>
    <TextField form={form} name="description" label="Description" />
  </FormModal>;
}

const credentialSchema = z.object({ name: z.string().trim().min(1, "Name is required"), scopes: z.string() });
type CredentialValues = z.infer<typeof credentialSchema>;

function CreateCredential({ agentId, onClose, onCreated }: { agentId: string; onClose: () => void; onCreated: (secret: string) => void }) {
  const form = useZodForm<CredentialValues>(credentialSchema, { name: "default", scopes: "authorize,mcp" });
  const create = useMutation({
    mutationFn: (values: CredentialValues) => api<{ key: string }>(`/api/v1/agents/${agentId}/credentials`, { method: "POST", body: JSON.stringify({ name: values.name, scopes: values.scopes.split(",").map((scope) => scope.trim()).filter(Boolean) }) }),
    onSuccess: (data) => onCreated(data.key),
  });
  return <FormModal title="New credential" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" autoFocus />
    <TextField form={form} name="scopes" label="Scopes (comma separated)" placeholder="authorize, mcp" />
  </FormModal>;
}
