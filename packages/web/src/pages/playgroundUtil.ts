// Pure helpers for the playground chat client. Kept out of the component so the
// provider request shapes and stream parsing match the server-rendered console.

export interface PlaygroundProvider {
  id: string;
  label: string;
  baseUrl: string;
  endpoint: string;
  format: string;
  auth: string;
  models: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Connection settings remembered per provider, so switching providers and
 *  coming back restores what the user configured instead of the defaults. */
export interface PlaygroundPrefs {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** The slice of Storage the playground needs; injected so the helpers are
 *  testable without a browser. */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export const PROVIDER_KEY = "torrix_pg_provider";
export const CONV_KEY = "torrix_pg_conv";

export function prefsKey(providerId: string): string {
  return `pgprefs.${providerId}`;
}

export function browserStore(): PrefStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Saved connection for one provider, or null when nothing usable is stored.
 *  Keys written by older builds live under `pgkey.<id>` and are still read. */
export function readPrefs(providerId: string, store: PrefStore | null = browserStore()): Partial<PlaygroundPrefs> | null {
  if (!store) return null;
  try {
    const raw = store.getItem(prefsKey(providerId));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown> | null;
      const prefs: Partial<PlaygroundPrefs> = {};
      for (const field of ["baseUrl", "apiKey", "model"] as const) {
        if (typeof parsed?.[field] === "string") prefs[field] = parsed[field] as string;
      }
      if (Object.keys(prefs).length) return prefs;
    }
    const legacy = store.getItem(`pgkey.${providerId}`);
    return legacy ? { apiKey: legacy } : null;
  } catch {
    return null;
  }
}

export function writePrefs(providerId: string, prefs: PlaygroundPrefs, store: PrefStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.setItem(prefsKey(providerId), JSON.stringify(prefs));
  } catch {
    // quota or private mode
  }
}

/** Saved values win over provider defaults. A provider that ships a model list
 *  still supplies its first model when nothing usable was saved. */
export function resolvePrefs(provider: PlaygroundProvider, saved: Partial<PlaygroundPrefs> | null): PlaygroundPrefs {
  const baseUrl = saved?.baseUrl?.trim() ? saved.baseUrl : provider.baseUrl;
  const savedModel = saved?.model?.trim() ?? "";
  return { baseUrl, apiKey: saved?.apiKey ?? "", model: savedModel || provider.models[0] || "" };
}

export function readProviderId(store: PrefStore | null = browserStore()): string {
  try {
    return store?.getItem(PROVIDER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeProviderId(providerId: string, store: PrefStore | null = browserStore()): void {
  try {
    store?.setItem(PROVIDER_KEY, providerId);
  } catch {
    // quota or private mode
  }
}

/** The remembered provider when the catalog still offers it, else the first. */
export function resolveProviderId(providers: PlaygroundProvider[], saved: string): string {
  return providers.some((provider) => provider.id === saved) ? saved : providers[0]?.id ?? "";
}

/** Drops every playground record, so provider keys and transcript text do not
 *  survive a sign-out on a shared browser profile. */
export function clearPlaygroundStorage(store: PrefStore | null = browserStore()): void {
  if (!store?.removeItem) return;
  const keys: string[] = [];
  const total = store.length ?? 0;
  if (store.key) {
    for (let index = 0; index < total; index += 1) {
      const key = store.key(index);
      if (key) keys.push(key);
    }
  }
  for (const key of keys) {
    if (key.startsWith("pgprefs.") || key.startsWith("pgkey.") || key === PROVIDER_KEY || key === CONV_KEY) {
      try {
        store.removeItem(key);
      } catch {
        // quota or private mode
      }
    }
  }
}

export type ToolState = Record<number, { name: string; args: string }>;

/**
 * Reasoning models take `max_completion_tokens` and reject a custom
 * temperature; chat models still take `max_tokens`. Sending the wrong pair is
 * the difference between a working turn and a 400 from the provider.
 */
export function isReasoningModel(model: string): boolean {
  const name = model.trim();
  if (!name || /-chat(?:-|$)/i.test(name)) return false;
  return /^(o[1-9]|gpt-5)/i.test(name);
}

export interface BuildBodyOptions {
  stream?: boolean;
}

/** Gemini streams through a different endpoint, so the caller swaps the suffix. */
export function geminiEndpoint(endpoint: string, stream: boolean): string {
  if (!stream) return endpoint;
  return endpoint.replace(/:generateContent$/, ":streamGenerateContent") + (endpoint.includes("?") ? "&alt=sse" : "?alt=sse");
}

export function buildBody(
  provider: PlaygroundProvider,
  model: string,
  history: ChatTurn[],
  temperature: number,
  system: string,
  options: BuildBodyOptions = {},
): Record<string, unknown> {
  const stream = options.stream !== false;
  if (provider.format === "anthropic") {
    const messages = history.map((turn) => ({ role: turn.role === "user" ? "user" : "assistant", content: turn.content }));
    const body: Record<string, unknown> = { model, max_tokens: 1024, temperature, messages };
    if (stream) body.stream = true;
    if (system) body.system = system;
    return body;
  }
  if (provider.format === "gemini") {
    const contents = history.map((turn) => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.content }] }));
    const body: Record<string, unknown> = { contents, generationConfig: { temperature, maxOutputTokens: 2048 } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    return body;
  }
  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  for (const turn of history) messages.push({ role: turn.role, content: turn.content });
  const reasoning = isReasoningModel(model);
  const body: Record<string, unknown> = { model, messages };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (!reasoning) body.temperature = temperature;
  if (reasoning) body.max_completion_tokens = 2048;
  else body.max_tokens = 1024;
  return body;
}

