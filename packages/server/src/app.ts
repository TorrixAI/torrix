import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import type { ServerConfig } from "./core/config";
import { ExtensionHost } from "./core/extensionHost";
import type { TorrixExtension } from "./core/extensions";
import type { Repositories } from "./repos";
import { installRateLimits } from "./lib/rateLimit";
import { authRoute } from "./routes/auth";
import { proxyRoute } from "./routes/proxy";
import { apiRoute } from "./routes/api";
import { ingestRoute } from "./routes/ingest";
import { lockedPageHtml, uiRoute } from "./routes/ui";
import { metricsRoute } from "./routes/metrics";
import { otelRoute } from "./routes/otel";
import { mcpProxyRoute } from "./routes/mcpProxy";
import { mcpRoute } from "./routes/mcp";
import { governanceRoute } from "./routes/governance";
import { agentsRoute } from "./routes/agents";
import { integrationsRoute } from "./routes/integrations";

export interface AppDeps {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  host: ExtensionHost;
}

export interface BuildAppOptions {
  repos: Repositories;
  config: ServerConfig;
  env: NodeJS.ProcessEnv;
  extensions?: readonly TorrixExtension[];
  host?: ExtensionHost;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const deps: AppDeps = {
    repos: options.repos,
    config: options.config,
    env: options.env,
    host: options.host ?? new ExtensionHost(options.extensions ?? [], options.config.license),
  };
  deps.host.attach(deps);
  deps.host.setLockedRenderer((info) => lockedPageHtml(deps.repos, deps.config, deps.host, info, null));
  const app = Fastify({
    ignoreTrailingSlash: true,
    logger: { level: "info" },
    bodyLimit: 25_000_000,
  });

  await app.register(cors, { origin: true });

  const proxyLimit = () => (deps.config.edition !== "community" ? 300 : 120);
  const authLimit = deps.env.NODE_ENV === "production" ? 20 : 300;
  installRateLimits(app, [
    ...deps.host.rateLimits(),
    { prefix: "/auth/signup", max: authLimit, windowMs: 60_000 },
    { prefix: "/auth/login", max: authLimit, windowMs: 60_000 },
    { prefix: "/proxy", max: proxyLimit, windowMs: 60_000 },
    { prefix: "/api/ingest", max: proxyLimit, windowMs: 60_000 },
    { prefix: "/mcp", max: proxyLimit, windowMs: 60_000 },
    { prefix: "/api", max: 300, windowMs: 60_000 },
  ]);

  if (deps.config.isDemo) {
    const extensionWritable = deps.host.demoWritablePaths();
    app.addHook("onRequest", async (request, reply) => {
      const method = request.method.toUpperCase();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        return;
      }
      const path = request.url.split("?")[0];
      if (path === "/auth/login" || path === "/ui/session" || path === "/ui/logout" || extensionWritable.includes(path)) {
        return;
      }
      return reply.code(403).send({ error: "demo_read_only" });
    });
  }

  // Compressed bodies (OTLP exporters default to gzip) are handed to the route
  // as raw bytes; decompressing here would hide the content-encoding it needs.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = buf;
    const encoding = String(request.headers["content-encoding"] ?? "").toLowerCase();
    if (encoding.includes("gzip") || encoding.includes("deflate") || encoding.includes("br")) {
      done(null, buf);
      return;
    }
    const text = buf.toString("utf8");
    try {
      done(null, text ? JSON.parse(text) : {});
    } catch (err) {
      done(err as Error);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "buffer" }, (request, body, done) => {
    (request as FastifyRequest & { rawBody?: Buffer }).rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    done(null, new URLSearchParams(body.toString("utf8")));
  });
  app.addContentTypeParser(["text/csv", "text/plain"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(async (instance) => {
    await authRoute(instance, deps);
    await proxyRoute(instance, deps);
    await apiRoute(instance, deps);
    await ingestRoute(instance, deps);
    await metricsRoute(instance, deps);
    await otelRoute(instance, deps);
    await mcpProxyRoute(instance, deps);
    await mcpRoute(instance, deps);
    await governanceRoute(instance, deps);
    await agentsRoute(instance, deps);
    await integrationsRoute(instance, deps);
    await deps.host.registerRoutes(instance, deps);
    await uiRoute(instance, deps);
  });

  app.setErrorHandler((err: unknown, request, reply) => {
    const e = err as Error & { statusCode?: number };
    request.log.error(e);
    if (reply.sent) {
      return;
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.message });
    }
    return reply.code(502).send({ error: "upstream_error", detail: e.message });
  });

  return app;
}