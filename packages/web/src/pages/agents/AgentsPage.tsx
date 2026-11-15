import { Button, buttonVariants } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { api, formatDateTime, relTime, type Agent, type Approval } from "../../api";
import { EmptyRow, Modal, Notice, PageHead, Panel, SkeletonRows } from "../../components";
import { CheckField, FormModal, TextField, useZodForm } from "../../form";
import { AgentNav, badgeClass } from "./shared";

export default function AgentsPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const query = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[]; cap: number | null; cap_label: string }>("/api/v1/agents") });
  const pending = useQuery({ queryKey: ["approvals", "pending", 1], queryFn: () => api<{ approvals: Approval[]; total: number }>("/api/v1/approvals?state=pending&limit=1") });
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [prefill, setPrefill] = useState("");

  useEffect(() => {
    const register = params.get("register");
    if (register) { setPrefill(register); setCreateOpen(true); const next = new URLSearchParams(params); next.delete("register"); setParams(next, { replace: true }); }
  }, [params, setParams]);

  const invalidate = () => client.invalidateQueries({ queryKey: ["agents"] });
  const agents = query.data?.agents ?? [];
  const columnCount = 8;
  const pendingCount = pending.data?.total ?? 0;
  const active = agents.filter((agent) => agent.status === "active").length;
  const expired = agents.filter((agent) => agent.status === "expired").length;
  const suspended = agents.filter((agent) => agent.status === "suspended").length;
  const revoked = agents.filter((agent) => agent.status === "revoked").length;
  const cap = query.data?.cap ?? null;

  return <>
    <PageHead title="Agents" sub="Managed agents, their credentials and authorization posture." actions={<>
      {pendingCount > 0 ? <Link className={`${buttonVariants({ variant: "outline" })} quiet-action`} to="/ui/agents/approvals">{pendingCount} pending approval{pendingCount === 1 ? "" : "s"}</Link> : null}
      <Button className="quiet-action" variant="outline" type="button" onClick={() => setImportOpen(true)}>Import</Button>
      <Button type="button" onClick={() => { setPrefill(""); setCreateOpen(true); }}>New agent</Button>
    </>} />
    <AgentNav />

    <div className="stat-tiles">
      <div className="stat-tile">
        <span className="st-label">Registered agents</span>
        <div className="st-value">{agents.length}</div>
        <div className="st-sub">{cap == null ? "no limit on active agents" : <><b>{active}</b> active of <b>{cap}</b> allowed{active > cap ? " (over the limit)" : ""}</>}</div>
      </div>
      <div className="stat-tile tone-good">
        <span className="st-label">Active</span>
        <div className="st-value">{active}</div>
        <div className="st-sub"><b>{expired}</b> expired</div>
      </div>
      <div className={`stat-tile${pendingCount ? " tone-warn" : ""}`}>
        <span className="st-label">Pending approvals</span>
        <div className="st-value">{pendingCount}</div>
        <div className="st-sub"><Link to="/ui/agents/approvals">Open review queue</Link></div>
      </div>
      <div className={`stat-tile${revoked + suspended ? " tone-bad" : ""}`}>
        <span className="st-label">Revoked / suspended</span>
        <div className="st-value">{revoked + suspended}</div>
        <div className="st-sub">{suspended ? <><b>{suspended}</b> suspended</> : "no blocked agents"}</div>
      </div>
    </div>

    {cap != null && active >= cap ? <Notice>{active > cap ? "This instance is over its governed agent limit." : "All governed agent slots are in use."} Suspend or revoke an agent to free a slot, or move to Enterprise for unlimited agents.</Notice> : null}

    <Panel flush title="Registry" note={`${agents.length} agent${agents.length === 1 ? "" : "s"}`}>
      <div className="table-wrap"><table className="table-fixed w-full wide-table agents-table" data-test="primary">
        <colgroup><col style={{ width: "15%" }} /><col style={{ width: "9%" }} /><col style={{ width: "11%" }} /><col style={{ width: "17%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "10%" }} /><col style={{ width: "18%" }} /></colgroup>
        <thead><tr><th>Agent</th><th>Status</th><th>Environment</th><th>Purpose</th><th>Last active</th><th className="num">Actions 7d</th><th className="num">Denied 7d</th><th className="num">Pending approvals</th></tr></thead>
        <tbody>
          {query.isPending ? <SkeletonRows columns={columnCount} rows={5} /> : agents.length ? agents.map((agent) => <tr key={agent.id}>
            <td><Link className="tcell-primary" to={`/ui/agents/${agent.id}`}>{agent.name}</Link><small className="tcell-sub">{agent.slug}</small></td>
            <td><span className={badgeClass(agent.status)}><span className="dot" />{agent.status}</span></td>
            <td className="tnum">{agent.environment}</td>
            <td className="tcell-muted agent-purpose" title={agent.purpose || undefined}>{agent.purpose || "-"}</td>
            <td className="tcell-muted tnum" title={agent.activity?.lastActiveAt ? formatDateTime(agent.activity.lastActiveAt) : undefined}>{agent.activity?.lastActiveAt ? relTime(agent.activity.lastActiveAt) : "never"}</td>
            <td className="num">{agent.activity?.actions7d ?? 0}</td>
            <td className="num">{agent.activity?.denied7d ?? 0}</td>
            <td className="num">{agent.activity?.pendingApprovals ?? 0}</td>
          </tr>) : <EmptyRow colSpan={columnCount}>No agents yet. Create one or import from an external system.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
    {createOpen ? <CreateAgent prefill={prefill} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); void invalidate(); }} /> : null}
    {importOpen ? <ImportAgent onClose={() => setImportOpen(false)} onSaved={() => { setImportOpen(false); void invalidate(); }} /> : null}
  </>;
}

const agentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string(),
  purpose: z.string(),
  environment: z.string().trim().min(1, "Environment is required"),
  model: z.string(),
  provider: z.string(),
  businessOwner: z.string(),
});
type AgentValues = z.infer<typeof agentSchema>;

function CreateAgent({ prefill, onClose, onSaved }: { prefill: string; onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<AgentValues>(agentSchema, { name: prefill, description: "", purpose: "", environment: "production", model: "", provider: "", businessOwner: "" });
  const create = useMutation({
    mutationFn: (values: AgentValues) => api("/api/v1/agents", { method: "POST", body: JSON.stringify({ name: values.name, description: values.description || undefined, purpose: values.purpose || undefined, environment: values.environment, model: values.model || undefined, provider: values.provider || undefined, business_owner: values.businessOwner || undefined }) }),
    onSuccess: onSaved,
  });
  return <FormModal title="New agent" form={form} submitLabel="Create" pending={create.isPending} error={create.isError ? create.error.message : null} onClose={onClose} onSubmit={(values) => create.mutate(values)}>
    <TextField form={form} name="name" label="Name" placeholder="Procurement agent" autoFocus />
    <div className="grid-2-12">
      <TextField form={form} name="environment" label="Environment" placeholder="production" />
      <TextField form={form} name="model" label="Model" placeholder="gpt-4o" />
      <TextField form={form} name="provider" label="Provider" placeholder="openai" />
      <TextField form={form} name="businessOwner" label="Business owner" placeholder="Procurement Department" />
    </div>
    <TextField form={form} name="purpose" label="Purpose" placeholder="procurement" />
    <TextField form={form} name="description" label="Description" placeholder="Automates procurement activities" />
  </FormModal>;
}

const importAgentSchema = z.object({
  system: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]*$/i, "Letters, digits, . _ - only"),
  externalId: z.string().trim().min(1, "External id is required"),
  name: z.string(),
  issueCredential: z.boolean(),
});
type ImportAgentValues = z.infer<typeof importAgentSchema>;

function ImportAgent({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const form = useZodForm<ImportAgentValues>(importAgentSchema, { system: "bedrock", externalId: "", name: "", issueCredential: false });
  const [credential, setCredential] = useState<string | null>(null);
  const importAgent = useMutation({
    mutationFn: (values: ImportAgentValues) => api<{ agent: Agent; created: boolean; key?: string }>("/api/v1/agents/import", { method: "POST", body: JSON.stringify({ external_system: values.system, external_id: values.externalId, name: values.name || undefined, issue_credential: values.issueCredential }) }),
    onSuccess: (data) => { if (data.key) setCredential(data.key); else onSaved(); },
  });
  if (credential) return <Modal title="Agent imported" onClose={onSaved}>
    <p>The one-shot agent credential is shown once.</p>
    <div className="keybox"><code>{credential}</code><Button variant="outline" type="button" onClick={() => void navigator.clipboard?.writeText(credential)}>Copy key</Button></div>
    <div className="modal-actions"><Button type="button" onClick={onSaved}>Done</Button></div>
  </Modal>;
  return <FormModal title="Import external agent" form={form} submitLabel="Import" pending={importAgent.isPending} error={importAgent.isError ? importAgent.error.message : null} onClose={onClose} onSubmit={(values) => importAgent.mutate(values)}>
    <Notice>Idempotent by external system + id. Supply a name when creating; updates only send the fields provided.</Notice>
    <div className="grid-2-12">
      <TextField form={form} name="system" label="External system" placeholder="bedrock" />
      <TextField form={form} name="externalId" label="External id" placeholder="AGENT123" />
    </div>
    <TextField form={form} name="name" label="Name" placeholder="required for new agents" />
    <CheckField form={form} name="issueCredential" label="Issue a one-shot credential" />
  </FormModal>;
}
