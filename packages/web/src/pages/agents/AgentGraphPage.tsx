import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Agent, type AgentPermission, type GraphCounts, type Principal } from "../../api";
import { EmptyRow, InlineSelect, Notice, PageHead, Panel } from "../../components";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { PageError, PageLoading } from "../DashboardPage";
import { AgentNav, agentLabel, badgeClass } from "./shared";

export default function AgentGraphPage() {
  const client = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const debouncedAction = useDebouncedValue(action, 250);
  const debouncedResource = useDebouncedValue(resource, 250);

  const params = new URLSearchParams({ limit: "300" });
  if (agentId) params.set("agent_id", agentId);
  if (debouncedAction) params.set("action", debouncedAction);
  if (debouncedResource) params.set("resource", debouncedResource);

  const summary = useQuery({ queryKey: ["graph-summary"], queryFn: () => api<{ counts: GraphCounts }>("/api/v1/graph/summary") });
  const permissions = useQuery({
    queryKey: ["graph-permissions", agentId, debouncedAction, debouncedResource],
    queryFn: () => api<{ permissions: AgentPermission[]; total: number }>(`/api/v1/graph/permissions?${params}`),
    placeholderData: keepPreviousData,
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: Agent[] }>("/api/v1/agents") });
  const principals = useQuery({ queryKey: ["principals"], queryFn: () => api<{ principals: Principal[] }>("/api/v1/principals") });
  const rebuild = useMutation({ mutationFn: () => api<{ rows: number }>("/api/v1/graph/rebuild", { method: "POST", body: "{}" }), onSuccess: (data) => { setMessage(`Rebuilt ${data.rows} permission rows.`); void client.invalidateQueries({ queryKey: ["graph-permissions"] }); void client.invalidateQueries({ queryKey: ["graph-summary"] }); } });

  if (summary.isError) return <PageError message={summary.error.message} />;
  if (permissions.isError) return <PageError message={permissions.error.message} />;
  if (!summary.data || !permissions.data) return <PageLoading />;
  const counts = summary.data.counts;
  const rows = permissions.data.permissions;
  const agentList = agents.data?.agents ?? [];
  const principalList = principals.data?.principals ?? [];

  return <>
    <PageHead title="Who can do what" sub="Materialized view of what each agent may do, rebuilt on every delegation or policy change." actions={<Button variant="outline" type="button" disabled={rebuild.isPending} onClick={() => rebuild.mutate()}>Rebuild graph</Button>} />
    <AgentNav />
    {message ? <Notice>{message}</Notice> : null}
    <div className="stat-tiles">
      <div className="stat-tile"><span className="st-label">Agents</span><div className="st-value">{counts.agents}</div></div>
      <div className="stat-tile"><span className="st-label">Delegations</span><div className="st-value">{counts.delegations}</div></div>
      <div className="stat-tile"><span className="st-label">Policies</span><div className="st-value">{counts.policies}</div></div>
      <div className="stat-tile"><span className="st-label">Permissions</span><div className="st-value">{counts.permissions}</div></div>
      <div className="stat-tile"><span className="st-label">Pending approvals</span><div className="st-value">{counts.pendingApprovals}</div></div>
      <div className="stat-tile"><span className="st-label">Decisions (24h)</span><div className="st-value">{counts.decisions24h}</div></div>
    </div>
    <Panel flush title="Permissions" note={`${permissions.data.total} rows`} actions={
      <div className="action-row">
        <Input className="w-[150px]" aria-label="Filter by action" placeholder="action" value={action} onChange={(event) => setAction(event.target.value)} />
        <Input className="w-[150px]" aria-label="Filter by resource" placeholder="resource" value={resource} onChange={(event) => setResource(event.target.value)} />
        <InlineSelect className="w-[180px]" value={agentId} onValueChange={setAgentId} placeholder="All agents" options={[{ value: "", label: "All agents" }, ...agentList.map((agent) => ({ value: agent.id, label: agent.name }))]} />
      </div>
    }>
      <div className="table-wrap"><table>
        <thead><tr><th>Agent</th><th>Principal</th><th>Action</th><th>Resource</th><th>Effect</th><th className="num">Max amount</th><th>Approval</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((permission) => <tr key={permission.id}>
            <td className="tcell-primary">{agentLabel(agentList, permission.agent_id)}</td>
            <td className="tcell-muted">{principalList.find((principal) => principal.id === permission.principal_id)?.display_name ?? "-"}</td>
            <td className="tnum">{permission.action}</td>
            <td className="mono">{permission.resource_type || "-"}{permission.resource_id ? `:${permission.resource_id.slice(0, 8)}` : ""}</td>
            <td><span className={badgeClass(permission.effect === "allow" ? "active" : permission.effect === "deny" ? "blocked" : "pending")}><span className="dot" />{permission.effect}</span></td>
            <td className="num">{permission.max_amount != null ? permission.max_amount : "-"}</td>
            <td>{permission.requires_approval ? <span className="badge warn"><span className="dot" />required</span> : "no"}</td>
          </tr>) : <EmptyRow colSpan={7}>No permissions materialized. Create a delegation or policy first.</EmptyRow>}
        </tbody>
      </table></div>
    </Panel>
  </>;
}