export function chunkText(chunk: Record<string, unknown>): string {
  const choices = chunk.choices as Array<{ delta?: { content?: unknown } }> | undefined;
  if (choices) {
    const delta = choices[0]?.delta;
    if (delta && typeof delta.content === "string") return delta.content;
  }
  if (chunk.type === "content_block_delta") {
    // The delta lives at `delta` on Anthropic events; some gateways wrap the
    // whole event as `content_block_delta`. Accept both shapes.
    const wrapped = chunk.content_block_delta as { delta?: { type?: string; text?: unknown } } | undefined;
    const delta = (chunk.delta as { type?: string; text?: unknown } | undefined) ?? wrapped?.delta;
    // Anthropic names text deltas `text_delta`; older compatible servers used `text`.
    if ((delta?.type === "text_delta" || delta?.type === "text") && typeof delta.text === "string") {
      return delta.text;
    }
  }
  const candidates = chunk.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> | undefined;
  if (candidates) {
    let text = "";
    for (const part of candidates[0]?.content?.parts ?? []) {
      if (typeof part.text === "string") text += part.text;
    }
    if (text) return text;
  }
  return "";
}

export function streamTools(chunk: Record<string, unknown>, state: ToolState): boolean {
  let changed = false;
  const choices = chunk.choices as Array<{ delta?: { tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }> } }> | undefined;
  const delta = choices?.[0]?.delta;
  if (delta && Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      const index = call.index ?? 0;
      state[index] = state[index] ?? { name: "", args: "" };
      const fn = call.function ?? {};
      if (fn.name) state[index].name += fn.name;
      if (fn.arguments) state[index].args += fn.arguments;
      changed = true;
    }
  }
  if (chunk.type === "content_block_start") {
    const block = chunk.content_block as { type?: string; name?: string } | undefined;
    if (block?.type === "tool_use") {
      const index = typeof chunk.index === "number" ? chunk.index : 0;
      state[index] = state[index] ?? { name: block.name || "tool", args: "" };
      changed = true;
    }
  }
  if (chunk.type === "content_block_delta") {
    // Anthropic puts the payload at `delta`; older gateways wrapped it.
    const wrapped = chunk.content_block_delta as { delta?: { type?: string; partial_json?: string } } | undefined;
    const blockDelta = (chunk.delta as { type?: string; partial_json?: string } | undefined) ?? wrapped?.delta;
    if (blockDelta?.type === "input_json_delta" && blockDelta.partial_json) {
      const index = typeof chunk.index === "number" ? chunk.index : 0;
      state[index] = state[index] ?? { name: "tool", args: "" };
      state[index].args += blockDelta.partial_json;
      changed = true;
    }
  }
  return changed;
}

export function formatTools(state: ToolState): string {
  return Object.keys(state)
    .map(Number)
    .sort((a, b) => a - b)
    .map((key) => {
      const tool = state[key];
      let args = tool.args;
      try { args = JSON.stringify(JSON.parse(tool.args), null, 2); } catch { /* keep raw */ }
      return `${tool.name || "tool"}:\n${args}`;
    })
    .join("\n\n");
}

export function describeError(body: unknown, status: number): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string") { if (value && value !== "upstream_error") parts.push(value.slice(0, 220)); return; }
    if (typeof value === "object") {
      const record = value as { message?: unknown; type?: unknown };
      if (typeof record.message === "string") parts.push(record.message);
      else if (typeof record.type === "string") parts.push(record.type);
      else parts.push(JSON.stringify(value).slice(0, 220));
      return;
    }
    parts.push(String(value));
  };
  if (body && typeof body === "object") {
    const record = body as { error?: unknown; detail?: unknown; message?: unknown };
    push(record.error);
    push(record.detail);
    push(record.message);
  } else {
    push(body);
  }
  if (!parts.length) parts.push("request rejected");
  return `HTTP ${status} · ${parts.slice(0, 2).join(" · ")}`;
}

export function plainResponseText(provider: PlaygroundProvider, body: unknown): string {
  const record = (body ?? {}) as Record<string, unknown>;
  let acc = "";
  if (provider.format === "gemini") {
    const candidates = record.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
    for (const part of candidates?.[0]?.content?.parts ?? []) acc += part.text ?? "";
  } else if (Array.isArray((record.choices as Array<{ message?: { content?: string } }> | undefined)) && (record.choices as Array<{ message?: { content?: string } }>)[0]?.message) {
    acc = (record.choices as Array<{ message?: { content?: string } }>)[0].message?.content ?? "";
  } else if (Array.isArray(record.content)) {
    for (const block of record.content as Array<{ text?: string }>) acc += block.text ?? "";
  }
  return acc;
}
