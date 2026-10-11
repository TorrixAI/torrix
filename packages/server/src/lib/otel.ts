import type { RunData } from "../core/domain";

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, unknown>;
  events: OtelSpanEvent[];
  status?: { code?: number; message?: string };
  kind?: number;
}

export interface OtelSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: Record<string, unknown>;
}

export interface OtlPayload {
  resourceSpans?: Array<{
    resource?: { attributes?: Record<string, unknown> };
    scopeSpans?: Array<{
      scope?: { name?: string; version?: string };
      spans?: unknown[];
    }>;
    /** some exporters flatten spans directly onto resourceSpans */
    spans?: unknown[];
  }>;
}

export interface OtlConversion {
  spans: OtelSpan[];
  resource: Record<string, unknown>;
  scope: string | null;
}

export function parseOtlJson(body: unknown): OtlConversion {
  const payload = (body ?? {}) as OtlPayload;
  const spans: OtelSpan[] = [];
  let resource: Record<string, unknown> = {};
  let scope: string | null = null;

  for (const rs of payload.resourceSpans ?? []) {
    resource = rs.resource?.attributes ?? {};
    for (const ss of rs.scopeSpans ?? []) {
      scope = ss.scope?.name ?? scope;
      for (const raw of ss.spans ?? []) {
        const span = normalizeSpan(raw);
        if (span) {
          spans.push(span);
        }
      }
    }
    for (const raw of rs.spans ?? []) {
      const span = normalizeSpan(raw);
      if (span) {
        spans.push(span);
      }
    }
  }
  return { spans, resource, scope };
}

function normalizeSpan(raw: unknown): OtelSpan | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const traceId = toHexString(r.traceId);
  const spanId = toHexString(r.spanId);
  if (!traceId || !spanId) {
    return null;
  }
  const attributes = normalizeAttributes(r.attributes);
  const events: OtelSpanEvent[] = Array.isArray(r.events)
    ? r.events
        .map((e) => {
          const ev = (e ?? {}) as Record<string, unknown>;
          return {
            timeUnixNano: String(ev.timeUnixNano ?? "0"),
            name: String(ev.name ?? ""),
            attributes: normalizeAttributes(ev.attributes),
          };
        })
        .filter((e) => e.name)
    : [];
  const status = (r.status ?? {}) as Record<string, unknown>;
  return {
    traceId,
    spanId,
    parentSpanId: toHexString(r.parentSpanId) || null,
    name: String(r.name ?? "otel span"),
    startTimeUnixNano: String(r.startTimeUnixNano ?? "0"),
    endTimeUnixNano: String(r.endTimeUnixNano ?? "0"),
    attributes,
    events,
    status: { code: Number(status.code ?? 0), message: typeof status.message === "string" ? status.message : undefined },
    kind: Number(r.kind ?? 0),
  };
}

function normalizeAttributes(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(raw)) {
    return out;
  }
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const kv = item as Record<string, unknown>;
    const key = typeof kv.key === "string" ? kv.key : null;
    if (!key) {
      continue;
    }
    out[key] = unwrapValue(kv.value);
  }
  return out;
}

function unwrapValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value ?? null;
  }
  const v = value as Record<string, unknown>;
  if ("stringValue" in v) {
    return v.stringValue;
  }
  if ("intValue" in v) {
    const n = v.intValue;
    return typeof n === "string" ? Number(n) : Number(n);
  }
  if ("doubleValue" in v) {
    return Number(v.doubleValue);
  }
  if ("boolValue" in v) {
    return Boolean(v.boolValue);
  }
  if ("arrayValue" in v) {
    const arr = (v.arrayValue as Record<string, unknown>)?.values;
    return Array.isArray(arr) ? arr.map(unwrapValue) : [];
  }
  if ("kvlistValue" in v) {
    return normalizeAttributes((v.kvlistValue as Record<string, unknown>)?.values);
  }
  return null;
}

function toHexString(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  return value.toLowerCase();
}

const SPAN_KIND_SERVER = 2;

export interface OtelRunDraft {
  run: RunData;
  prompt: string | null;
  response: string | null;
  thinking: string | null;
  toolCalls: string | null;
}

/**
 * Maps an OTel GenAI span onto a Torrix run. Attribute names follow the
 * OpenTelemetry GenAI semantic conventions; legacy spellings are accepted too
 * because SDK adoption is uneven.
 */
