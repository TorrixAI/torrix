import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { AuthResult } from "../core/domain";
import type { ObservedAgent } from "../core/ports";
import { authenticateKey, extractBearer, readAuthCookie } from "../lib/auth";
import type { Repositories } from "../repos";
import { lockedFeature } from "../core/lockedFeatures";
import { emptyState, escapeHtml, fmtTokens, fmtUsd, relTime, shell, shortDate, treeAgentChip } from "./ui";

export interface AgentsDeps {
  repos: Repositories;
  config: ServerConfig;
  host?: ExtensionHost;
}

export function agentTabs(active: "registry" | "observed", registryAllowed = true): string {
  const registry = registryAllowed
    ? `<a class="${active === "registry" ? "active" : ""}" href="/ui/agents">Registry</a>`
    : `<a href="/ui/locked/agent-control" title="Available in Enterprise">Registry <span class="nav-lock">Ent</span></a>`;
  return `<div class="filter-tabs" style="margin-bottom:14px">
    ${registry}
    <a class="${active === "observed" ? "active" : ""}" href="/ui/agents/observed">Observed</a>
  </div>`;
}

function governUpsell(observedCount: number): string {
  const feature = lockedFeature("agent-control");
  const lead = observedCount
    ? `Torrix sees ${observedCount === 1 ? "this agent" : `these ${observedCount} agents`}. Enterprise lets you control what ${observedCount === 1 ? "it is" : "they are"} allowed to do.`
    : "Enterprise lets you control what your agents are allowed to do.";
  return `<section class="panel" style="margin-bottom:14px"><div class="locked-card" style="max-width:none">
    <span class="badge neutral" style="justify-self:start">Enterprise</span>
    <p><b>${escapeHtml(lead)}</b></p>
    <p>${escapeHtml(feature?.pitch ?? "")} Every tool call can run through the governed MCP gateway with a full audit trail.</p>
    <div class="locked-actions"><a class="btn btn-primary" href="/ui/locked/agent-control">See what Enterprise adds</a><a class="btn btn-ghost" href="/ui/settings">Activate a license</a></div>
  </div></section>`;
}

function observedAgentsBody(observed: ObservedAgent[], registryAllowed: boolean): string {
  const totalRuns = observed.reduce((sum, a) => sum + a.runs, 0);
  const totalCost = observed.reduce((sum, a) => sum + a.cost, 0);
  const rows = observed
    .map(
      (a) => `<tr>
        <td>${treeAgentChip(a.name)}</td>
        <td class="num">${a.runs.toLocaleString()}</td>
        <td class="num">${fmtTokens(a.tokens || null)}</td>
        <td class="num mono">${fmtUsd(a.cost)}</td>
        <td class="num">${a.errorCount ? `<span class="badge bad"><span class="dot"></span>${a.errorCount}</span>` : "0"}</td>
        <td style="color:var(--text-3);font-size:12px" title="first seen ${escapeHtml(shortDate(a.firstSeen))}">${escapeHtml(relTime(a.lastSeen))}</td>
        <td><a class="btn btn-ghost" href="/ui/runs?agent=${encodeURIComponent(a.name)}">View runs</a> ${registryAllowed ? `<a class="btn btn-ghost" href="/ui/agents?register=${encodeURIComponent(a.name)}">Register</a>` : ""}</td>
      </tr>`,
    )
    .join("");
  const table = observed.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Agent</th><th class="num">Runs</th><th class="num">Tokens</th><th class="num">Cost</th><th class="num">Errors</th><th>Last seen</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : emptyState(
        "No observed agents yet",
        "Agents appear here when captured runs carry an agent name. The opencode plugin sets it automatically; the proxy reads x-agent-name, and proxy/SDK callers can send x-torrix-agent-id or record.agent_id.",
      );
  return `<div class="page-head">
    <div><h1>Agents</h1><p class="page-sub">${observed.length} observed agent${observed.length === 1 ? "" : "s"} · ${totalRuns.toLocaleString()} runs · ${fmtUsd(totalCost)} · read-only attribution from captured runs</p></div>
  </div>
  ${agentTabs("observed", registryAllowed)}
  ${registryAllowed ? "" : governUpsell(observed.length)}
  <div class="panel"><div class="panel-head"><span class="panel-title"><span class="sig"></span>Observed agents</span><span class="panel-note">from runs.agent_name · not managed agents</span></div>${table}</div>`;
}

/** Observed agents: read-only attribution from captured runs, available in every edition. */
export async function agentsRoute(app: FastifyInstance, deps: AgentsDeps): Promise<void> {
  const { repos, config } = deps;
  const pages = shell(repos, config, deps.host);

  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const headerKey = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    let auth = headerKey ? await authenticateKey(repos.db, headerKey) : null;
    if (!auth) {
      const cookieKey = readAuthCookie(request.headers);
      auth = cookieKey ? await authenticateKey(repos.db, cookieKey) : null;
    }
    if (!auth) {
      reply.redirect("/ui/login");
      return;
    }
    (request as unknown as { auth: AuthResult }).auth = auth;
  };

  if (!deps.host?.installed("agent-control")) {
    app.get("/ui/agents", async (_request, reply) => reply.redirect("/ui/agents/observed"));
  }

  app.get("/ui/agents/observed", { preHandler: authenticate }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const observed = await repos.runs.listObservedAgents(auth.user.id, 100);
    reply
      .type("text/html")
      .send(
        pages.page("Observed agents", observedAgentsBody(observed, deps.host?.featureAllowed("agent-control") ?? false), "agents", auth.user),
      );
  });
}
