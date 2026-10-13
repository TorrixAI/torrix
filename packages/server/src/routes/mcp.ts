import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Repositories } from "../repos";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { AuthResult, RunData } from "../core/domain";
import { extractBearer, authenticateKey } from "../lib/auth";
import { monthStart, spendSince } from "../lib/costGate";
import { emitRun, serializeSse, acquireSseSlot, releaseSseSlot } from "../lib/events";
import { buildRunRow, makeEvent } from "../lib/runMapper";

export interface McpDeps {
  repos: Repositories;
  config: ServerConfig;
  host?: ExtensionHost;
}

const PROTOCOL_VERSION = "2025-06-18";
const SESSION_TTL_MS = 30 * 60 * 1000;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolSpec[] = [
  {
    name: "get_dashboard",
    description: "Spend, token, latency and error totals for the account over a window, plus per-agent and MCP activity rollups.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window in days (default 7)" },
        project_id: { type: "string" },
      },
    },
  },
  {
    name: "list_runs",
    description: "List recent LLM runs with model, cost, latency and status.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "1-100, default 25" },
        model: { type: "string" },
        source: { type: "string" },
        agent: { type: "string", description: "Filter by agent_name" },
        score: { type: "string", enum: ["good", "bad", "unscored"] },
      },
    },
  },
  {
    name: "get_run",
    description: "Full prompt, response, thinking and tool-call history for one run.",
    inputSchema: {
      type: "object",
      properties: { run_id: { type: "string" } },
      required: ["run_id"],
    },
  },
  {
    name: "compare_runs",
    description: "Compare two to four runs side by side: tokens, cost, latency, score and response text.",
    inputSchema: {
      type: "object",
      properties: {
        run_ids: { type: "array", items: { type: "string" }, description: "2-4 run ids" },
        run_a_id: { type: "string", description: "Legacy alias for the first run id" },
        run_b_id: { type: "string", description: "Legacy alias for the second run id" },
      },
    },
  },
  {
    name: "get_trace",
    description: "All runs sharing a trace id, oldest first.",
    inputSchema: {
      type: "object",
      properties: { trace_id: { type: "string" }, limit: { type: "number" } },
      required: ["trace_id"],
    },
  },
  {
    name: "get_session",
    description: "All runs in a conversation session, oldest first.",
    inputSchema: {
      type: "object",
      properties: { session_id: { type: "string" }, limit: { type: "number" } },
      required: ["session_id"],
    },
  },
  {
    name: "get_cost_summary",
    description: "Month-to-date spend plus per-model and per-source breakdown.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "search_runs",
    description: "Search run names, models and request bodies.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "list_anomalies",
    description: "Runs whose cost exceeded the account's typical baseline.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
];

/**
 * Model Context Protocol server over streamable HTTP. Exposes read-only
 * observability tools so an agent can answer "what did we spend, and what did
 * the model actually say" without a bespoke integration. Sessions follow the
 * Streamable HTTP transport: `Mcp-Session-Id` on initialize, SSE via GET,
 * termination via DELETE. Every tools/call is itself recorded as a run so MCP
 * traffic shows up in the same analytics as everything else.
 */
