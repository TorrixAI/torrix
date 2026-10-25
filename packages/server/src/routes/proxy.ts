import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config";
import type { Repositories } from "../repos";
import { authenticateKey, extractBearer, authorizeKeyScope } from "../lib/auth";
import { validateTargetUrl } from "../lib/validate";
import { detectProvider, calculateCost } from "../lib/pricing";
import {
  extractOpenAI,
  extractAnthropic,
  extractGemini,
  extractGeneric,
  extractFromSSEChunks,
  extractAutoName,
  extractMedia,
  detectStructuredOutput,
  extractToolCalls,
  promptHash,
} from "../lib/extract";
import { persistMedia } from "../lib/media";
import { emitRun } from "../lib/events";
import { makeEvent as ev, buildRunRow as toRun } from "../lib/runMapper";
import { parsePromptRef, renderTemplate } from "../lib/prompts";
import type { Events, PolicyVerdict, ProjectRole, Run, RunData, RunSource } from "../core/domain";
import { checkHardCap, evaluateRunCost } from "../lib/costGate";
import { applyMasking } from "../lib/masking";
import { recordAudit } from "../lib/audit";
import type { ExtensionHost } from "../core/extensionHost";
import { compressRequestBody, normalizeCompressionMode, parseCompressionWords } from "../lib/compress";

export interface ProxyDeps {
  repos: Repositories;
  config: ServerConfig;
  host: ExtensionHost;
}

const ALLOWED_SOURCES = new Set<RunSource>(["proxy", "sdk", "playground", "eval", "mcp", "mcp_proxy", "otel", "dataset"]);

function pickSource(header: string | null): RunSource {
  return header && ALLOWED_SOURCES.has(header as RunSource) ? (header as RunSource) : "proxy";
}

type RunGrouping = Pick<RunData, "name" | "trace_id" | "session_id" | "parent_run_id" | "agent_name" | "agent_id" | "end_user_id">;

/** W3C trace context: `00-<32 hex trace id>-<16 hex span id>-<flags>`. */
function traceIdFromTraceparent(header: string | null): string | null {
  const match = header ? /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i.exec(header.trim()) : null;
  return match && !/^0+$/.test(match[1]) ? match[1].toLowerCase() : null;
}

const BLOCKED_FORWARD_HEADERS = new Set([
  "host",
  "authorization",
  "x-upstream-authorization",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
]);

export async function proxyRoute(app: FastifyInstance, deps: ProxyDeps): Promise<void> {
  app.all("/proxy", createProxyHandler(deps, null));
  // Provider SDKs append their own path (`/chat/completions`, `/v1/messages`)
  // to a configured base URL; the handler forwards to `x-target-url` regardless.
  app.all("/proxy/*", createProxyHandler(deps, null));
}

/**
 * Builds the full proxy pipeline as a reusable handler. `forcedSource` pins the
 * run source so an MCP-driven agent is labelled `mcp_proxy` rather than the
 * caller's guess, while still going through identical SSRF, cost and policy
 * gates. `null` means "trust the x-torrix-source header".
 */
