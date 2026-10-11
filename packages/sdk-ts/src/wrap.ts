import type { TorrixClient } from "./client.js";
import { TorrixError } from "./client.js";
import type { TorrixRecord } from "./types.js";

export interface WrapOptions {
  client: TorrixClient;
  provider?: "openai" | "anthropic";
  name?: string;
  tags?: Record<string, string>;
  agentName?: string;
}

export interface AutoInstrumentOptions {
  client: TorrixClient;
  openai?: boolean;
  anthropic?: boolean;
}

interface RecordBase {
  provider: string;
  name?: string;
  agent_name?: string;
  tags?: Record<string, string>;
  start_time: string;
}

const patches = new WeakMap<object, Array<() => void>>();
const wrappedObjects = new Set<object>();

export function wrap(target: unknown, options: WrapOptions): unknown {
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    throw new TorrixError("torrix.wrap() expects an SDK client instance");
  }
  const object = target as object;
  if (patches.has(object)) return target;
  const provider = options.provider ?? detectProvider(target);
  const restores: Array<() => void> = [];
  if (provider === "openai") restores.push(patchOpenAIInstance(object, options));
  else restores.push(patchAnthropicInstance(object, options));
  patches.set(object, restores);
  wrappedObjects.add(object);
  return target;
}

export function unwrap(target?: unknown): void {
  if (target !== undefined) {
    restore(target as object);
    return;
  }
  for (const object of [...wrappedObjects]) restore(object);
}

export async function autoInstrument(options: AutoInstrumentOptions): Promise<{ openai: boolean; anthropic: boolean }> {
  return {
    openai: options.openai === false ? false : await patchPrototype("openai", options),
    anthropic: options.anthropic === false ? false : await patchPrototype("anthropic", options),
  };
}

export function detectProvider(target: unknown): "openai" | "anthropic" {
  const value = target as { chat?: { completions?: { create?: unknown } }; messages?: { create?: unknown } } | null;
  if (value?.chat?.completions?.create) return "openai";
  if (value?.messages?.create) return "anthropic";
  throw new TorrixError('torrix.wrap() could not detect the client shape; pass { provider: "openai" | "anthropic" }');
}

function restore(object: object): void {
  const restores = patches.get(object);
  if (!restores) return;
  for (const fn of restores) fn();
  patches.delete(object);
  wrappedObjects.delete(object);
}

function patchOpenAIInstance(target: object, options: WrapOptions): () => void {
  const completions = (target as { chat?: { completions?: { create?: (...args: unknown[]) => unknown } } }).chat?.completions;
  if (!completions || typeof completions.create !== "function") {
    throw new TorrixError("torrix.wrap(): client.chat.completions.create was not found");
  }
  const original = completions.create;
  completions.create = function (this: unknown, params?: unknown, requestOptions?: unknown) {
    return wrappedOpenAICreate((p, o) => original.call(this, p, o) as Promise<unknown>, params, requestOptions, options);
  };
  return () => {
    completions.create = original;
  };
}

function patchAnthropicInstance(target: object, options: WrapOptions): () => void {
  const messages = (target as { messages?: { create?: (...args: unknown[]) => unknown } }).messages;
  if (!messages || typeof messages.create !== "function") {
    throw new TorrixError("torrix.wrap(): client.messages.create was not found");
  }
  const original = messages.create;
  messages.create = function (this: unknown, params?: unknown, requestOptions?: unknown) {
    return wrappedAnthropicCreate((p, o) => original.call(this, p, o) as Promise<unknown>, params, requestOptions, options);
  };
  return () => {
    messages.create = original;
  };
}

const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
const patchedPrototypes = new WeakSet<object>();

