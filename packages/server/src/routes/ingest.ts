import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { Repositories } from "../repos";
import { authenticateKey, authorizeKeyScope, extractBearer } from "../lib/auth";
import { calculateCost, detectProvider } from "../lib/pricing";
import { extractAnthropic, extractAutoName, extractGeneric, extractMedia, extractOpenAI, type ToolCall } from "../lib/extract";
import { persistMedia } from "../lib/media";
import { emitRun } from "../lib/events";
import { buildRunRow, makeEvent } from "../lib/runMapper";
import { checkHardCap, evaluateRunCost } from "../lib/costGate";
import { applyMasking } from "../lib/masking";
import type { AuthResult, ProjectRole, RunData, RunSource } from "../core/domain";

export interface IngestDeps {
  repos: Repositories;
  config: ServerConfig;
  host: ExtensionHost;
}

const INGEST_SOURCES: RunSource[] = [
  "proxy",
  "sdk",
  "playground",
  "eval",
  "mcp",
  "mcp_proxy",
  "otel",
  "dataset",
];

interface IngestRequest {
  id?: string;
  name?: string;
  provider?: string;
  model?: string;
  status?: number;
  latency_ms?: number;
  start_time?: string;
  end_time?: string;
  target_url?: string;
  project_id?: string;
  trace_id?: string;
  session_id?: string;
  parent_run_id?: string;
  agent_name?: string;
  agent_id?: string;
  end_user_id?: string;
  tags?: Record<string, string>;
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  request?: { body?: unknown };
  response?: { body?: unknown };
  retrieval_docs?: unknown[];
  error?: string;
  source?: string;
  dataset_id?: string;
  dataset_row_id?: string;
}

const TRUNCATE_BYTES = 4000;
const MAX_BATCH = 500;

function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function countTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length);
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (body && typeof body === "object") {
    return body as Record<string, unknown>;
  }
  if (typeof body === "string" && body) {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function serializeBody(body: unknown): string | null {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return null;
  }
}

