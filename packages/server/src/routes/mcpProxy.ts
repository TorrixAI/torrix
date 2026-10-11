import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { Repositories } from "../repos";
import type { RunData } from "../core/domain";
import { authenticateKey, extractBearer } from "../lib/auth";
import { validateTargetUrl } from "../lib/validate";
import { emitRun } from "../lib/events";
import { buildRunRow, makeEvent } from "../lib/runMapper";
import { createProxyHandler } from "./proxy";

export interface McpProxyDeps {
  repos: Repositories;
  config: ServerConfig;
  host: ExtensionHost;
}

const MCP_TIMEOUT_MS = 30_000;

/**
 * MCP proxy. JSON-RPC traffic is handled natively: `x-target-mcp-url` names
 * the downstream MCP server, handshakes pass through silently, and only
 * `tools/call` requests are recorded as runs (`source: mcp_proxy`) with the
 * tool name, arguments, response and a 30 second upstream timeout. Anything
 * that is not a JSON-RPC message falls back to the generic LLM pass-through so
 * existing base-URL clients keep working.
 */
export async function mcpProxyRoute(app: FastifyInstance, deps: McpProxyDeps): Promise<void> {
  const generic = createProxyHandler(deps, "mcp_proxy");
  const handler = jsonRpcHandler(deps, generic);
  app.all("/mcp/proxy", handler);
  app.all("/mcp/proxy/*", handler);
  app.all("/mcp/v1/proxy", handler);
  app.all("/mcp/v1/proxy/*", handler);
}

function jsonRpcHandler(
  deps: McpProxyDeps,
  generic: ReturnType<typeof createProxyHandler>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  const { repos, config } = deps;

  return async function handleMcpProxy(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const rawBody = request.body;
    const batch: Array<Record<string, unknown>> = Array.isArray(rawBody)
      ? (rawBody as Array<Record<string, unknown>>)
      : rawBody && typeof rawBody === "object"
        ? [rawBody as Record<string, unknown>]
        : [];
    const isJsonRpc =
      batch.length > 0 &&
      batch.every(
        (message) =>
          message !== null &&
          typeof message === "object" &&
          ("jsonrpc" in message || typeof (message as { method?: unknown }).method === "string"),
      );
    if (!isJsonRpc) {
      return generic(request, reply);
    }

    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const headers = request.headers as Record<string, unknown>;
    const targetHeader = firstString(headers["x-target-mcp-url"]) ?? firstString(headers["x-target-url"]);
    if (!targetHeader) {
      return reply.code(400).send({ error: "missing_x_target_mcp_url" });
    }
    const validation = validateTargetUrl(targetHeader, !!config.localHost);
    if (!validation.valid || !validation.url) {
      return reply.code(400).send({ error: "blocked_target_url", reason: validation.reason });
    }
    const target = validation.url.toString();

    const forwardHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: firstString(headers.accept) ?? "application/json",
    };
    const sessionHeader = firstString(headers["mcp-session-id"]);
    if (sessionHeader) {
      forwardHeaders["mcp-session-id"] = sessionHeader;
    }
    const upstreamAuthorization = firstString(headers["x-upstream-authorization"]);
    if (upstreamAuthorization) {
      forwardHeaders.authorization = upstreamAuthorization;
    }
    const upstreamApiKey = firstString(headers["x-upstream-api-key"]);
    if (upstreamApiKey) {
      forwardHeaders["x-api-key"] = upstreamApiKey;
    }

    const toolCalls = batch.filter((message) => message.method === "tools/call");
    const started = Date.now();
    let upstream: Response;
    let responseText = "";
    try {
      upstream = await fetch(target, {
        method: "POST",
        headers: forwardHeaders,
        body: JSON.stringify(rawBody),
        signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
      });
      responseText = await upstream.text();
    } catch (err) {
      await persistToolRun(deps, auth.user.id, batch, "", 502, `upstream error: ${(err as Error).message}`, Date.now() - started, request);
      return reply.code(502).send({ error: "mcp_upstream_error", detail: (err as Error).message });
    }

    if (toolCalls.length) {
      const parsed = safeJson(responseText);
      const errored = Array.isArray(parsed)
        ? parsed.some((entry) => (entry as { error?: unknown }).error !== undefined)
        : Boolean((parsed as { error?: unknown } | null)?.error);
      await persistToolRun(
        deps,
        auth.user.id,
        batch,
        responseText,
        errored ? Math.max(502, upstream.status) : upstream.status,
        errored ? "json-rpc error" : null,
        Date.now() - started,
        request,
      );
    }

    reply.code(upstream.status);
    reply.header("content-type", upstream.headers.get("content-type") ?? "application/json");
    const sessionOut = upstream.headers.get("mcp-session-id");
    if (sessionOut) {
      reply.header("mcp-session-id", sessionOut);
    }
    return reply.send(responseText);
  };
}

async function persistToolRun(
  deps: McpProxyDeps,
  userId: string,
  batch: Array<Record<string, unknown>>,
  responseText: string,
  status: number,
  error: string | null,
  latencyMs: number,
  request: FastifyRequest,
): Promise<void> {
  try {
    const used = await deps.repos.runs.countRuns(userId);
    if (used >= deps.config.editionConfig.maxRuns) {
      return;
    }
    const headers = request.headers as Record<string, unknown>;
    const project = await deps.repos.projects.findDefault(userId);
    if (!project) {
      return;
    }
    const toolCalls = batch.filter((message) => message.method === "tools/call");
    const toolNames = toolCalls
      .map((message) => {
        const params = (message.params ?? {}) as { name?: unknown };
        return typeof params.name === "string" ? params.name : null;
      })
      .filter((name): name is string => Boolean(name));
    const toolCallEvents = toolCalls.slice(0, 10).map((message) => {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      return { name: typeof params.name === "string" ? params.name : "tools/call", arguments: params.arguments ?? null };
    });
    const name = toolNames.length ? `mcp_proxy: ${toolNames.join(", ")}` : "mcp_proxy: tools/call";
    const runId = crypto.randomUUID();
    const runData: RunData = {
      id: runId,
      user_id: userId,
      project_id: project.id,
      name: name.slice(0, 120),
      provider: "mcp",
      status,
      source: "mcp_proxy",
      request_body: JSON.stringify(batch).slice(0, 20_000),
      latency_ms: latencyMs,
      trace_id: firstString(headers["x-torrix-trace"]) ?? undefined,
      session_id: firstString(headers["x-torrix-session"]) ?? undefined,
      agent_name: firstString(headers["x-agent-name"]) ?? "mcp-proxy",
      tags: { source: "mcp_proxy", tools: toolNames.join(", ") },
      error: error ?? undefined,
      created_at: new Date(Date.now() - latencyMs).toISOString(),
    };
    const run = buildRunRow(runData);
    await deps.repos.runs.save(run);
    await deps.repos.events.addMany([
      makeEvent(runId, "request", runData.request_body ?? ""),
      ...(toolCallEvents.length ? [makeEvent(runId, "tool_call", JSON.stringify(toolCallEvents).slice(0, 4000))] : []),
      makeEvent(runId, "response", responseText.slice(0, 4000)),
    ]);
    emitRun(run);
    deps.host.runRecorded(run);
  } catch (err) {
    console.error("mcp proxy run logging failed", err);
  }
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" && value.trim() ? value : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