async function patchPrototype(kind: "openai" | "anthropic", options: WrapOptions): Promise<boolean> {
  try {
    const mod = await dynamicImport(kind);
    const Ctor = (kind === "openai" ? mod.OpenAI : mod.Anthropic) ?? mod.default;
    if (typeof Ctor !== "function") return false;
    const instance = new (Ctor as new (config: { apiKey: string }) => unknown)({ apiKey: "torrix-auto-instrument" });
    if (kind === "openai") {
      const completions = (instance as { chat?: { completions?: { create?: unknown } } }).chat?.completions;
      if (!completions || typeof completions.create !== "function") return false;
      const proto = Object.getPrototypeOf(completions) as object;
      if (patchedPrototypes.has(proto)) return false;
      const original = completions.create as (...args: unknown[]) => unknown;
      Object.defineProperty(proto, "create", {
        configurable: true,
        writable: true,
        value: function (this: unknown, params?: unknown, requestOptions?: unknown) {
          return wrappedOpenAICreate((p, o) => original.call(this, p, o) as Promise<unknown>, params, requestOptions, options);
        },
      });
      patchedPrototypes.add(proto);
      return true;
    }
    const messages = (instance as { messages?: { create?: unknown } }).messages;
    if (!messages || typeof messages.create !== "function") return false;
    const proto = Object.getPrototypeOf(messages) as object;
    if (patchedPrototypes.has(proto)) return false;
    const original = messages.create as (...args: unknown[]) => unknown;
    Object.defineProperty(proto, "create", {
      configurable: true,
      writable: true,
      value: function (this: unknown, params?: unknown, requestOptions?: unknown) {
        return wrappedAnthropicCreate((p, o) => original.call(this, p, o) as Promise<unknown>, params, requestOptions, options);
      },
    });
    patchedPrototypes.add(proto);
    return true;
  } catch {
    return false;
  }
}

function wrappedOpenAICreate(
  original: (params: unknown, requestOptions: unknown) => Promise<unknown>,
  params: unknown,
  requestOptions: unknown,
  options: WrapOptions,
): Promise<unknown> {
  return trackCall(options, params, "openai", async (startedAt) => {
    const result = await original(stripInternal(params), requestOptions);
    if (isAsyncIterable(result)) return wrapOpenAIStream(result, options, params, startedAt);
    recordSuccess(options, params, "openai", result, startedAt);
    return result;
  });
}

function wrappedAnthropicCreate(
  original: (params: unknown, requestOptions: unknown) => Promise<unknown>,
  params: unknown,
  requestOptions: unknown,
  options: WrapOptions,
): Promise<unknown> {
  return trackCall(options, params, "anthropic", async (startedAt) => {
    const result = await original(stripInternal(params), requestOptions);
    if (isAsyncIterable(result)) return wrapAnthropicStream(result, options, params, startedAt);
    recordSuccess(options, params, "anthropic", result, startedAt);
    return result;
  });
}

async function trackCall<T>(
  options: WrapOptions,
  params: unknown,
  provider: string,
  run: (startedAt: number) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run(startedAt);
  } catch (error) {
    const record = buildRecord(options, params, provider, startedAt);
    record.status = errorStatus(error);
    record.error = errorMessage(error);
    record.request = { body: stripInternal(params) };
    stamp(record, startedAt);
    void options.client.ingest(record).catch(() => {});
    throw error;
  }
}

function recordSuccess(options: WrapOptions, params: unknown, provider: string, result: unknown, startedAt: number): void {
  const record = buildRecord(options, params, provider, startedAt);
  const value = result as OpenAIChatCompletion & AnthropicMessage;
  if (typeof value?.id === "string") record.id = value.id;
  record.model = typeof value?.model === "string" ? value.model : modelOf(params);
  record.status = 200;
  record.request = { body: stripInternal(params) };
  record.response = { body: result };
  applyUsage(record, provider, value?.usage);
  stamp(record, startedAt);
  void options.client.ingest(record).catch(() => {});
}

function stamp(record: TorrixRecord, startedAt: number): void {
  record.end_time = new Date().toISOString();
  record.latency_ms = Math.max(0, Date.now() - startedAt);
}

function buildRecord(options: WrapOptions, params: unknown, provider: string, startedAt: number | undefined): TorrixRecord {
  const internal = internalOf(params);
  const record: TorrixRecord = {
    provider,
    start_time: new Date(startedAt ?? Date.now()).toISOString(),
  };
  if (internal.name ?? options.name) record.name = internal.name ?? options.name;
  if (internal.tags || options.tags) record.tags = mergeTags(options.tags, internal.tags);
  if (options.agentName) record.agent_name = options.agentName;
  return record;
}

function applyUsage(record: TorrixRecord, provider: string, usage: unknown): void {
  const value = usage as (OpenAIUsage & AnthropicUsage) | undefined;
  if (!value || typeof value !== "object") return;
  const input = num(value.prompt_tokens) ?? num(value.input_tokens);
  const output = num(value.completion_tokens) ?? num(value.output_tokens);
  if (input !== undefined) record.input_tokens = input;
  if (output !== undefined) record.output_tokens = output;
  if (provider === "openai") {
    const thinking = num(value.completion_tokens_details?.reasoning_tokens);
    const cached = num(value.prompt_tokens_details?.cached_tokens);
    if (thinking !== undefined) record.thinking_tokens = thinking;
    if (cached !== undefined) record.cache_read_tokens = cached;
    return;
  }
  const cacheRead = num((value as AnthropicUsage).cache_read_input_tokens);
  const cacheWrite = num((value as AnthropicUsage).cache_creation_input_tokens);
  if (cacheRead !== undefined) record.cache_read_tokens = cacheRead;
  if (cacheWrite !== undefined) record.cache_creation_tokens = cacheWrite;
}