export async function ingestRoute(app: FastifyInstance, deps: IngestDeps): Promise<void> {
  const { repos, config } = deps;

  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthResult | undefined> => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      reply.code(401).send({ error: "unauthorized" });
      return undefined;
    }
    return auth;
  };

  const readRequestHeader = (request: FastifyRequest, name: string): string | null => {
    const value = (request.headers as Record<string, string | undefined>)[name];
    return value && value.trim() ? value.trim() : null;
  };

  app.post("/api/ingest", async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) {
      return;
    }
    const { user, keyRecord } = auth;

    const raw = request.body as { records?: IngestRequest[] } | IngestRequest[] | null | undefined;
    const list = Array.isArray(raw) ? (raw as IngestRequest[]) : ((raw as { records?: IngestRequest[] })?.records ?? []);
    if (!Array.isArray(list)) {
      return reply.code(400).send({ error: "invalid_batch" });
    }
    if (list.length === 0) {
      return reply.code(400).send({ error: "empty_batch" });
    }
    const records = list.slice(0, MAX_BATCH);

    const headerProject = readRequestHeader(request, "x-torrix-project");

    const maxRuns = config.editionConfig.maxRuns;
    if (Number.isFinite(maxRuns)) {
      const used = await repos.runs.countRuns(user.id);
      if (used >= maxRuns) {
        return reply.code(429).send({ error: "run_limit_reached", runs: used, max_runs: maxRuns });
      }
    }

    const startGate = await checkHardCap(deps, { userId: user.id, projectId: null, apiKeyId: keyRecord?.id ?? null });
    if (startGate.blocked) {
      return reply.code(429).send({ error: "hard_cap_reached", monthly_spend: startGate.spend, cap: startGate.cap });
    }

    const ids: string[] = [];
    const rejected: Array<{ id: string; error: string }> = [];
    let accepted = 0;
    const projectGates = new Map<string, { blocked: boolean }>();
    const roleCache = new Map<string, ProjectRole | null>();

    for (const record of records) {
      if (!record || typeof record !== "object") {
        continue;
      }

      let projectId = record.project_id ?? null;
      if (!projectId && headerProject) {
        const byId = await repos.projects.findById(headerProject);
        if (byId) {
          projectId = byId.id;
        } else {
          const accessible = await repos.projects.listAccessible(user.id);
          projectId = accessible.find((entry) => entry.project.name === headerProject)?.project.id ?? null;
        }
      }
      if (!projectId) {
        projectId = (await repos.projects.findDefault(user.id))?.id ?? null;
      }
      if (!projectId) {
        return reply.code(400).send({ error: "no_project", detail: "create a project before ingesting" });
      }

      let role = roleCache.get(projectId);
      if (role === undefined) {
        role = await repos.projects.roleFor(user.id, projectId);
        roleCache.set(projectId, role);
      }
      if (!role) {
        return reply.code(403).send({ error: "project_forbidden" });
      }
      if (role === "viewer") {
        return reply.code(403).send({ error: "project_read_only" });
      }

      const scopeCheck = authorizeKeyScope(keyRecord, projectId, true);
      if (!scopeCheck.allowed) {
        return reply.code(403).send({ error: "forbidden", reason: scopeCheck.reason });
      }

      let projectGate = projectGates.get(projectId);
      if (!projectGate) {
        projectGate = await checkHardCap(deps, { userId: user.id, projectId, apiKeyId: keyRecord?.id ?? null });
        projectGates.set(projectId, projectGate);
      }
      if (projectGate.blocked) {
        continue;
      }

      const runId = record.id ?? crypto.randomUUID();
      // Client-chosen ids make ingest idempotent: a retried batch re-sends the
      // same records, and ones already stored are acknowledged, not duplicated.
      if (record.id) {
        const owner = await repos.runs.ownerOf(record.id);
        if (owner === user.id) {
          ids.push(record.id);
          accepted += 1;
          continue;
        }
        if (owner !== null) {
          rejected.push({ id: record.id, error: "run_id_conflict" });
          continue;
        }
      }
      const provider = record.provider ?? detectProvider(record.target_url ?? "");
      const requestBody = parseBody(record.request?.body);
      const responseBody = parseBody(record.response?.body);

      let retrievalDocs: string | null = null;
      if (Array.isArray(record.retrieval_docs)) {
        retrievalDocs = JSON.stringify(record.retrieval_docs.slice(0, 50));
      } else if (requestBody && Array.isArray(requestBody.retrieval_docs)) {
        retrievalDocs = JSON.stringify((requestBody.retrieval_docs as unknown[]).slice(0, 50));
        delete requestBody.retrieval_docs;
      }

      let mediaCount = 0;
      let mediaAssets: string | null = null;
      if (requestBody) {
        const media = extractMedia(requestBody, provider);
        if (media.length) {
          mediaCount = media.length;
          try {
            mediaAssets = JSON.stringify(await persistMedia(config.mediaDir, media));
          } catch {
            mediaAssets = null;
          }
        }
      }

      let inputTokens = record.input_tokens ?? null;
      let outputTokens = record.output_tokens ?? null;
      let thinkingTokens = record.thinking_tokens ?? null;
      let cacheReadTokens = record.cache_read_tokens ?? null;
      let cacheCreationTokens = record.cache_creation_tokens ?? null;
      let finishReason: string | null = null;
      let responseText = "";
      let thinkingText = "";
      let toolCalls: ToolCall[] = [];
      let autoName: string | null = null;

      if (requestBody) {
        autoName = extractAutoName(requestBody);
        if (responseBody) {
          const isAnthropicShape = provider === "anthropic" || Array.isArray(responseBody.content);
          const isOpenAiShape = !isAnthropicShape && Array.isArray(requestBody.messages);
          const extracted = isAnthropicShape
            ? extractAnthropic(requestBody, responseBody, { maxTextLen: TRUNCATE_BYTES })
            : isOpenAiShape
              ? extractOpenAI(requestBody, responseBody, { maxTextLen: TRUNCATE_BYTES })
              : extractGeneric(requestBody, responseBody, { maxTextLen: TRUNCATE_BYTES });
          inputTokens = inputTokens ?? extracted.inputTokens;
          outputTokens = outputTokens ?? extracted.outputTokens;
          cacheReadTokens = cacheReadTokens ?? extracted.cacheReadTokens;
          cacheCreationTokens = cacheCreationTokens ?? extracted.cacheCreationTokens;
          finishReason = extracted.finishReason;
          responseText = extracted.responseText;
          thinkingText = extracted.thinkingText;
          toolCalls = extracted.toolCalls;
        }
      }
      if (thinkingTokens == null && thinkingText) {
        thinkingTokens = countTokens(thinkingText);
      }

      const modelFromBody = typeof requestBody?.model === "string" ? requestBody.model : null;
      const model = record.model ?? modelFromBody ?? null;
      const cost = record.cost_usd ?? calculateCost(model ?? "unknown", inputTokens, outputTokens, { read: cacheReadTokens, write: cacheCreationTokens });

      let latencyMs = record.latency_ms ?? null;
      if (latencyMs == null && record.start_time && record.end_time) {
        const start = new Date(record.start_time).getTime();
        const end = new Date(record.end_time).getTime();
        if (Number.isFinite(start) && Number.isFinite(end)) {
          latencyMs = Math.max(0, end - start);
        }
      }

      const requestBodyForLog = requestBody
        ? truncateText(serializeBody(requestBody) ?? "", TRUNCATE_BYTES)
        : record.request?.body
          ? truncateText(serializeBody(record.request.body) ?? "", TRUNCATE_BYTES)
          : null;
      const responseBodyForLog = responseText ? truncateText(responseText, TRUNCATE_BYTES) : record.response?.body ? truncateText(serializeBody(record.response.body) ?? "", TRUNCATE_BYTES) : null;

      const source: RunSource = record.source && (INGEST_SOURCES as string[]).includes(record.source) ? (record.source as RunSource) : "sdk";

      const now = new Date().toISOString();
      const startedMs = record.start_time ? Date.parse(record.start_time) : Number.NaN;
      const createdAt = Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : now;
      const runData: RunData = {
        id: runId,
        user_id: user.id,
        project_id: projectId,
        name: record.name ?? autoName ?? undefined,
        provider,
        model: model ?? undefined,
        input_tokens: inputTokens ?? undefined,
        output_tokens: outputTokens ?? undefined,
        thinking_tokens: thinkingTokens ?? undefined,
        cache_read_tokens: cacheReadTokens ?? undefined,
        cache_creation_tokens: cacheCreationTokens ?? undefined,
        cost_usd: cost,
        latency_ms: latencyMs ?? undefined,
        status: record.status ?? (record.error ? 502 : 200),
        finish_reason: finishReason ?? undefined,
        source,
        request_body: requestBodyForLog ?? undefined,
        request_bytes: requestBodyForLog ? Buffer.byteLength(requestBodyForLog, "utf8") : undefined,
        response_bytes: responseBodyForLog ? Buffer.byteLength(responseBodyForLog, "utf8") : undefined,
        target_url: record.target_url ?? undefined,
        trace_id: record.trace_id ?? undefined,
        session_id: record.session_id ?? undefined,
        parent_run_id: record.parent_run_id ?? undefined,
        agent_name: record.agent_name ?? undefined,
        agent_id: record.agent_id ?? undefined,
        end_user_id: record.end_user_id ?? undefined,
        tags: record.tags && Object.keys(record.tags).length ? record.tags : undefined,
        api_key_id: keyRecord?.id ?? undefined,
        dataset_id: record.dataset_id ?? undefined,
        dataset_row_id: record.dataset_row_id ?? undefined,
        retrieval_docs: retrievalDocs ?? undefined,
        media_count: mediaCount || undefined,
        media_assets: mediaAssets ?? undefined,
        error: record.error ?? undefined,
        created_at: createdAt,
      };

      const events = [makeEvent(runId, "info", `ingest · source:${source} · provider:${provider}`)];
      if (requestBodyForLog) {
        events.push(makeEvent(runId, "request", requestBodyForLog));
      }
      if (record.error) {
        events.push(makeEvent(runId, "error", record.error));
      } else if (responseBodyForLog) {
        events.push(makeEvent(runId, "response", responseBodyForLog));
      }

      const costEval = await evaluateRunCost(
        deps,
        { userId: user.id, projectId, apiKeyId: keyRecord?.id ?? null },
        cost,
        { runId, model: model ?? null, status: runData.status ?? 200, error: record.error ?? null },
      );
      runData.is_anomaly = costEval.isAnomaly;

      const govSettings = await repos.governance.getSettings(user.id);
      const thinkingForLog = thinkingText ? truncateText(thinkingText, TRUNCATE_BYTES) : null;
      const toolCallsForLog = toolCalls.length ? truncateText(JSON.stringify(toolCalls), TRUNCATE_BYTES) : null;
      const masked = applyMasking(govSettings, {
        request: runData.request_body ?? null,
        response: responseBodyForLog ?? null,
        thinking: thinkingForLog,
        toolCalls: toolCallsForLog,
      });
      if (masked.masked) {
        runData.request_body = masked.request ?? undefined;
        runData.pii_masked = true;
        runData.pii_findings = JSON.stringify(masked.findings);
      }
      if (masked.request) {
        const idx = events.findIndex((e) => e.type === "request");
        if (idx >= 0) {
          events[idx] = makeEvent(runId, "request", masked.request);
        }
      }
      if (masked.response && !record.error) {
        const idx = events.findIndex((e) => e.type === "response");
        if (idx >= 0) {
          events[idx] = makeEvent(runId, "response", masked.response);
        }
      }
      if (masked.thinking) {
        events.push(makeEvent(runId, "thinking", masked.thinking));
      }
      if (masked.toolCalls) {
        events.push(makeEvent(runId, "tool_call", masked.toolCalls));
      }
      if (masked.masked) {
        events.push(makeEvent(runId, "info", `PII masked: ${masked.findings.map((f) => `${f.type} x${f.count}`).join(", ")}`));
      }

      const savedRun = buildRunRow(runData);
      await repos.runs.save(savedRun);
      if (events.length) {
        await repos.events.addMany(events);
      }
      emitRun(savedRun);
      deps.host.runRecorded(savedRun);

      ids.push(runId);
      accepted += 1;
    }

    return reply.send(rejected.length ? { accepted, ids, rejected } : { accepted, ids });
  });
}