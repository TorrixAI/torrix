import { buttonVariants } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, compact, fmtUsd, relTime, type ObservedAgent } from "../../api";
import { formatCount, formatDateTime } from "../../api";
import { EmptyRow } from "../../components";
import { UpgradeCard, useFeature } from "../../features";
import { PageError, PageLoading } from "../DashboardPage";
import { AgentNav, badgeClass } from "./shared";

export default function ObservedAgentsPage() {
  const registryAllowed = useFeature("agent-control").allowed;
  const query = useQuery({ queryKey: ["observed-agents"], queryFn: () => api<{ agents: ObservedAgent[] }>("/api/v1/observed-agents") });
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  const agents = query.data.agents;
  const totalRuns = agents.reduce((sum, agent) => sum + agent.runs, 0);
  const totalCost = agents.reduce((sum, agent) => sum + agent.cost, 0);

  return <>
    <div className="page-head"><div><h1>Observed agents</h1><p className="page-sub">{agents.length} observed agent{agents.length === 1 ? "" : "s"} · {formatCount(totalRuns)} runs · {fmtUsd(totalCost)} · read-only attribution from captured runs</p></div></div>
    <AgentNav />
    {registryAllowed ? null : <div className="mb-4"><UpgradeCard feature="agent-control" label="Governed agents" /></div>}
    <section className="panel mb-4">
      <div className="table-wrap"><table>
        <thead><tr><th>Agent</th><th className="num">Runs</th><th className="num">Tokens</th><th className="num">Cost</th><th className="num">Errors</th><th>Last seen</th><th /></tr></thead>
        <tbody>
          {agents.length ? agents.map((agent) => <tr key={agent.name}>
            <td className="min-w-0"><Link className="tcell-primary" to={`/ui/runs?agent=${encodeURIComponent(agent.name)}`}>{agent.name}</Link></td>
            <td className="num">{compact(agent.runs)}</td>
            <td className="num">{compact(agent.tokens)}</td>
            <td className="num">{fmtUsd(agent.cost)}</td>
            <td className="num">{agent.errorCount > 0 ? <span className={badgeClass("blocked")}><span className="dot" />{agent.errorCount}</span> : "0"}</td>
            <td className="tcell-muted whitespace-nowrap tnum" title={`first seen ${formatDateTime(agent.firstSeen)}`}>{relTime(agent.lastSeen)}</td>
            <td>
              <div className="actions-end">
                <Link className={buttonVariants({ variant: "outline", size: "sm" })} to={`/ui/runs?agent=${encodeURIComponent(agent.name)}`}>View runs</Link>
                {registryAllowed ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} to={`/ui/agents?register=${encodeURIComponent(agent.name)}`}>Register</Link> : null}
              </div>
            </td>
          </tr>) : <EmptyRow colSpan={7}>No observed agents yet. Agents appear here when captured runs carry an agent name: the opencode plugin sets it automatically, the proxy reads <code>x-agent-name</code>, and proxy or SDK callers can send <code>x-torrix-agent-id</code> or <code>record.agent_id</code>.</EmptyRow>}
        </tbody>
      </table></div>
    </section>
  </>;
}