function wrapOpenAIStream(stream: object, options: WrapOptions, params: unknown, callStartedAt: number): object {
  const state: OpenAIStreamState = { text: "", reasoning: "", toolCalls: new Map() };
  return proxyAsyncIterable(stream, async function* () {
    try {
      for await (const chunk of stream as AsyncIterable<OpenAIChunk>) {
        accumulateOpenAI(state, chunk);
        yield chunk;
      }
    } catch (error) {
      const record = buildRecord(options, params, "openai", callStartedAt);
      record.status = errorStatus(error);
      record.error = errorMessage(error);
      record.request = { body: stripInternal(params) };
      if (state.id) record.id = state.id;
      stamp(record, callStartedAt);
      void options.client.ingest(record).catch(() => {});
      throw error;
    }
    const record = buildRecord(options, params, "openai", callStartedAt);
    if (state.id) record.id = state.id;
    record.model = state.model ?? modelOf(params);
    record.status = 200;
    record.request = { body: stripInternal(params) };
    record.response = { body: openAIStreamBody(state) };
    applyUsage(record, "openai", state.usage);
    stamp(record, callStartedAt);
    void options.client.ingest(record).catch(() => {});
  });
}

function wrapAnthropicStream(stream: object, options: WrapOptions, params: unknown, callStartedAt: number): object {
  const state: AnthropicStreamState = { text: "", usage: {}, blocks: new Map() };
  return proxyAsyncIterable(stream, async function* () {
    try {
      for await (const event of stream as AsyncIterable<AnthropicStreamEvent>) {
        accumulateAnthropic(state, event);
        yield event;
      }
    } catch (error) {
      const record = buildRecord(options, params, "anthropic", callStartedAt);
      record.status = errorStatus(error);
      record.error = errorMessage(error);
      record.request = { body: stripInternal(params) };
      if (state.id) record.id = state.id;
      stamp(record, callStartedAt);
      void options.client.ingest(record).catch(() => {});
      throw error;
    }
    const record = buildRecord(options, params, "anthropic", callStartedAt);
    if (state.id) record.id = state.id;
    record.model = state.model ?? modelOf(params);
    record.status = 200;
    record.request = { body: stripInternal(params) };
    record.response = { body: anthropicStreamBody(state) };
    applyUsage(record, "anthropic", state.usage);
    stamp(record, callStartedAt);
    void options.client.ingest(record).catch(() => {});
  });
}