export function createProxyHandler(deps: ProxyDeps, forcedSource: RunSource | null) {
  const { repos, config } = deps;

  return async function handleProxyRequest(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
      const start = Date.now();
      const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
      const method = request.method;
      const body = request.body;
      let bodyText = rawBody ? rawBody.toString("utf8") : body && typeof body === "object" ? JSON.stringify(body) : undefined;

      const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
      if (!key) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const auth = await authenticateKey(repos.db, key);
      if (!auth) {
        return reply.code(401).send({ error: "invalid_api_key" });
      }
      const { user, keyRecord } = auth;

      const h = headerReader(request);

      const targetHeader = h("x-target-url");
      if (!targetHeader) {
        return reply.code(400).send({ error: "missing_x_target_url" });
      }
      let target = targetHeader;
      let urlValidation = validateTargetUrl(target, !!config.localHost);
      if (!urlValidation.valid && urlValidation.reason === "localhost_blocked" && config.localHost) {
        target = rewriteLocalhost(target, config.localHost);
        urlValidation = validateTargetUrl(target, true);
      }
      if (!urlValidation.valid || !urlValidation.url) {
        return reply.code(400).send({ error: "blocked_target_url", reason: urlValidation.reason });
      }
      const resolvedTarget = urlValidation.url.toString();
      let effectiveTarget = resolvedTarget;

      const provider = h("x-torrix-provider") ?? detectProvider(resolvedTarget);
      const source = forcedSource ?? pickSource(h("x-torrix-source"));
      const requestedRunId = h("x-run-id") ?? h("helicone-request-id");
      if (requestedRunId && (await repos.runs.ownerOf(requestedRunId)) !== null) {
        return reply.code(409).send({ error: "run_id_conflict" });
      }
      const runId = requestedRunId ?? crypto.randomUUID();
      const traceId = h("x-torrix-trace") ?? traceIdFromTraceparent(h("traceparent"));
      const sessionId = h("x-torrix-session") ?? h("helicone-session-id") ?? null;
      const agentName = h("x-agent-name") ?? null;
      const agentId = h("x-torrix-agent-id") ?? null;
      const endUserId = h("x-torrix-user-id") ?? h("helicone-user-id") ?? null;
      const parentRunId = h("x-torrix-parent-run-id") ?? null;
      const runName = h("x-torrix-name") ?? h("helicone-property-name") ?? (bodyText ? extractAutoName(parseJson(bodyText) ?? {}) : "untitled");
      const tagsHeader = h("x-torrix-tags");
      const tags = {
        ...heliconePropertyTags(request.headers as Record<string, string | string[] | undefined>),
        ...parseTags(tagsHeader),
      };
      const heliconeSessionPath = h("helicone-session-path");
      if (heliconeSessionPath) {
        tags.session_path = heliconeSessionPath.slice(0, 200);
      }
      const requestProject = h("x-torrix-project");
      const grouping: RunGrouping = {
        name: runName,
        trace_id: traceId ?? undefined,
        session_id: sessionId ?? undefined,
        parent_run_id: parentRunId ?? undefined,
        agent_name: agentName ?? undefined,
        agent_id: agentId ?? undefined,
        end_user_id: endUserId ?? undefined,
      };
      const startedAt = new Date(start).toISOString();

      const sampleHeader = h("x-torrix-sample");
      const globalSample = (await repos.instance.get("global_sample_rate")) ?? "1";
      const sampleRate = clamp01(sampleHeader ? Number(sampleHeader) : Number(globalSample));
      const shouldLog = Math.random() < sampleRate;

      let projectId = "";
      let projectRole: ProjectRole | null = null;
      if (requestProject) {
        const byId = await repos.projects.findById(requestProject);
        if (byId) {
          projectRole = await repos.projects.roleFor(user.id, byId.id);
          if (!projectRole) {
            return reply.code(403).send({ error: "project_forbidden" });
          }
          projectId = byId.id;
        } else {
          const accessible = await repos.projects.listAccessible(user.id);
          const byName = accessible.find((entry) => entry.project.name === requestProject);
          if (byName) {
            projectId = byName.project.id;
            projectRole = byName.role;
          }
        }
      }
      if (!projectId) {
        const fallback = await repos.projects.findDefault(user.id);
        projectId = fallback?.id ?? "";
        projectRole = fallback ? await repos.projects.roleFor(user.id, fallback.id) : null;
      }
      if (!projectId) {
        return reply.code(400).send({ error: "no_project" });
      }
      if (projectRole === "viewer") {
        return reply.code(403).send({ error: "project_read_only" });
      }

      const projectRow = await repos.projects.findById(projectId);
      const compressionMode = normalizeCompressionMode(projectRow?.prompt_compression);
      const compressionWords = parseCompressionWords(projectRow?.compression_words);

      const scopeCheck = authorizeKeyScope(keyRecord, projectId, true);
      if (!scopeCheck.allowed) {
        return reply.code(403).send({ error: "forbidden", reason: scopeCheck.reason });
      }

      if (Number.isFinite(config.editionConfig.maxRuns)) {
        const stored = await repos.runs.countRuns(user.id);
        if (stored >= config.editionConfig.maxRuns) {
          return reply.code(429).send({ error: "run_limit_reached", limit: config.editionConfig.maxRuns });
        }
      }
      if (source === "playground" && Number.isFinite(config.editionConfig.maxPlaygroundRuns)) {
        const stored = await repos.runs.countBySource(user.id, "playground");
        if (stored >= config.editionConfig.maxPlaygroundRuns) {
          return reply.code(429).send({ error: "playground_limit_reached", limit: config.editionConfig.maxPlaygroundRuns });
        }
      }

      const capGate = await checkHardCap(deps, { userId: user.id, projectId, apiKeyId: keyRecord?.id ?? null });
      if (capGate.blocked) {
        return reply.code(429).send({ error: "hard_cap_reached", monthly_spend: capGate.spend, cap: capGate.cap });
      }

      const refusal = await deps.host.admitProxy({ userId: user.id, sessionId });
      if (refusal) {
        const detail = String(refusal.body.detail ?? refusal.body.error ?? "refused");
        await persistRefusedRun(deps, {
          runId,
          userId: user.id,
          projectId,
          provider,
          model: typeof (parseJson(bodyText) ?? {}).model === "string" ? String((parseJson(bodyText) ?? {}).model) : null,
          targetUrl: resolvedTarget,
          source,
          grouping,
          startedAt,
          status: refusal.status,
          error: `${String(refusal.body.error ?? "refused")}: ${detail}`,
          flags: [],
          requestBodyForLog: null,
          piiMasked: false,
          piiFindings: null,
          review: false,
        });
        return reply.code(refusal.status).send({ ...refusal.body, run_id: runId });
      }

      const fusedTags = { ...tags };
      let parsedBody = parseJson(bodyText) ?? (typeof body === "object" ? (body as Record<string, unknown>) : undefined);
      const requestedModel = typeof parsedBody?.model === "string" ? parsedBody.model : null;

      const govSettings = await repos.governance.getSettings(user.id);
      const requestInspection = await deps.host.inspectRequest({
        userId: user.id,
        projectId,
        sessionId,
        provider,
        model: requestedModel,
        maxTokens: typeof parsedBody?.max_tokens === "number" ? parsedBody.max_tokens : null,
        bodyText,
        body: parsedBody ?? null,
        promptText: null,
      });
      if (requestInspection.block) {
        const blockReason = requestInspection.block.reason;
        const blockedBody = applyMasking(govSettings, {
          request: bodyText ? truncateChars(bodyText, 4000) : null,
          name: grouping.name ?? null,
        });
        await persistRefusedRun(deps, {
          runId,
          userId: user.id,
          projectId,
          provider,
          model: requestedModel,
          targetUrl: resolvedTarget,
          source,
          grouping: { ...grouping, name: blockedBody.name ?? grouping.name },
          startedAt,
          status: 451,
          error: `blocked_by_policy: ${blockReason}`,
          review: true,
          flags: requestInspection.flags,
          requestBodyForLog: blockedBody.request,
          piiMasked: blockedBody.masked,
          piiFindings: blockedBody.findings.length ? JSON.stringify(blockedBody.findings) : null,
        });
        recordAudit(repos, {
          userId: user.id,
          projectId,
          actor: `api_key:${keyRecord?.key_prefix ?? "unknown"}`,
          action: "policy.block",
          targetType: "run",
          targetId: runId,
          detail: { reason: blockReason },
        });
        return reply.code(451).send({
          error: "blocked_by_policy",
          reason: blockReason,
          run_id: runId,
        });
      }
      const requestFlags = requestInspection.flags;
      if (requestFlags.length) {
        fusedTags["flagged_policy"] = requestFlags.map((flag) => flag.policyName).join(",");
      }

      let promptInjected = false;
      let retrievalDocs: string | null = null;
      {
        const headerDocs = h("x-torrix-retrieval-docs");
        if (headerDocs) {
          const parsed = parseJson(headerDocs);
          if (Array.isArray(parsed)) {
            retrievalDocs = JSON.stringify(parsed.slice(0, 50));
          }
        }
        if (parsedBody) {
          const bodyDocs = (parsedBody as Record<string, unknown>).retrieval_docs;
          if (!retrievalDocs && Array.isArray(bodyDocs)) {
            retrievalDocs = JSON.stringify(bodyDocs.slice(0, 50));
          }
          if ("retrieval_docs" in parsedBody) {
            delete (parsedBody as Record<string, unknown>).retrieval_docs;
            bodyText = JSON.stringify(parsedBody);
            promptInjected = true;
          }
        }
      }
      let mediaAssets: string | null = null;
      let mediaCount = 0;
      {
        const media = parsedBody ? extractMedia(parsedBody, provider) : [];
        if (media.length) {
          mediaCount = media.length;
          try {
            mediaAssets = JSON.stringify(await persistMedia(config.mediaDir, media));
          } catch {
            mediaAssets = null;
          }
        }
      }
      const promptRefRaw = h("x-torrix-prompt") ?? (parsedBody && typeof parsedBody.prompt === "string" ? (parsedBody.prompt as string) : null);
      if (promptRefRaw) {
        const ref = parsePromptRef(promptRefRaw);
        if (!ref) {
          return reply.code(400).send({ error: "prompt_ref_invalid", detail: promptRefRaw });
        }
        const prompt = await repos.prompts.getByName(projectId, ref.name);
        if (!prompt) {
          return reply.code(400).send({ error: "prompt_not_found", detail: ref.name });
        }
        const revision = ref.revision ?? prompt.active_revision ?? prompt.latest_revision;
        const version = await repos.prompts.getVersion(prompt.id, revision);
        if (!version) {
          return reply.code(400).send({ error: "prompt_revision_not_found", detail: `${ref.name}:${revision}` });
        }
        const messages = Array.isArray(parsedBody?.messages) ? (parsedBody!.messages as Array<Record<string, unknown>>) : null;
        if (!messages) {
          return reply.code(400).send({ error: "prompt_injection_unsupported" });
        }
        const varsHeader = h("x-torrix-prompt-vars");
        let vars: Record<string, string> = {};
        if (varsHeader) {
          try {
            const parsedVars = JSON.parse(varsHeader) as unknown;
            if (parsedVars && typeof parsedVars === "object" && !Array.isArray(parsedVars)) {
              vars = parsedVars as Record<string, string>;
            }
          } catch {
            // malformed vars header is ignored; variables stay unfilled
          }
        }
        if (parsedBody && parsedBody.prompt_vars && typeof parsedBody.prompt_vars === "object") {
          vars = { ...vars, ...(parsedBody.prompt_vars as Record<string, string>) };
        }
        const rendered = renderTemplate(version.template, vars);
        fusedTags["torrix_prompt"] = prompt.name;
        fusedTags["torrix_prompt_revision"] = String(revision);
        const systemMsg = { role: "system", content: rendered };
        const systemIdx = messages.findIndex((m) => m.role === "system");
        if (systemIdx >= 0) {
          messages[systemIdx] = { ...messages[systemIdx], content: rendered };
        } else {
          messages.unshift(systemMsg);
        }
        if (parsedBody && typeof parsedBody.prompt === "string") {
          delete parsedBody.prompt;
        }
        if (parsedBody) {
          delete (parsedBody as Record<string, unknown>).prompt_vars;
        }
        bodyText = JSON.stringify(parsedBody);
        promptInjected = true;
      }
      const structuredOutput = parsedBody ? detectStructuredOutput(parsedBody) : null;
      let modelFromBody = parsedBody?.model as string | undefined;

      let routedFrom: string | undefined;
      let fallbackCandidate: string | null = null;
      if (requestedModel && parsedBody) {
        const route = await deps.host.routeRequest({
          userId: user.id,
          projectId,
          sessionId,
          provider,
          model: requestedModel,
          maxTokens: typeof parsedBody.max_tokens === "number" ? parsedBody.max_tokens : null,
          bodyText,
          body: parsedBody,
          promptText: extractRoutePrompt(parsedBody),
        });
        if (route) {
          routedFrom = requestedModel;
          fallbackCandidate = route.fallbackModel;
          parsedBody.model = route.model;
          modelFromBody = route.model;
          bodyText = JSON.stringify(parsedBody);
          promptInjected = true;
          fusedTags["torrix_route"] = route.ruleName;
          if (route.targetUrl) {
            effectiveTarget = rewriteToRouteTarget(effectiveTarget, route.targetUrl);
            fusedTags["torrix_route_target"] = route.targetUrl;
          }
        }
      }

      const forwardHeaders = buildForwardHeaders(request.headers as Record<string, unknown>);
      if (config.localHost) {
        forwardHeaders.set("host", safeHost(effectiveTarget) ?? urlValidation.url.host);
      }

      let originalInputTokens: number | undefined;
      let originalRequestBody: string | undefined;
      if (compressionMode !== "off" && parsedBody) {
        const compressed = compressRequestBody(parsedBody, compressionMode, compressionWords);
        if (compressed.changed) {
          originalRequestBody = truncateChars(compressed.originalText, 4000);
          originalInputTokens = countTokens(compressed.originalText);
          parsedBody = compressed.body;
          bodyText = JSON.stringify(parsedBody);
          promptInjected = true;
        }
      }

      const requestBytes = promptInjected ? Buffer.byteLength(bodyText ?? "", "utf8") : rawBody?.length ?? 0;
      const requestBodyForLog = bodyText ? truncateChars(bodyText, 4000) : null;

      if (shouldLog) {
        const events = [
          ev(runId, "info", `${method} → ${effectiveTarget}`),
        ];
        if (requestBodyForLog !== null) {
          events.push(ev(runId, "request", requestBodyForLog));
        }
        await repos.events.addMany(events);
      }

      if (parsedBody && provider !== "anthropic" && provider !== "gemini" && method !== "GET" && method !== "HEAD") {
        const wantsStream = parsedBody.stream === true;
        if (wantsStream && !parsedBody.stream_options) {
          forwardHeaders.delete("content-length");
          // body re-serialized below; do it at fetch time
        }
      }

      let upstreamBody: BodyInit | undefined;
      let upstreamContentType: string | null = null;
      if (rawBody && !promptInjected) {
        upstreamBody = new Uint8Array(rawBody);
        upstreamContentType = String((request.headers["content-type"] ?? "application/json") as string);
      } else if (parsedBody) {
        const toSend = maybeInjectUsage(parsedBody, provider, method);
        upstreamBody = JSON.stringify(toSend);
        upstreamContentType = "application/json";
      }
      if (upstreamContentType) {
        forwardHeaders.set("content-type", upstreamContentType);
      }

      const fallbackModel = fallbackCandidate && fallbackCandidate !== modelFromBody ? fallbackCandidate : null;
      const buildFallbackBody = (): BodyInit | undefined => {
        if (!parsedBody || !fallbackModel) {
          return undefined;
        }
        parsedBody.model = fallbackModel;
        bodyText = JSON.stringify(parsedBody);
        forwardHeaders.set("content-type", "application/json");
        return JSON.stringify(maybeInjectUsage(parsedBody, provider, method));
      };

      let upstreamResponse: Response | null = null;
      let usedFallback = false;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const useFallback = attempt === 1;
        const attemptBody = useFallback ? buildFallbackBody() : upstreamBody;
        try {
          const init: RequestInit = {
            method,
            headers: forwardHeaders,
          };
          if (attemptBody !== undefined && method !== "GET" && method !== "HEAD") {
            init.body = attemptBody;
          }
          const res = await fetch(effectiveTarget, init);
          if (!useFallback && fallbackModel && parsedBody && (res.status === 404 || res.status === 429 || res.status >= 500)) {
            await res.body?.cancel().catch(() => undefined);
            continue;
          }
          upstreamResponse = res;
          usedFallback = useFallback;
          if (useFallback) {
            modelFromBody = fallbackModel ?? modelFromBody;
            fusedTags["torrix_fallback"] = fallbackModel ?? "";
          }
          break;
        } catch (err) {
          lastError = err as Error;
          if (fallbackModel && parsedBody) {
            continue;
          }
          break;
        }
      }

      if (!upstreamResponse) {
        const message = lastError?.message ?? "upstream unavailable";
        await saveErrorRun(deps, {
          runId,
          user: user.id,
          projectId,
          provider,
          model: modelFromBody,
          targetUrl: effectiveTarget,
          requestBodyForLog,
          start,
          grouping,
          source,
          error: message,
          mediaCount,
          mediaAssets,
        });
        await evaluateRunCost(
          deps,
          { userId: user.id, projectId, apiKeyId: keyRecord?.id ?? null },
          0,
          { runId, model: modelFromBody ?? null, status: 502, error: message },
        );
        return reply.code(502).send({ error: "upstream_error", detail: message });
      }

      const status = upstreamResponse.status;
      const contentType = upstreamResponse.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream") && upstreamResponse.body) {
        // streaming path: sampled-out successes pass through, errors are always logged
        if (!shouldLog && status < 400) {
          reply.code(status).header("content-type", contentType);
          if (routedFrom) {
            reply.header("x-torrix-routed-from", routedFrom);
          }
          return reply.send(upstreamResponse.body as ReadableStream);
        }
        return handleStreaming(deps, {
          request,
          reply,
          upstreamResponse,
          status,
          contentType,
          start,
          runId,
          user: user.id,
          projectId,
          provider,
          source,
          modelFromBody,
          traceId,
          sessionId,
          parentRunId,
          agentName,
          agentId,
          endUserId,
          runName,
          tags: fusedTags,
          targetUrl: effectiveTarget,
          requestBodyForLog,
          structuredOutput,
          keyRecordId: keyRecord?.id ?? null,
          routedFrom,
          fallbackUsed: usedFallback,
          requestFlags,
          mediaCount,
          mediaAssets,
          originalInputTokens,
          originalRequestBody,
        });
      }

      const resText = await upstreamResponse.text();
      const latency = Date.now() - start;
      const plain = parsedBody;
      const isClientError = status >= 400;

      const extracted = extractForResponse(effectiveTarget, provider, plain, resText, contentType);

      const responseBytes = Buffer.byteLength(resText, "utf8");
      const cost = calculateCost(extracted.model ?? modelFromBody ?? "unknown", extracted.inputTokens, extracted.outputTokens, {
        read: extracted.cacheReadTokens,
        write: extracted.cacheCreationTokens,
      });
      const finishReason = extracted.finishReason;
      const summary = buildSummary({ status, latency, model: extracted.model ?? modelFromBody, tokens: (extracted.inputTokens ?? 0) + (extracted.outputTokens ?? 0), cost, finishReason, requestBytes, responseBytes });

      const runData: RunData = {
        id: runId,
        user_id: user.id,
        project_id: projectId,
        name: runName,
        model: extracted.model ?? modelFromBody ?? undefined,
        provider,
        input_tokens: extracted.inputTokens ?? undefined,
        output_tokens: extracted.outputTokens ?? undefined,
        thinking_tokens: extracted.thinkingText ? countTokens(extracted.thinkingText) : undefined,
        cache_read_tokens: extracted.cacheReadTokens ?? undefined,
        cache_creation_tokens: extracted.cacheCreationTokens ?? undefined,
        cost_usd: cost,
        latency_ms: latency,
        status,
        finish_reason: finishReason ?? undefined,
        source,
        request_body: requestBodyForLog ?? undefined,
        request_bytes: requestBytes,
        response_bytes: responseBytes,
        target_url: effectiveTarget,
        trace_id: traceId ?? undefined,
        session_id: sessionId ?? undefined,
        parent_run_id: parentRunId ?? undefined,
        agent_name: agentName ?? undefined,
        agent_id: agentId ?? undefined,
        end_user_id: endUserId ?? undefined,
        prompt_hash: bodyText ? (promptHash(bodyText) ?? undefined) : undefined,
        tags: Object.keys(fusedTags).length ? fusedTags : undefined,
        api_key_id: keyRecord?.id ?? undefined,
        structured_output: structuredOutput,
        json_parse_ok: extracted.responseText.startsWith("{") ? true : undefined,
        retrieval_docs: retrievalDocs ?? undefined,
        media_count: mediaCount || undefined,
        media_assets: mediaAssets ?? undefined,
        original_input_tokens: originalInputTokens,
        original_request_body: originalRequestBody,
        created_at: startedAt,
      };

      const costEval = await evaluateRunCost(
        deps,
        { userId: user.id, projectId, apiKeyId: keyRecord?.id ?? null },
        cost,
        {
          runId,
          model: runData.model ?? null,
          status,
          error: isClientError ? truncateChars(resText, 300) : null,
        },
      );
      runData.is_anomaly = costEval.isAnomaly;
      runData.routed_from = routedFrom;
      runData.fallback_used = usedFallback;

      const responseFlags = await deps.host.inspectResponse({
        userId: user.id,
        projectId,
        model: runData.model ?? null,
        responseText: extracted.responseText || null,
      });

      const tools = extractToolCalls(parseJson(resText) ?? {}, provider);
      const masked = applyMasking(govSettings, {
        request: runData.request_body ?? null,
        response: extracted.responseText ?? null,
        prompt: extracted.prompt ?? null,
        name: runData.name ?? null,
        thinking: extracted.thinkingText ?? null,
        toolCalls: tools.length ? JSON.stringify(tools) : null,
      });
      const finalRun = runData;
      if (masked.masked) {
        finalRun.request_body = masked.request ?? undefined;
        finalRun.pii_masked = true;
        finalRun.pii_findings = JSON.stringify(masked.findings);
      }
      if (masked.name) {
        finalRun.name = masked.name;
      }
      if (responseFlags.length || requestFlags.length) {
        finalRun.policy_flags = JSON.stringify([...requestFlags, ...responseFlags]);
        if (
          responseFlags.length &&
          (await deps.host.queueReview({
            runId,
            userId: user.id,
            projectId,
            note: responseFlags.map((f) => f.detail).join("; ").slice(0, 500),
          }))
        ) {
          finalRun.review_state = "pending";
        }
      }

      const events: Events[] = [];
      if (masked.prompt) events.push(ev(runId, "prompt", masked.prompt));
      if (masked.response) events.push(ev(runId, "response", masked.response));
      if (masked.thinking) events.push(ev(runId, "thinking", masked.thinking));
      if (masked.toolCalls) events.push(ev(runId, "tool_call", masked.toolCalls));
      if (masked.masked) {
        events.push(
          ev(runId, "info", `PII masked: ${masked.findings.map((f) => `${f.type} x${f.count}`).join(", ")}`),
        );
      }
      for (const flag of responseFlags) {
        events.push(ev(runId, "info", `policy ${flag.action}: ${flag.policyName}, ${flag.detail}`));
      }
      if (isClientError) events.push(ev(runId, "error", `HTTP ${status}`));
      events.push(ev(runId, "summary", summary));

      // Sampled-out calls are forwarded but not stored; failures are always kept.
      if (shouldLog || status >= 400) {
        await persistRun(deps, finalRun, events);
      }

      if (contentType.includes("application/json")) {
        const parsed = parseJson(resText);
        reply.code(status).header("content-type", contentType).header("x-torrix-run-id", runId);
        if (routedFrom) {
          reply.header("x-torrix-routed-from", routedFrom);
        }
        return reply.send(parsed ?? resText);
      }
      reply.code(status).header("content-type", contentType).header("x-torrix-run-id", runId);
      if (routedFrom) {
        reply.header("x-torrix-routed-from", routedFrom);
      }
      return reply.send(resText);
  };
}

