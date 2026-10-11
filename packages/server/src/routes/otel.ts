import * as zlib from "node:zlib";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import type { Repositories } from "../repos";
import { authenticateKey, extractBearer } from "../lib/auth";
import { buildRunRow, makeEvent } from "../lib/runMapper";
import { parseOtlJson, resolveParentRunIds, spanToRunDraft } from "../lib/otel";
import { calculateCost } from "../lib/pricing";
import { checkHardCap } from "../lib/costGate";
import { applyMasking } from "../lib/masking";
import { emitRun } from "../lib/events";
import type { Events } from "../core/domain";

export interface OtelDeps {
  repos: Repositories;
  config: ServerConfig;
  host?: ExtensionHost;
}

const MAX_SPANS_PER_REQUEST = 2000;
const TRUNCATE = 4000;

/**
 * OTLP/HTTP receiver at POST /v1/traces. Accepts the JSON encoding of
 * `ExportTraceServiceRequest` (OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json),
 * including gzip-encoded bodies, and converts GenAI spans into Torrix runs so
 * an already-instrumented application needs no code change.
 */
export async function otelRoute(app: FastifyInstance, deps: OtelDeps): Promise<void> {
  const { repos } = deps;

  app.post("/v1/traces", async (request: FastifyRequest, reply: FastifyReply) => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const contentType = String((request.headers as Record<string, unknown>)["content-type"] ?? "");
    if (contentType.includes("x-protobuf")) {
      return reply.code(415).send({
        error: "unsupported_encoding",
        detail: "Torrix reads OTLP/JSON. Set OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json on your SDK.",
      });
    }

    const body = decodeBody(request);
    if (body == null) {
      return reply.code(400).send({ error: "unreadable_body" });
    }

    const { spans } = parseOtlJson(body);
    if (!spans.length) {
      return reply.send({ partialSuccess: {} });
    }
    const capped = spans.slice(0, MAX_SPANS_PER_REQUEST);

    const project = await repos.projects.findDefault(auth.user.id);
    if (!project) {
      return reply.code(400).send({ error: "no_project" });
    }

    const capGate = await checkHardCap(deps, { userId: auth.user.id, projectId: project.id, apiKeyId: auth.keyRecord?.id ?? null });
    if (capGate.blocked) {
      return reply.code(429).send({ error: "hard_cap_reached", monthly_spend: capGate.spend, cap: capGate.cap });
    }

    let accepted = 0;
    const govSettings = await repos.governance.getSettings(auth.user.id);
    const parentRuns = resolveParentRunIds(capped);
    const headerProject = String((request.headers as Record<string, unknown>)["x-torrix-project-id"] ?? "").trim();
    const accessible = await repos.projects.listAccessible(auth.user.id);
    const projectIds = new Set(accessible.map((entry) => entry.project.id));
    const projectByName = new Map(accessible.map((entry) => [entry.project.name, entry.project.id]));
    for (const span of capped) {
      const attrProject = typeof span.attributes["torrix.project_id"] === "string" ? String(span.attributes["torrix.project_id"]).trim() : "";
      const requestedProject = attrProject || headerProject;
      const spanProjectId = requestedProject
        ? projectIds.has(requestedProject)
          ? requestedProject
          : projectByName.get(requestedProject) ?? project.id
        : project.id;
      const draft = spanToRunDraft(span, auth.user.id, spanProjectId);
      const run = draft.run;
      run.parent_run_id = parentRuns.get(span.spanId) ?? undefined;
      run.cost_usd = calculateCost(run.model ?? "unknown", run.input_tokens ?? null, run.output_tokens ?? null, {
        read: run.cache_read_tokens,
        write: run.cache_creation_tokens,
      });

      const masked = applyMasking(govSettings, {
        prompt: draft.prompt,
        response: draft.response,
        thinking: draft.thinking,
        toolCalls: draft.toolCalls,
      });
      if (masked.masked) {
        run.pii_masked = true;
        run.pii_findings = JSON.stringify(masked.findings);
      }

      const events: Events[] = [makeEvent(run.id, "info", `otel · span ${span.spanId}`)];
      if (masked.prompt) {
        events.push(makeEvent(run.id, "request", truncate(masked.prompt)));
        events.push(makeEvent(run.id, "prompt", truncate(masked.prompt)));
      }
      if (masked.response) {
        events.push(makeEvent(run.id, "response", truncate(masked.response)));
      }
      if (masked.thinking) {
        events.push(makeEvent(run.id, "thinking", truncate(masked.thinking)));
      }
      if (masked.toolCalls) {
        events.push(makeEvent(run.id, "tool_call", truncate(masked.toolCalls)));
      }
      if (masked.masked) {
        events.push(makeEvent(run.id, "info", `PII masked: ${masked.findings.map((f) => `${f.type} x${f.count}`).join(", ")}`));
      }
      if (run.error) {
        events.push(makeEvent(run.id, "error", run.error));
      }

      const savedRun = buildRunRow(run);
      await repos.runs.save(savedRun);
      await repos.events.addMany(events);
      emitRun(savedRun);
      deps.host?.runRecorded(savedRun);
      accepted += 1;
    }

    const rejected = Math.max(0, spans.length - capped.length);
    return reply.send(rejected ? { partialSuccess: { rejectedSpans: rejected, errorMessage: "span cap reached" } } : { partialSuccess: {} });
  });
}

function decodeBody(request: FastifyRequest): unknown {
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const encoding = String((request.headers as Record<string, unknown>)["content-encoding"] ?? "").toLowerCase();
  let text: string;
  try {
    if (raw && encoding.includes("gzip")) {
      text = zlib.gunzipSync(raw).toString("utf8");
    } else if (raw) {
      text = raw.toString("utf8");
    } else {
      return request.body;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncate(text: string): string {
  return text.length > TRUNCATE ? `${text.slice(0, TRUNCATE)}…` : text;
}