function proxyAsyncIterable(source: object, iterate: () => AsyncGenerator<unknown>): object {
  return new Proxy(source, {
    get(target, property) {
      if (property === Symbol.asyncIterator) return iterate;
      return Reflect.get(target, property, target);
    },
  });
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface OpenAIChatCompletion {
  id?: string;
  model?: string;
  usage?: OpenAIUsage;
}

interface AnthropicMessage {
  id?: string;
  model?: string;
  usage?: AnthropicUsage;
}

interface OpenAIChunk {
  id?: string;
  model?: string;
  usage?: OpenAIUsage;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
}

interface OpenAIStreamState {
  id?: string;
  model?: string;
  text: string;
  reasoning: string;
  finish?: string | null;
  usage?: OpenAIUsage;
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>;
}

interface AnthropicStreamEvent {
  type?: string;
  message?: { id?: string; model?: string; usage?: AnthropicUsage };
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
  usage?: AnthropicUsage;
}

interface AnthropicStreamState {
  id?: string;
  model?: string;
  text: string;
  stop?: string | null;
  usage: AnthropicUsage;
  blocks: Map<number, { type: string; text?: string; thinking?: string; id?: string; name?: string; json?: string }>;
}

function accumulateOpenAI(state: OpenAIStreamState, chunk: OpenAIChunk): void {
  if (chunk.id && !state.id) state.id = chunk.id;
  if (chunk.model && !state.model) state.model = chunk.model;
  if (chunk.usage) state.usage = chunk.usage;
  const choice = chunk.choices?.[0];
  if (!choice) return;
  if (typeof choice.delta?.content === "string") state.text += choice.delta.content;
  if (typeof choice.delta?.reasoning_content === "string") state.reasoning += choice.delta.reasoning_content;
  for (const call of choice.delta?.tool_calls ?? []) {
    const index = call.index ?? 0;
    const current = state.toolCalls.get(index) ?? { arguments: "" };
    if (call.id) current.id = call.id;
    if (call.function?.name) current.name = call.function.name;
    if (call.function?.arguments) current.arguments += call.function.arguments;
    state.toolCalls.set(index, current);
  }
  if (choice.finish_reason) state.finish = choice.finish_reason;
}

function accumulateAnthropic(state: AnthropicStreamState, event: AnthropicStreamEvent): void {
  if (event.type === "message_start" && event.message) {
    state.id = event.message.id;
    state.model = event.message.model;
    if (event.message.usage) state.usage = { ...state.usage, ...event.message.usage };
    return;
  }
  if (event.type === "content_block_start" && typeof event.index === "number") {
    state.blocks.set(event.index, {
      type: event.content_block?.type ?? "text",
      id: event.content_block?.id,
      name: event.content_block?.name,
      json: "",
    });
    return;
  }
  if (event.type === "content_block_delta" && typeof event.index === "number") {
    const block = state.blocks.get(event.index) ?? { type: event.delta?.type === "thinking_delta" ? "thinking" : "text" };
    if (event.delta?.type === "text_delta" && event.delta.text) block.text = (block.text ?? "") + event.delta.text;
    if (event.delta?.type === "thinking_delta" && event.delta.thinking) block.thinking = (block.thinking ?? "") + event.delta.thinking;
    if (event.delta?.type === "input_json_delta" && event.delta.partial_json) block.json = (block.json ?? "") + event.delta.partial_json;
    state.blocks.set(event.index, block);
    return;
  }
  if (event.type === "message_delta") {
    if (event.usage) state.usage = { ...state.usage, ...event.usage };
    if (event.delta?.stop_reason) state.stop = event.delta.stop_reason;
  }
}

function openAIStreamBody(state: OpenAIStreamState): unknown {
  const message: Record<string, unknown> = { role: "assistant", content: state.text };
  if (state.reasoning) message.reasoning_content = state.reasoning;
  if (state.toolCalls.size) {
    message.tool_calls = [...state.toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
  }
  return {
    id: state.id,
    model: state.model,
    choices: [{ index: 0, message, finish_reason: state.finish ?? "stop" }],
    usage: state.usage,
  };
}

function anthropicStreamBody(state: AnthropicStreamState): unknown {
  const content = [...state.blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) => {
      if (block.type === "tool_use") {
        let input: unknown = block.json ?? "";
        try {
          input = block.json ? JSON.parse(block.json) : {};
        } catch {
          input = block.json;
        }
        return { type: "tool_use", id: block.id, name: block.name, input };
      }
      if (block.type === "thinking") return { type: "thinking", thinking: block.thinking ?? "" };
      return { type: "text", text: block.text ?? "" };
    });
  return { id: state.id, model: state.model, stop_reason: state.stop, content, usage: state.usage };
}

function stripInternal(params: unknown): unknown {
  if (!params || typeof params !== "object") return params;
  const copy: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  delete copy.torrix_name;
  delete copy.torrix_tags;
  return copy;
}

function internalOf(params: unknown): { name?: string; tags?: Record<string, string> } {
  if (!params || typeof params !== "object") return {};
  const value = params as { torrix_name?: unknown; torrix_tags?: unknown };
  const out: { name?: string; tags?: Record<string, string> } = {};
  if (typeof value.torrix_name === "string") out.name = value.torrix_name;
  if (value.torrix_tags && typeof value.torrix_tags === "object") out.tags = value.torrix_tags as Record<string, string>;
  return out;
}

function mergeTags(base?: Record<string, string>, extra?: Record<string, string>): Record<string, string> | undefined {
  const merged = { ...(base ?? {}), ...(extra ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

function modelOf(params: unknown): string | undefined {
  const value = params as { model?: unknown } | null;
  return typeof value?.model === "string" ? value.model : undefined;
}

function errorStatus(error: unknown): number {
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  return num(value?.status) ?? num(value?.statusCode) ?? num(value?.response?.status) ?? 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const value = error as { message?: unknown; error?: { message?: unknown } } | null;
  if (typeof value?.message === "string") return value.message;
  if (typeof value?.error?.message === "string") return value.error.message;
  return String(error);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value) && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