function headerReader(request: FastifyRequest) {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  return (name: string): string | null => {
    const v = headers[name.toLowerCase()];
    if (v === undefined) {
      return null;
    }
    return Array.isArray(v) ? v[0] : v;
  };
}

function parseTags(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const pair of header.split(",")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Helicone property headers become tags; `Helicone-Property-Name` is the run name instead. */
function heliconePropertyTags(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.startsWith("helicone-property-")) {
      continue;
    }
    const key = name.slice("helicone-property-".length).trim();
    const text = Array.isArray(value) ? value[0] : value;
    if (!key || key === "name" || !text) {
      continue;
    }
    out[key.slice(0, 64)] = text.slice(0, 200);
    if (Object.keys(out).length >= 50) {
      break;
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(1, Math.max(0, n));
}

function parseJson(text?: string | null): Record<string, unknown> | null {
  if (!text) {
    return null;
  }
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function buildForwardHeaders(headers: Record<string, unknown>): Headers {
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (BLOCKED_FORWARD_HEADERS.has(lower)) {
      continue;
    }
    if (lower.startsWith("x-torrix-") || lower.startsWith("helicone-")) {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        out.append(name, v);
      }
    } else {
      out.append(name, String(value));
    }
  }
  const upstream = String(headers["x-upstream-authorization"] ?? "");
  if (upstream && upstream !== "undefined") {
    out.set("authorization", upstream);
  }
  return out;
}

