import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { AuthResult } from "../core/domain";
import { authenticateKey, extractBearer, readAuthCookie } from "../lib/auth";
import type { Repositories } from "../repos";
import { applyProjectScope, resolveProjectScope, sendReactApp } from "./ui";

export interface AgentsDeps {
  repos: Repositories;
  config: ServerConfig;
  host?: ExtensionHost;
}

/** Observed agents: read-only attribution from captured runs, available in every edition. */
export async function agentsRoute(app: FastifyInstance, deps: AgentsDeps): Promise<void> {
  const { repos } = deps;

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

  // Without the agent-control extension the registry does not exist; the SPA
  // renders observed agents only, so send /ui/agents there.
  if (!deps.host?.installed("agent-control")) {
    app.get("/ui/agents", async (_request, reply) => reply.redirect("/ui/agents/observed"));
  }

  app.get("/ui/agents/observed", { preHandler: authenticate }, async (_request, reply) => sendReactApp(reply));

  // Observed agents are a free feature: attribution read from captured runs,
  // not the paid managed registry. Served from core so Community works.
  app.get("/api/v1/observed-agents", { preHandler: authenticate }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const scope = await resolveProjectScope(request, repos, auth.user.id);
    applyProjectScope(reply, scope);
    return reply.send({ agents: await repos.runs.listObservedAgents(auth.user.id, 100, scope.projectId) });
  });

  // Governed coverage joins what traffic shows with what the registry manages.
  // Community sees the percentage and the uncovered names as an upgrade signal.
  app.get("/api/v1/coverage", { preHandler: authenticate }, async (request, reply) => {
    const auth = (request as unknown as { auth: AuthResult }).auth;
    const scope = await resolveProjectScope(request, repos, auth.user.id);
    applyProjectScope(reply, scope);
    const [observed, agents] = await Promise.all([
      repos.runs.listObservedAgents(auth.user.id, 500, scope.projectId),
      repos.agents.listByUser(auth.user.id),
    ]);
    const governed = agents.filter((agent) => agent.status === "active");
    const registeredNames = new Set(governed.flatMap((agent) => [
      agent.name.toLowerCase(),
      agent.slug.toLowerCase(),
      agent.id.toLowerCase(),
    ]));
    const observedNames = new Set(observed.map((agent) => agent.name.toLowerCase()));
    const covered = observed.filter((agent) => registeredNames.has(agent.name.toLowerCase()));
    return reply.send({
      coverage: {
        observed: observed.length,
        governed: governed.length,
        covered: covered.length,
        coverage_percent: observed.length ? Math.round((covered.length / observed.length) * 1000) / 10 : 0,
        uncovered: observed
          .filter((agent) => !registeredNames.has(agent.name.toLowerCase()))
          .slice(0, 20)
          .map((agent) => ({ name: agent.name, runs: agent.runs, cost: agent.cost, lastSeen: agent.lastSeen })),
        registered_without_traffic: governed
          .filter((agent) => !observedNames.has(agent.name.toLowerCase()) && !observedNames.has(agent.slug.toLowerCase()) && !observedNames.has(agent.id.toLowerCase()))
          .slice(0, 20)
          .map((agent) => ({ id: agent.id, name: agent.name, slug: agent.slug, status: agent.status })),
      },
    });
  });
}