export function spanToRunDraft(span: OtelSpan, userId: string, projectId: string): OtelRunDraft {
  const attrs = span.attributes;
  const model =
    pickString(attrs, ["gen_ai.request.model", "llm.request.model", "gen_ai.response.model", "model"]) ?? null;
  const provider =
    pickString(attrs, ["gen_ai.system", "gen_ai.provider.name", "llm.system", "llm.vendor"]) ?? "otel";
  const inputTokens =
    pickNumber(attrs, ["gen_ai.usage.input_tokens", "llm.usage.prompt_tokens", "gen_ai.usage.prompt_tokens"]) ?? null;
  const outputTokens =
    pickNumber(attrs, ["gen_ai.usage.output_tokens", "llm.usage.completion_tokens", "gen_ai.usage.completion_tokens"]) ?? null;
  const cacheReadTokens =
    pickNumber(attrs, [
      "gen_ai.usage.cache_read.input_tokens",
      "gen_ai.usage.cache_read_input_tokens",
      "gen_ai.usage.cached_tokens",
      "gen_ai.usage.cache_read_tokens",
      "llm.usage.cache_read_tokens",
      "llm.usage.cached_tokens",
      "cache_read_input_tokens",
    ]) ?? null;
  const cacheCreationTokens =
    pickNumber(attrs, [
      "gen_ai.usage.cache_creation.input_tokens",
      "gen_ai.usage.cache_creation_input_tokens",
      "gen_ai.usage.cache_creation_tokens",
      "llm.usage.cache_creation_tokens",
      "cache_creation_input_tokens",
    ]) ?? null;

  const durationMs = nanoSpanToMs(span.startTimeUnixNano, span.endTimeUnixNano);
  const errored = span.status?.code === 2 || Boolean(attrs["error.type"]) || Boolean(span.status?.message);
  const sessionId =
    pickString(attrs, ["session.id", "gen_ai.conversation.id", "llm.conversation_id", "thread.id"]) ?? span.traceId;

  let prompt = pickString(attrs, ["gen_ai.prompt", "gen_ai.content.prompt", "llm.prompt", "input.value"]);
  let response = pickString(attrs, ["gen_ai.completion", "gen_ai.content.completion", "llm.completion", "output.value"]);
  let thinking = pickString(attrs, ["gen_ai.thinking", "gen_ai.content.reasoning"]);
  let toolCalls = pickString(attrs, ["gen_ai.tool_calls", "gen_ai.content.tool_calls"]);

  for (const event of span.events) {
    const value = eventValue(event);
    if (!value) {
      continue;
    }
    const n = event.name.toLowerCase();
    if (!prompt && (n.includes("prompt") || n.includes("input") || n.includes("request"))) {
      prompt = value;
    } else if (!response && (n.includes("completion") || n.includes("output") || n.includes("response"))) {
      response = value;
    } else if (!thinking && (n.includes("think") || n.includes("reasoning"))) {
      thinking = value;
    } else if (!toolCalls && n.includes("tool")) {
      toolCalls = value;
    }
  }

  const startIso = nanoToIso(span.startTimeUnixNano);

  return {
    run: {
      id: `otel-${span.spanId}`,
      user_id: userId,
      project_id: projectId,
      name: span.name,
      provider,
      model: model ?? undefined,
      input_tokens: inputTokens ?? undefined,
      output_tokens: outputTokens ?? undefined,
      cache_read_tokens: cacheReadTokens ?? undefined,
      cache_creation_tokens: cacheCreationTokens ?? undefined,
      cost_usd: 0,
      latency_ms: durationMs,
      status: errored ? 500 : 200,
      finish_reason: pickString(attrs, ["gen_ai.response.finish_reasons", "gen_ai.finish_reason"]) ?? undefined,
      source: "otel",
      trace_id: span.traceId,
      session_id: sessionId,
      parent_run_id: span.parentSpanId ? `otel-${span.parentSpanId}` : undefined,
      agent_name:
        pickString(attrs, [
          "gen_ai.agent.name",
          "gen_ai.conversation.agent",
          "peer.service",
          "service.name",
          "gen_ai.operation.name",
        ]) ?? undefined,
      end_user_id: pickString(attrs, ["gen_ai.end_user.id", "enduser.id"]) ?? undefined,
      prompt_hash: undefined,
      error: span.status?.message ?? (errored ? String(attrs["error.type"] ?? "span error") : undefined),
      created_at: startIso,
    },
    prompt,
    response,
    thinking,
    toolCalls,
  };
}

function eventValue(event: OtelSpanEvent): string | null {
  const direct = pickString(event.attributes, ["gen_ai.content", "value", "content", "body"]);
  if (direct) {
    return direct;
  }
  const body = event.attributes["gen_ai.prompt"] ?? event.attributes["gen_ai.completion"];
  return typeof body === "string" ? body : null;
}

function pickString(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return null;
}

function pickNumber(attrs: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = attrs[key];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return null;
}

function nanoSpanToMs(startNano: string, endNano: string): number {
  const start = Number(startNano);
  const end = Number(endNano);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.max(0, Math.round((end - start) / 1_000_000));
}

function nanoToIso(nano: string): string {
  const n = Number(nano);
  if (!Number.isFinite(n) || n <= 0) {
    return new Date().toISOString();
  }
  return new Date(Math.round(n / 1_000_000)).toISOString();
}

export function isServerSpan(span: OtelSpan): boolean {
  return span.kind === SPAN_KIND_SERVER;
}

/**
 * Resolves each span's parent to the parent run id when the parent span is
 * part of the same trace in this payload. Cross-trace parents are dropped
 * rather than linked, and ancestors missing from the payload keep their
 * deterministic `otel-<spanId>` reference so late batches still stitch.
 */
export function resolveParentRunIds(spans: OtelSpan[]): Map<string, string> {
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const resolved = new Map<string, string>();
  for (const span of spans) {
    if (!span.parentSpanId) {
      continue;
    }
    const parent = byId.get(span.parentSpanId);
    if (parent && parent.traceId === span.traceId) {
      resolved.set(span.spanId, `otel-${parent.spanId}`);
    } else if (!parent) {
      resolved.set(span.spanId, `otel-${span.parentSpanId}`);
    }
  }
  return resolved;
}