function rewriteLocalhost(target: string, replacement: string): string {
  return target.replace(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, `http://${replacement}`);
}

function rewriteToRouteTarget(originalUrl: string, routeTarget: string): string {
  try {
    const base = new URL(routeTarget);
    const original = new URL(originalUrl);
    base.pathname = original.pathname;
    base.search = original.search;
    return base.toString();
  } catch {
    return originalUrl;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function extractRoutePrompt(body: Record<string, unknown> | null | undefined): string | null {
  if (!body) {
    return null;
  }
  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  const parts: string[] = [];
  for (const message of messages) {
    const content = message?.content;
    if (typeof content === "string") {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          parts.push(String((part as { text: string }).text));
        }
      }
    }
  }
  return parts.length ? parts.join("\n") : null;
}

function maybeInjectUsage(body: Record<string, unknown>, provider: string, method: string): Record<string, unknown> {
  if (provider === "anthropic" || provider === "gemini") {
    return body;
  }
  if (method === "GET" || method === "HEAD") {
    return body;
  }
  if (body.stream === true && !body.stream_options) {
    return { ...body, stream_options: { include_usage: true } };
  }
  return body;
}

function extractForResponse(targetUrl: string, provider: string, reqBody: Record<string, unknown> | null | undefined, resText: string, contentType: string) {
  const parsed = parseJson(resText);
  const base = reqBody ?? {};
  if (parsed && contentType.includes("application/json")) {
    if (provider === "anthropic") {
      return extractAnthropic(base, parsed);
    }
    if (provider === "gemini") {
      return extractGemini(base, parsed);
    }
    return extractOpenAI(base, parsed);
  }
  return extractGeneric(base, parsed ?? resText);
}

function countTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length);
}

function truncateChars(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function buildSummary(o: {
  status: number;
  latency: number;
  model?: string | null;
  tokens: number;
  cost: number;
  finishReason: string | null;
  requestBytes: number;
  responseBytes: number;
}): string {
  const parts = [
    `HTTP ${o.status}`,
    `${o.latency}ms`,
    o.model ? `model: ${o.model}` : null,
    `${o.tokens} tokens`,
    `$${o.cost.toFixed(6)}`,
    o.finishReason ? `stop: ${o.finishReason}` : null,
    `\u2191${kb(o.requestBytes)}KB`,
    `\u2193${kb(o.responseBytes)}KB`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

async function persistRun(deps: ProxyDeps, runData: RunData, events: Events[], evaluate = true): Promise<void> {
  const run: Run = toRun(runData);
  await deps.repos.runs.save(run);
  if (events.length) {
    await deps.repos.events.addMany(events);
  }
  emitRun(run);
  if (evaluate) {
    deps.host.runRecorded(run);
  }
}

/**
 * Records a request that never reached the provider (policy block, guardrail
 * refusal). Keeping the attempt in its trace means the refusal shows up in
 * analytics, the trace tree, the review queue and the audit log.
 */
async function persistRefusedRun(
  deps: ProxyDeps,
  o: {
    runId: string;
    userId: string;
    projectId: string;
    provider: string;
    model: string | null;
    targetUrl: string;
    source: RunSource;
    grouping: RunGrouping;
    startedAt: string;
    status: number;
    error: string;
    review: boolean;
    flags: PolicyVerdict[];
    requestBodyForLog: string | null;
    piiMasked: boolean;
    piiFindings: string | null;
  },
): Promise<void> {
  const queued = o.review
    ? await deps.host.queueReview({
        runId: o.runId,
        userId: o.userId,
        projectId: o.projectId,
        note: o.error.slice(0, 500),
      })
    : false;
  const runData: RunData = {
    ...o.grouping,
    id: o.runId,
    user_id: o.userId,
    project_id: o.projectId,
    provider: o.provider,
    model: o.model ?? undefined,
    status: o.status,
    error: o.error,
    source: o.source,
    target_url: o.targetUrl,
    request_body: o.requestBodyForLog ?? undefined,
    policy_flags: o.flags.length ? JSON.stringify(o.flags) : undefined,
    review_state: queued ? "pending" : undefined,
    pii_masked: o.piiMasked,
    pii_findings: o.piiFindings ?? undefined,
    latency_ms: 0,
    created_at: o.startedAt,
  };
  const run: Run = toRun(runData);
  await deps.repos.runs.save(run);
  await deps.repos.events.addMany([
    ev(o.runId, "error", o.error),
    ev(o.runId, "summary", `refused before dispatch · model: ${o.model ?? "unknown"} · 0 tokens · $0.000000`),
  ]);
  emitRun(run);
}

async function saveErrorRun(
  deps: ProxyDeps,
  o: {
    runId: string;
    user: string;
    projectId: string;
    provider: string;
    model?: string;
    targetUrl: string;
    requestBodyForLog?: string | null;
    start: number;
    grouping: RunGrouping;
    source?: RunSource;
    error: string;
    mediaCount?: number;
    mediaAssets?: string | null;
  },
): Promise<void> {
  const govSettings = await deps.repos.governance.getSettings(o.user);
  const masked = applyMasking(govSettings, {
    request: o.requestBodyForLog ?? null,
    name: o.grouping.name ?? null,
  });
  const runData: RunData = {
    ...o.grouping,
    name: masked.name ?? o.grouping.name,
    id: o.runId,
    user_id: o.user,
    project_id: o.projectId,
    provider: o.provider,
    model: o.model,
    status: 502,
    source: o.source ?? "proxy",
    request_body: masked.request ?? undefined,
    target_url: o.targetUrl,
    error: o.error,
    pii_masked: masked.masked || undefined,
    pii_findings: masked.findings.length ? JSON.stringify(masked.findings) : undefined,
    media_count: o.mediaCount || undefined,
    media_assets: o.mediaAssets ?? undefined,
    latency_ms: Date.now() - o.start,
    created_at: new Date(o.start).toISOString(),
  };
  await persistRun(deps, runData, [ev(o.runId, "error", o.error)]);
}

interface StreamContext {
  request: FastifyRequest;
  reply: FastifyReply;
  upstreamResponse: Response;
  status: number;
  contentType: string;
  start: number;
  runId: string;
  user: string;
  projectId: string;
  provider: string;
  source: RunSource;
  modelFromBody?: string;
  traceId: string | null;
  sessionId: string | null;
  parentRunId: string | null;
  agentName: string | null;
  agentId: string | null;
  endUserId: string | null;
  runName: string;
  tags: Record<string, string>;
  targetUrl: string;
  requestBodyForLog: string | null;
  structuredOutput: string | null;
  keyRecordId: string | null;
  routedFrom?: string;
  fallbackUsed: boolean;
  requestFlags: PolicyVerdict[];
  mediaCount: number;
  mediaAssets: string | null;
  originalInputTokens?: number;
  originalRequestBody?: string;
}

async function handleStreaming(deps: ProxyDeps, ctx: StreamContext): Promise<FastifyReply> {
  const { reply, upstreamResponse, status, contentType } = ctx;
  const start = ctx.start;
  let firstByteAt = 0;
  let accumulated = "";
  const reader = upstreamResponse.body!.getReader();
  const decoder = new TextDecoder();

  const initialRun: RunData = {
    id: ctx.runId,
    user_id: ctx.user,
    project_id: ctx.projectId,
    name: ctx.runName,
    provider: ctx.provider,
    model: ctx.modelFromBody,
    source: ctx.source,
    target_url: ctx.targetUrl,
    trace_id: ctx.traceId ?? undefined,
    session_id: ctx.sessionId ?? undefined,
    parent_run_id: ctx.parentRunId ?? undefined,
    agent_name: ctx.agentName ?? undefined,
    agent_id: ctx.agentId ?? undefined,
    end_user_id: ctx.endUserId ?? undefined,
    tags: Object.keys(ctx.tags).length ? ctx.tags : undefined,
    api_key_id: ctx.keyRecordId ?? undefined,
    structured_output: ctx.structuredOutput,
    media_count: ctx.mediaCount || undefined,
    media_assets: ctx.mediaAssets ?? undefined,
    original_input_tokens: ctx.originalInputTokens,
    original_request_body: ctx.originalRequestBody,
    created_at: new Date(start).toISOString(),
  };
  await persistRun(deps, initialRun, [], false);

  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (firstByteAt === 0) {
          firstByteAt = Date.now();
        }
        accumulated += decoder.decode(value, { stream: true });
        controller.enqueue(value);
      }
      controller.close();
    } catch (err) {
      controller.error(err);
    } finally {
      void finalizeStreaming(deps, ctx, accumulated, firstByteAt, start);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pump(controller);
    },
    cancel() {
      void reader.cancel();
    },
  });

  reply.code(status).header("content-type", contentType).header("cache-control", "no-cache").header("connection", "keep-alive").header("x-torrix-run-id", ctx.runId);
  if (ctx.routedFrom) {
    reply.header("x-torrix-routed-from", ctx.routedFrom);
  }
  return reply.send(stream);
}