export async function mcpRoute(app: FastifyInstance, deps: McpDeps): Promise<void> {
  const { repos, config } = deps;
  const sessions = new Map<string, { createdAt: number; lastSeenAt: number }>();

  const sweepSessions = (): void => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastSeenAt < cutoff) {
        sessions.delete(id);
      }
    }
  };

  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResult | null> => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    return auth;
  };

  const sessionFrom = (request: FastifyRequest): { id: string | null; unknown: boolean } => {
    const raw = String((request.headers as Record<string, unknown>)["mcp-session-id"] ?? "").trim();
    if (!raw) {
      return { id: null, unknown: false };
    }
    if (!sessions.has(raw)) {
      return { id: raw, unknown: true };
    }
    sessions.get(raw)!.lastSeenAt = Date.now();
    return { id: raw, unknown: false };
  };

  app.post("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) {
      return reply;
    }
    sweepSessions();
    const session = sessionFrom(request);
    if (session.unknown) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    const payload = request.body as JsonRpcRequest | JsonRpcRequest[] | null;
    const batch = Array.isArray(payload) ? payload : payload ? [payload] : [];
    if (!batch.length) {
      return reply.code(400).send(jsonRpcError(null, -32600, "invalid request"));
    }

    const responses: unknown[] = [];
    let activeSession = session.id;
    if (!activeSession && batch.some((rpc) => rpc.method === "initialize")) {
      activeSession = crypto.randomUUID();
      sessions.set(activeSession, { createdAt: Date.now(), lastSeenAt: Date.now() });
    }
    for (const rpc of batch.slice(0, 64)) {
      const result = await dispatch(rpc, auth, deps, activeSession);
      if (result !== undefined) {
        responses.push(result);
      }
    }

    if (activeSession) {
      reply.header("mcp-session-id", activeSession);
    }
    if (!responses.length) {
      return reply.code(202).send();
    }
    return reply.send(Array.isArray(payload) ? responses : responses[0]);
  });

  app.get("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) {
      return reply;
    }
    sweepSessions();
    const accept = String((request.headers as Record<string, unknown>).accept ?? "");
    const session = sessionFrom(request);
    if (session.unknown) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    if (accept.includes("text/event-stream")) {
      if (!acquireSseSlot()) {
        return reply.code(503).send({ error: "too_many_streams" });
      }
      const sessionId = session.id ?? crypto.randomUUID();
      sessions.set(sessionId, { createdAt: Date.now(), lastSeenAt: Date.now() });
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "mcp-session-id": sessionId,
      });
      reply.raw.write(serializeSse({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
      const heartbeat = setInterval(() => {
        reply.raw.write(": ping\n\n");
      }, 25_000);
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        releaseSseSlot();
      });
      return reply;
    }
    return reply.send({
      name: "torrix",
      version: config.version,
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http",
      session: session.id,
      tools: allTools().map((t) => t.name),
    });
  });

  app.delete("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await authenticate(request, reply);
    if (!auth) {
      return reply;
    }
    const session = sessionFrom(request);
    if (!session.id) {
      return reply.code(400).send({ error: "session_id_required" });
    }
    if (session.unknown) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    sessions.delete(session.id);
    return reply.send({ ok: true });
  });

  async function dispatch(rpc: JsonRpcRequest, auth: AuthResult, context: McpDeps, sessionId: string | null) {
    const id = rpc.id ?? null;
    switch (rpc.method) {
      case "initialize": {
        const requested = String((rpc.params?.protocolVersion as string | undefined) ?? PROTOCOL_VERSION);
        const session = sessionId ?? crypto.randomUUID();
        sessions.set(session, { createdAt: Date.now(), lastSeenAt: Date.now() });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: requested === PROTOCOL_VERSION ? requested : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "torrix", version: context.config.version },
            sessionId: session,
          },
        };
      }
      case "notifications/initialized":
        return undefined;
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: allTools() } };
      case "tools/call": {
        const name = typeof rpc.params?.name === "string" ? rpc.params.name : "";
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        const started = Date.now();
        try {
          const payload = await runTool(name, args, auth, context);
          const text = JSON.stringify(payload, null, 2);
          void logToolRun(context, auth, name, args, text, false, started, sessionId);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text }],
              isError: false,
            },
          };
        } catch (err) {
          const message = (err as Error).message;
          void logToolRun(context, auth, name, args, message, true, started, sessionId);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: message }],
              isError: true,
            },
          };
        }
      }
      default:
        return jsonRpcError(id, -32601, `method not found: ${rpc.method ?? "unknown"}`);
    }
  }

  function allTools(): ToolSpec[] {
    return [...TOOLS, ...(deps.host?.mcpTools() ?? []).map((tool) => tool.definition)];
  }

  async function runTool(name: string, args: Record<string, unknown>, auth: AuthResult, context: McpDeps) {
    const userId = auth.user.id;
    const limit = clampInt(args.limit, 25, 1, 100);
    const contributed = deps.host?.mcpTools().find((tool) => tool.definition.name === name);
    if (contributed) {
      return contributed.handler({ userId, limit }, args);
    }

    switch (name) {
      case "get_dashboard": {
        const days = clampInt(args.days, 7, 1, 365);
        const stats = await repos.runs.dashboardStats(userId, {
          projectId: str(args.project_id),
          from: new Date(Date.now() - days * 86_400_000).toISOString(),
        });
        return stats;
      }
      case "list_runs": {
        const { runs, total } = await repos.runs.list(userId, {
          limit,
          offset: 0,
          projectId: str(args.project_id),
          model: str(args.model),
          source: str(args.source),
          agentName: str(args.agent),
          score: args.score === "good" || args.score === "bad" || args.score === "unscored" ? args.score : undefined,
        });
        return { total, runs: runs.map(briefRun) };
      }
      case "get_run": {
        const runId = str(args.run_id);
        const run = runId ? await repos.runs.getById(runId, userId) : null;
        if (!run) {
          throw new Error("run not found");
        }
        const events = await repos.events.listByRun(run.id);
        return { run, events };
      }
      case "compare_runs": {
        const requested = Array.isArray(args.run_ids)
          ? args.run_ids.map(String).filter(Boolean).slice(0, 4)
          : [str(args.run_a_id), str(args.run_b_id)].filter((id): id is string => Boolean(id));
        if (requested.length < 2) {
          throw new Error("run_ids must contain 2 to 4 run ids (or pass run_a_id and run_b_id)");
        }
        const compared = [];
        for (const runId of requested) {
          const run = await repos.runs.getById(runId, userId);
          if (!run) {
            continue;
          }
          const events = await repos.events.listByRun(run.id);
          const response = events
            .filter((event) => event.type === "response")
            .map((event) => event.message)
            .join("\n");
          compared.push({ ...briefRun(run), response: response.slice(0, 4000) });
        }
        if (compared.length < 2) {
          throw new Error("at least two runs must exist");
        }
        return { runs: compared };
      }
      case "get_trace":
      case "get_session": {
        const kind = name === "get_trace" ? "trace" : "session";
        const id = str(args[kind === "trace" ? "trace_id" : "session_id"]);
        if (!id) {
          throw new Error(`${kind} id required`);
        }
        const { runs, total } = await repos.runs.listGroup(userId, { kind, id, limit, offset: 0 });
        if (kind === "trace" && deps.host) {
          const authorization = await deps.host.traceAnnotations({
            userId,
            traceId: id,
            runIds: runs.map((run) => run.id),
          });
          return { kind, id, total, runs: runs.map(briefRun), authorization };
        }
        return { kind, id, total, runs: runs.map(briefRun) };
      }
      case "get_cost_summary": {
        const since = monthStart();
        const monthSpend = await spendSince(repos, userId, since, "user");
        const projectSpend = str(args.project_id)
          ? await spendSince(repos, userId, since, "project", str(args.project_id) as string)
          : null;
        const stats = await repos.runs.dashboardStats(userId, { projectId: str(args.project_id), from: since });
        return {
          month: since.slice(0, 10),
          month_spend_usd: monthSpend,
          project_spend_usd: projectSpend,
          total_runs: stats.totalRuns,
          errors: stats.errorCount,
          p50_latency_ms: stats.p50LatencyMs,
          p95_latency_ms: stats.p95LatencyMs,
          by_model: stats.byModel.slice(0, 10),
        };
      }
      case "search_runs": {
        const query = str(args.query);
        if (!query) {
          throw new Error("query required");
        }
        const { runs, total } = await repos.runs.list(userId, {
          limit,
          offset: 0,
          search: query,
          deepSearch: context.config.editionConfig.fullTextSearch,
        });
        return { query, total, runs: runs.map(briefRun) };
      }
      case "list_anomalies": {
        const { runs } = await repos.runs.list(userId, { limit, offset: 0, anomalyOnly: true });
        return { runs: runs.map(briefRun) };
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  }

  async function logToolRun(
    context: McpDeps,
    auth: AuthResult,
    toolName: string,
    args: Record<string, unknown>,
    resultText: string,
    isError: boolean,
    started: number,
    sessionId: string | null,
  ): Promise<void> {
    try {
      const userId = auth.user.id;
      const used = await context.repos.runs.countRuns(userId);
      if (used >= context.config.editionConfig.maxRuns) {
        return;
      }
      const project = await context.repos.projects.findDefault(userId);
      if (!project) {
        return;
      }
      const runId = crypto.randomUUID();
      const now = new Date().toISOString();
      const runData: RunData = {
        id: runId,
        user_id: userId,
        project_id: project.id,
        name: `mcp: ${toolName}`.slice(0, 120),
        provider: "mcp",
        status: isError ? 500 : 200,
        source: "mcp",
        request_body: JSON.stringify({ tool: toolName, arguments: args }).slice(0, 20_000),
        latency_ms: Date.now() - started,
        trace_id: sessionId ?? undefined,
        session_id: sessionId ?? undefined,
        agent_name: "mcp-client",
        tags: { source: "mcp", tool: toolName },
        created_at: new Date(started).toISOString(),
      };
      const run = buildRunRow(runData);
      await context.repos.runs.save(run);
      await context.repos.events.addMany([
        makeEvent(runId, "request", runData.request_body ?? ""),
        makeEvent(runId, "tool_call", JSON.stringify({ name: toolName, arguments: args }).slice(0, 4000)),
        makeEvent(runId, isError ? "error" : "response", resultText.slice(0, 4000)),
      ]);
      emitRun(run);
      context.host?.runRecorded(run);
    } catch (err) {
      console.error("mcp tool run logging failed", err);
    }
  }
}

function briefRun(run: {
  id: string;
  name?: string | null;
  model?: string | null;
  provider?: string | null;
  source?: string | null;
  status?: number | null;
  cost_usd?: number | null;
  latency_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  thinking_tokens?: number | null;
  session_id?: string | null;
  trace_id?: string | null;
  parent_run_id?: string | null;
  agent_name?: string | null;
  score?: number | null;
  created_at: string;
}) {
  return {
    id: run.id,
    name: run.name,
    model: run.model,
    provider: run.provider,
    source: run.source,
    status: run.status,
    cost_usd: run.cost_usd,
    latency_ms: run.latency_ms,
    input_tokens: run.input_tokens,
    output_tokens: run.output_tokens,
    thinking_tokens: run.thinking_tokens,
    session_id: run.session_id,
    trace_id: run.trace_id,
    parent_run_id: run.parent_run_id,
    agent_name: run.agent_name,
    score: run.score,
    created_at: run.created_at,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function jsonRpcError(id: string | number | null, code: number, message: string): unknown {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
