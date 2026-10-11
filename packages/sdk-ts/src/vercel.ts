import type { TorrixClient } from "./client.js";
import { currentContext } from "./context.js";
import type { TorrixRecord } from "./types.js";

export interface TorrixMiddlewareOptions {
  client: TorrixClient;
  name?: string;
  tags?: Record<string, string>;
  agentName?: string;
}

interface MiddlewareParams {
  prompt?: unknown;
  [key: string]: unknown;
}

interface MiddlewareModel {
  modelId?: string;
  provider?: string;
  [key: string]: unknown;
}

interface GenerateArgs {
  doGenerate: () => Promise<GenerateResult>;
  params: MiddlewareParams;
  model: MiddlewareModel;
}

interface StreamArgs {
  doStream: () => Promise<{ stream: ReadableStream<StreamChunk>; [key: string]: unknown }>;
  params: MiddlewareParams;
  model: MiddlewareModel;
}

interface GenerateResult {
  text?: string;
  content?: unknown;
  usage?: StreamUsage;
  finishReason?: string;
  response?: { id?: string; modelId?: string };
  [key: string]: unknown;
}

interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  [key: string]: unknown;
}

interface StreamChunk {
  type?: string;
  delta?: string;
  textDelta?: string;
  reasoning?: string;
  text?: string;
  usage?: StreamUsage;
  finishReason?: string;
  toolCallId?: string;
  toolName?: string;
  input?: string;
  args?: string;
  [key: string]: unknown;
}

/**
 * Middleware for the Vercel AI SDK, structurally compatible with
 * `wrapLanguageModel({ model, middleware: torrixMiddleware({ client }) })`.
 */
export function torrixMiddleware(options: TorrixMiddlewareOptions): {
  wrapGenerate: (args: GenerateArgs) => Promise<GenerateResult>;
  wrapStream: (args: StreamArgs) => Promise<{ stream: ReadableStream<StreamChunk>; [key: string]: unknown }>;
} {
  return {
    async wrapGenerate({ doGenerate, params, model }) {
      const startedAt = Date.now();
      try {
        const result = await doGenerate();
        const record = baseRecord(options, params, model, startedAt);
        record.status = 200;
        record.response = { body: result };
        if (result?.response?.id) record.id = result.response.id;
        applyUsage(record, result?.usage);
        if (result?.finishReason) record.finish_reason = result.finishReason;
        void options.client.ingest(record).catch(() => {});
        return result;
      } catch (error) {
        const record = baseRecord(options, params, model, startedAt);
        record.status = errorStatus(error);
        record.error = errorMessage(error);
        void options.client.ingest(record).catch(() => {});
        throw error;
      }
    },

    async wrapStream({ doStream, params, model }) {
      const startedAt = Date.now();
      let result: { stream: ReadableStream<StreamChunk>; [key: string]: unknown };
      try {
        result = await doStream();
      } catch (error) {
        const record = baseRecord(options, params, model, startedAt);
        record.status = errorStatus(error);
        record.error = errorMessage(error);
        void options.client.ingest(record).catch(() => {});
        throw error;
      }
      const state = { text: "", reasoning: "", usage: undefined as StreamUsage | undefined, finishReason: undefined as string | undefined, id: undefined as string | undefined };
      const stream = result.stream.pipeThrough(
        new TransformStream<StreamChunk, StreamChunk>({
          transform(chunk, controller) {
            if (chunk?.type === "text-delta") state.text += chunk.delta ?? chunk.textDelta ?? "";
            else if (chunk?.type === "reasoning-delta") state.reasoning += chunk.delta ?? chunk.reasoning ?? "";
            else if (chunk?.type === "finish") {
              state.usage = chunk.usage ?? state.usage;
              state.finishReason = chunk.finishReason ?? state.finishReason;
            } else if (chunk?.type === "response-metadata" && typeof chunk.id === "string") {
              state.id = chunk.id;
            }
            controller.enqueue(chunk);
          },
          flush: () => {
            const record = baseRecord(options, params, model, startedAt);
            if (state.id) record.id = state.id;
            record.status = 200;
            record.response = {
              body: {
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: state.text,
                      ...(state.reasoning ? { reasoning_content: state.reasoning } : {}),
                    },
                    finish_reason: state.finishReason ?? "stop",
                  },
                ],
                usage: state.usage,
              },
            };
            applyUsage(record, state.usage);
            if (state.finishReason) record.finish_reason = state.finishReason;
            void options.client.ingest(record).catch(() => {});
          },
        }),
      );
      return { ...result, stream };
    },
  };
}

function baseRecord(options: TorrixMiddlewareOptions, params: MiddlewareParams, model: MiddlewareModel, startedAt: number): TorrixRecord {
  const record: TorrixRecord = {
    provider: providerOf(model),
    model: model?.modelId,
    start_time: new Date(startedAt).toISOString(),
    latency_ms: Date.now() - startedAt,
    end_time: new Date().toISOString(),
    request: { body: { model: model?.modelId, messages: params?.prompt } },
  };
  if (options.name) record.name = options.name;
  if (options.tags) record.tags = { ...options.tags };
  if (options.agentName) record.agent_name = options.agentName;
  const context = currentContext();
  if (context) {
    record.trace_id = context.trace_id;
    if (context.session_id) record.session_id = context.session_id;
    if (!record.agent_name && context.agent_name) record.agent_name = context.agent_name;
    const parent = context.last_run_id ?? context.parent_run_id;
    if (parent) record.parent_run_id = parent;
    if (context.name && !record.name) record.name = context.name;
  }
  return record;
}

function applyUsage(record: TorrixRecord, usage: StreamUsage | undefined): void {
  if (!usage || typeof usage !== "object") return;
  if (typeof usage.inputTokens === "number") record.input_tokens = usage.inputTokens;
  if (typeof usage.outputTokens === "number") record.output_tokens = usage.outputTokens;
  if (typeof usage.reasoningTokens === "number") record.thinking_tokens = usage.reasoningTokens;
  if (typeof usage.cachedInputTokens === "number") record.cache_read_tokens = usage.cachedInputTokens;
}

function providerOf(model: MiddlewareModel): string {
  const provider = typeof model?.provider === "string" ? model.provider : "";
  return provider.split(".")[0] || "ai-sdk";
}

function errorStatus(error: unknown): number {
  const value = error as { status?: unknown; statusCode?: unknown } | null;
  if (typeof value?.status === "number") return value.status;
  if (typeof value?.statusCode === "number") return value.statusCode;
  return 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}
