import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { AuthResult } from "../core/domain";
import type { ExtensionHost } from "../core/extensionHost";
import { authenticateKey, extractBearer, readAuthCookie } from "../lib/auth";
import { integrationActivity, pluginMarketplace, publicBaseUrl } from "../lib/integrations";
import {
  claudeCodeInstallScript,
  claudeCodeInstallScriptPowerShell,
  opencodeInstallScript,
  opencodeInstallScriptPowerShell,
} from "../connect/scripts";
import type { Repositories } from "../repos";
import { sendReactApp } from "./ui";

export interface IntegrationsDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  host?: ExtensionHost;
}

export async function integrationsRoute(app: FastifyInstance, deps: IntegrationsDeps): Promise<void> {
  const { repos, env } = deps;

  const resolveAuth = async (request: FastifyRequest): Promise<AuthResult | null> => {
    const headerKey = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    let auth = headerKey ? await authenticateKey(repos.db, headerKey) : null;
    if (!auth) {
      const cookieKey = readAuthCookie(request.headers);
      auth = cookieKey ? await authenticateKey(repos.db, cookieKey) : null;
    }
    return auth;
  };

  app.get("/api/integrations", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveAuth(request);
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const activity = await integrationActivity(repos.db, auth.user.id);
    return {
      base_url: publicBaseUrl(request),
      plugin_marketplace: pluginMarketplace(env),
      integrations: activity.map((a) => ({ id: a.id, last_at: a.lastAt, runs_24h: a.runs24h })),
    };
  });

  // Installers are public: they contain no secret, and the key is supplied by
  // the user's shell command through TORRIX_API_KEY. Serving them here keeps a
  // self-hosted instance self-contained (no npm publication required).
  const sendScript = (reply: FastifyReply, body: string, shell: boolean) =>
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .type(shell ? "text/x-shellscript; charset=utf-8" : "text/plain; charset=utf-8")
      .send(body);

  app.get("/api/connect/opencode.sh", async (request: FastifyRequest, reply: FastifyReply) =>
    sendScript(reply, opencodeInstallScript(publicBaseUrl(request)), true),
  );

  app.get("/api/connect/opencode.ps1", async (request: FastifyRequest, reply: FastifyReply) =>
    sendScript(reply, opencodeInstallScriptPowerShell(publicBaseUrl(request)), false),
  );

  app.get("/api/connect/claude-code.sh", async (request: FastifyRequest, reply: FastifyReply) =>
    sendScript(reply, claudeCodeInstallScript(publicBaseUrl(request), pluginMarketplace(env)), true),
  );

  app.get("/api/connect/claude-code.ps1", async (request: FastifyRequest, reply: FastifyReply) =>
    sendScript(reply, claudeCodeInstallScriptPowerShell(publicBaseUrl(request), pluginMarketplace(env)), false),
  );

  app.get("/ui/integrations", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await resolveAuth(request);
    if (!auth) {
      return reply.redirect("/ui/login");
    }
    return sendReactApp(reply);
  });
}