async function finalizeStreaming(
  deps: ProxyDeps,
  ctx: StreamContext,
  accumulated: string,
  firstByteAt: number,
  start: number,
): Promise<void> {
  try {
    // Duration of the whole stream; time to first byte is kept as an event.
    const latency = Date.now() - start;
    const ttfbMs = firstByteAt > 0 ? firstByteAt - start : null;
    const extracted = extractFromSSEChunks(accumulated);
    const model = extracted.model ?? ctx.modelFromBody ?? null;
    const inputTokens = extracted.inputTokens ?? null;
    const outputTokens = extracted.outputTokens ?? null;
    const cost = calculateCost(model ?? "unknown", inputTokens, outputTokens, {
      read: extracted.cacheReadTokens,
      write: extracted.cacheCreationTokens,
    });
    const status = ctx.status;

    const costEval = await evaluateRunCost(
      deps,
      { userId: ctx.user, projectId: ctx.projectId, apiKeyId: ctx.keyRecordId },
      cost,
      { runId: ctx.runId, model, status },
    );

    const responseText = extracted.responseText ?? "";
    const responseBytes = Buffer.byteLength(responseText, "utf8");
    const summary = buildSummary({
      status,
      latency,
      model,
      tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      cost,
      finishReason: extracted.finishReason ?? null,
      requestBytes: Buffer.byteLength(ctx.requestBodyForLog ?? "", "utf8"),
      responseBytes,
    });

    const govSettings = await deps.repos.governance.getSettings(ctx.user);
    const responseFlags = await deps.host.inspectResponse({
      userId: ctx.user,
      projectId: ctx.projectId,
      model,
      responseText: responseText || null,
    });
    const masked = applyMasking(govSettings, {
      request: ctx.requestBodyForLog,
      response: responseText || null,
      prompt: extracted.prompt ?? null,
      name: ctx.runName ?? null,
      thinking: extracted.thinkingText ?? null,
      toolCalls: extracted.toolCalls?.length ? JSON.stringify(extracted.toolCalls) : null,
    });
    const reviewPending =
      responseFlags.length > 0 &&
      (await deps.host.queueReview({
        runId: ctx.runId,
        userId: ctx.user,
        projectId: ctx.projectId,
        note: responseFlags.map((f) => f.detail).join("; ").slice(0, 500),
      }));

    await deps.repos.runs.update(ctx.runId, {
      model: model ?? undefined,
      input_tokens: inputTokens ?? undefined,
      output_tokens: outputTokens ?? undefined,
      thinking_tokens: extracted.thinkingText ? countTokens(extracted.thinkingText) : undefined,
      cache_read_tokens: extracted.cacheReadTokens ?? undefined,
      cache_creation_tokens: extracted.cacheCreationTokens ?? undefined,
      cost_usd: cost,
      latency_ms: latency,
      status,
      finish_reason: extracted.finishReason ?? undefined,
      response_bytes: responseBytes,
      is_anomaly: costEval.isAnomaly ? 1 : 0,
      routed_from: ctx.routedFrom,
      fallback_used: ctx.fallbackUsed ? 1 : 0,
      name: masked.name ?? ctx.runName,
      request_body: masked.request ?? undefined,
      pii_masked: masked.masked ? 1 : 0,
      pii_findings: masked.findings.length ? JSON.stringify(masked.findings) : undefined,
      policy_flags:
        responseFlags.length || ctx.requestFlags.length
          ? JSON.stringify([...ctx.requestFlags, ...responseFlags])
          : undefined,
      review_state: reviewPending ? "pending" : undefined,
    }, ctx.user);

    const events: Events[] = [];
    if (masked.prompt) events.push(ev(ctx.runId, "prompt", masked.prompt));
    if (masked.response) events.push(ev(ctx.runId, "response", masked.response));
    if (masked.thinking) events.push(ev(ctx.runId, "thinking", masked.thinking));
    if (masked.toolCalls) events.push(ev(ctx.runId, "tool_call", masked.toolCalls));
    if (masked.masked) {
      events.push(ev(ctx.runId, "info", `PII masked: ${masked.findings.map((f) => `${f.type} x${f.count}`).join(", ")}`));
    }
    for (const flag of responseFlags) {
      events.push(ev(ctx.runId, "info", `policy ${flag.action}: ${flag.policyName}, ${flag.detail}`));
    }
    if (ttfbMs !== null) events.push(ev(ctx.runId, "info", `time to first byte ${ttfbMs} ms`));
    if (status >= 400) events.push(ev(ctx.runId, "error", `HTTP ${status}`));
    events.push(ev(ctx.runId, "summary", summary));
    await deps.repos.events.addMany(events);

    const run = await deps.repos.runs.getById(ctx.runId, ctx.user);
    if (run) {
      emitRun(run);
      deps.host.runRecorded(run);
    }
  } catch (err) {
    console.error("finalizeStreaming failed", err);
  }
}