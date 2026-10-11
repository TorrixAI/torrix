const MAX_LEN = 800;
const THINKING_MAX_LEN = 4000;

export interface ExtractOptions {
  /** Cap for the extracted response text; defaults to the display-oriented 800 chars. */
  maxTextLen?: number;
}

export interface Extracted {
  prompt: string;
  responseText: string;
  thinkingText: string;
  finishReason: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  toolCalls: ToolCall[];
  media: MediaPart[];
}

export interface MediaPart {
  kind: "image" | "audio" | "video" | "file";
  mime: string | null;
  source: "data" | "url" | "base64";
  ref: string;
  bytes: number | null;
  /** Transient base64 payload for inline media; never persisted in run metadata. */
  inline?: string;
}

export interface ToolCall {
  name: string;
  arguments: string;
}

const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return truncate(content, MAX_LEN);
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(truncate(block, MAX_LEN));
    } else if (block && typeof block === "object") {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(truncate(b.text, MAX_LEN));
      } else if (b.type === "image_url" && b.image_url && typeof b.image_url === "object") {
        const url = (b.image_url as Record<string, unknown>).url as string | undefined;
        parts.push(describeImage(url));
      } else if (b.type === "image" && b.source && typeof b.source === "object") {
        const kind = (b.source as Record<string, unknown>).type;
        parts.push(kind === "base64" ? "[image ~base64]" : "[image]" );
      } else if (b.type === "input_audio" || b.type === "audio") {
        parts.push("[audio]");
      } else if (b.type === "file" || b.type === "document") {
        parts.push("[file]");
      } else if (b.inlineData) {
        parts.push("[image ~base64]");
      } else if (b.fileData) {
        parts.push("[file:url]");
      } else if (b.thought) {
        // nothing
      }
    }
  }
  return truncate(parts.join(" "), MAX_LEN);
}

function describeImage(url?: string): string {
  if (!url) {
    return "[image]";
  }
  if (url.startsWith("data:")) {
    const mime = url.slice(5, url.indexOf(";"));
    return `[image:${mime} ~KB]`;
  }
  return "[image:url]";
}

function base64Bytes(payload: string): number {
  const clean = payload.replace(/\s+/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function dataUrlPart(url: string, kind: MediaPart["kind"]): MediaPart {
  const comma = url.indexOf(",");
  const header = comma >= 0 ? url.slice(5, comma) : "";
  const mime = header.split(";")[0] || null;
  const payload = comma >= 0 ? url.slice(comma + 1) : "";
  const isBase64 = header.includes("base64");
  return {
    kind,
    mime,
    source: "data",
    ref: `data:${mime ?? "application/octet-stream"}`,
    bytes: isBase64 ? base64Bytes(payload) : payload.length,
    inline: isBase64 ? payload : undefined,
  };
}

function scanMediaBlock(block: unknown, provider: string, out: MediaPart[]): void {
  if (!block || typeof block !== "object") {
    return;
  }
  const b = block as Record<string, unknown>;
  const type = typeof b.type === "string" ? b.type : "";

  if (provider === "gemini" || b.inlineData || b.fileData) {
    const inline = b.inlineData as Record<string, unknown> | undefined;
    if (inline && typeof inline.data === "string") {
      const mime = typeof inline.mimeType === "string" ? inline.mimeType : null;
      out.push({
        kind: mime?.startsWith("audio/") ? "audio" : mime?.startsWith("video/") ? "video" : "image",
        mime,
        source: "base64",
        ref: `inline:${mime ?? "application/octet-stream"}`,
        bytes: base64Bytes(inline.data),
        inline: inline.data,
      });
    }
    const file = b.fileData as Record<string, unknown> | undefined;
    if (file && typeof file.fileUri === "string") {
      const mime = typeof file.mimeType === "string" ? file.mimeType : null;
      out.push({ kind: "file", mime, source: "url", ref: file.fileUri, bytes: null });
    }
  }

  if (type === "image_url" && b.image_url && typeof b.image_url === "object") {
    const url = (b.image_url as Record<string, unknown>).url;
    if (typeof url === "string") {
      out.push(url.startsWith("data:") ? dataUrlPart(url, "image") : { kind: "image", mime: null, source: "url", ref: url, bytes: null });
    }
  }

  if (type === "image" && b.source && typeof b.source === "object") {
    const source = b.source as Record<string, unknown>;
    if (source.type === "base64" && typeof source.data === "string") {
      const mime = typeof source.media_type === "string" ? source.media_type : null;
      out.push({
        kind: "image",
        mime,
        source: "base64",
        ref: `base64:${mime ?? "image"}`,
        bytes: base64Bytes(source.data),
        inline: source.data,
      });
    } else if (source.type === "url" && typeof source.url === "string") {
      out.push({ kind: "image", mime: null, source: "url", ref: source.url, bytes: null });
    }
  }

  if (type === "input_audio") {
    const audio = b.input_audio as Record<string, unknown> | undefined;
    const data = typeof audio?.data === "string" ? audio.data : null;
    const format = typeof audio?.format === "string" ? audio.format : null;
    out.push({
      kind: "audio",
      mime: format ? `audio/${format}` : null,
      source: data ? "base64" : "url",
      ref: data ? `base64:audio/${format ?? "unknown"}` : "audio",
      bytes: data ? base64Bytes(data) : null,
      inline: data ?? undefined,
    });
  } else if (type === "audio" && b.audio && typeof b.audio === "object") {
    const audio = b.audio as Record<string, unknown>;
    if (typeof audio.data === "string") {
      const format = typeof audio.format === "string" ? audio.format : null;
      out.push({
        kind: "audio",
        mime: format ? `audio/${format}` : null,
        source: "base64",
        ref: `base64:audio/${format ?? "unknown"}`,
        bytes: base64Bytes(audio.data),
        inline: audio.data,
      });
    }
  }

  if (type === "file" || type === "document") {
    const file = (b.file ?? b.source) as Record<string, unknown> | undefined;
    if (typeof file?.file_data === "string" && file.file_data.startsWith("data:")) {
      out.push(dataUrlPart(file.file_data, "file"));
    } else if (typeof file?.file_id === "string") {
      out.push({ kind: "file", mime: null, source: "url", ref: `file_id:${file.file_id}`, bytes: null });
    }
  }
}

export function extractMedia(reqBody: Record<string, unknown>, provider: string): MediaPart[] {
  const out: MediaPart[] = [];
  const containers =
    provider === "gemini"
      ? ((reqBody.contents as Array<Record<string, unknown>>) ?? [])
      : ((reqBody.messages as Array<Record<string, unknown>>) ?? []);
  for (const msg of containers) {
    const content = provider === "gemini" ? msg?.parts : msg?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        scanMediaBlock(block, provider, out);
      }
    }
  }
  return out;
}

function findLast<T>(list: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) {
      return list[i];
    }
  }
  return undefined;
}

export function extractOpenAI(reqBody: Record<string, unknown>, resBody: Record<string, unknown>, opts?: ExtractOptions): Extracted {
  const textCap = opts?.maxTextLen ?? MAX_LEN;
  const messages = (reqBody.messages as Array<Record<string, unknown>>) ?? [];
  const lastUser = findLast(messages, (m) => m.role === "user");
  const prompt = lastUser ? contentToText(lastUser.content) : "";
  const choice = (resBody.choices as Array<Record<string, unknown>>)?.[0];
  const message = (choice?.message as Record<string, unknown>) ?? {};
  const usage = (resBody.usage as Record<string, unknown>) ?? {};
  const details = (usage.completion_tokens_details as Record<string, unknown>) ?? {};
  const promptDetails = (usage.prompt_tokens_details as Record<string, unknown>) ?? {};

  const thinking = (message.reasoning_content as string) ?? (message.reasoning as string) ?? null;

  return {
    prompt,
    responseText: typeof message.content === "string" ? truncate(message.content, textCap) : "",
    thinkingText: thinking ? truncate(thinking, THINKING_MAX_LEN) : "",
    finishReason: (choice?.finish_reason as string) ?? null,
    model: (resBody.model as string) ?? null,
    inputTokens: (usage.prompt_tokens as number) ?? null,
    outputTokens: (usage.completion_tokens as number) ?? null,
    cacheReadTokens: (promptDetails.cached_tokens as number) ?? null,
    cacheCreationTokens: null,
    toolCalls: extractOpenAITools(message.tool_calls),
    media: extractMedia(reqBody, "openai"),
  };
}

function extractOpenAITools(toolCalls: unknown): ToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  const out: ToolCall[] = [];
  for (const tc of toolCalls) {
    if (!tc || typeof tc !== "object") {
      continue;
    }
    const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined;
    if (fn && typeof fn.name === "string") {
      out.push({ name: fn.name, arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}) });
    }
  }
  return out;
}

export function extractAnthropic(reqBody: Record<string, unknown>, resBody: Record<string, unknown>, opts?: ExtractOptions): Extracted {
  const textCap = opts?.maxTextLen ?? MAX_LEN;
  const messages = (reqBody.messages as Array<Record<string, unknown>>) ?? [];
  const lastUser = findLast(messages, (m) => m.role === "user");
  const prompt = lastUser ? contentToText(lastUser.content) : "";
  const content = (resBody.content as Array<Record<string, unknown>>) ?? [];
  const usage = (resBody.usage as Record<string, unknown>) ?? {};

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      thinkingParts.push(block.thinking);
    } else if (block.type === "tool_use") {
      toolCalls.push({ name: String(block.name ?? ""), arguments: JSON.stringify(block.input ?? {}) });
    }
  }

  return {
    prompt,
    responseText: truncate(textParts.join("\n"), textCap),
    thinkingText: truncate(thinkingParts.join("\n"), THINKING_MAX_LEN),
    finishReason: (resBody.stop_reason as string) ?? null,
    model: (resBody.model as string) ?? null,
    inputTokens: (usage.input_tokens as number) ?? null,
    outputTokens: (usage.output_tokens as number) ?? null,
    cacheReadTokens: (usage.cache_read_input_tokens as number) ?? null,
    cacheCreationTokens: (usage.cache_creation_input_tokens as number) ?? null,
    toolCalls,
    media: extractMedia(reqBody, "anthropic"),
  };
}

export function extractGemini(reqBody: Record<string, unknown>, resBody: Record<string, unknown>, opts?: ExtractOptions): Extracted {
  const textCap = opts?.maxTextLen ?? MAX_LEN;
  const contents = (reqBody.contents as Array<Record<string, unknown>>) ?? [];
  const lastUser = findLast(contents, (c) => c.role === "user");
  const prompt = lastUser ? contentToText(lastUser.parts) : "";
  const candidate = (resBody.candidates as Array<Record<string, unknown>>)?.[0];
  const parts = ((candidate?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) ?? [];
  const usage = (resBody.usageMetadata as Record<string, unknown>) ?? {};

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const part of parts) {
    if (part.thought === true) {
      if (typeof part.text === "string") {
        thinkingParts.push(part.text);
      }
    } else if (typeof part.text === "string") {
      textParts.push(part.text);
    } else if (part.functionCall && typeof part.functionCall === "object") {
      const fn = part.functionCall as Record<string, unknown>;
      toolCalls.push({ name: String(fn.name ?? ""), arguments: JSON.stringify(fn.args ?? {}) });
    }
  }

  return {
    prompt,
    responseText: truncate(textParts.join("\n"), textCap),
    thinkingText: truncate(thinkingParts.join("\n"), THINKING_MAX_LEN),
    finishReason: (candidate?.finishReason as string) ?? null,
    model: (resBody.modelVersion as string) ?? null,
    inputTokens: (usage.promptTokenCount as number) ?? null,
    outputTokens: (usage.candidatesTokenCount as number) ?? null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    toolCalls,
    media: extractMedia(reqBody, "gemini"),
  };
}

export function extractGeneric(reqBody: Record<string, unknown>, resBody: unknown, opts?: ExtractOptions): Extracted {
  const textCap = opts?.maxTextLen ?? MAX_LEN;
  return {
    prompt: "",
    responseText: typeof resBody === "string" ? truncate(resBody, textCap) : truncate(JSON.stringify(resBody ?? {}), textCap),
    thinkingText: "",
    finishReason: null,
    model: (reqBody.model as string) ?? null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    toolCalls: [],
    media: extractMedia(reqBody, "generic"),
  };
}

export function extractAutoName(reqBody: Record<string, unknown>): string {
  const messages = (reqBody.messages as Array<Record<string, unknown>>) ?? [];
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) {
    return "untitled";
  }
  const text = contentToText(firstUser.content).replace(/\s+/g, " ").trim();
  return truncate(text, 60) || "untitled";
}

interface SSEJson {
  model?: string;
  usage?: Record<string, unknown>;
  choices?: Array<Record<string, unknown>>;
  id?: string;
  type?: string;
  message?: Record<string, unknown>;
  content_block?: { type?: string; index?: number; name?: string };
  content_block_delta?: { delta?: Record<string, unknown>; index?: number };
  message_delta?: { delta?: Record<string, unknown>; usage?: Record<string, unknown> };
}

export function extractFromSSEChunks(accumulated: string): Partial<Extracted> {
  let responseText = "";
  let thinkingText = "";
  let finishReason: string | null = null;
  let model: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  let cacheCreationTokens: number | null = null;
  const openaiTools = new Map<number, { name: string; args: string }>();
  const anthropicTools = new Map<number, { name: string; args: string }>();

  const lines = accumulated.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:") || line === "data: [DONE]") {
      continue;
    }
    let json: SSEJson;
    try {
      json = JSON.parse(line.slice(5)) as SSEJson;
    } catch {
      continue;
    }

    if (typeof json.model === "string") {
      model = json.model;
    }
    if (json.type === "message_start" && json.message) {
      model = (json.message.model as string) ?? model;
      const usage = (json.message.usage as Record<string, unknown>) ?? {};
      inputTokens = (usage.input_tokens as number) ?? null;
      cacheReadTokens = (usage.cache_read_input_tokens as number) ?? null;
      cacheCreationTokens = (usage.cache_creation_input_tokens as number) ?? null;
    }
    if (json.type === "message_delta" || (json.message_delta && json.message_delta.usage)) {
      const delta = json.message_delta;
      if (delta) {
        outputTokens = ((delta.usage as Record<string, unknown>)?.output_tokens as number) ?? outputTokens;
        const stop = ((delta.delta as Record<string, unknown>)?.stop_reason as string) ?? null;
        if (stop) {
          finishReason = stop;
        }
      }
    }
    if (json.type === "content_block_start" && json.content_block) {
      if (json.content_block.type === "tool_use") {
        const idx = json.content_block.index ?? 0;
        anthropicTools.set(idx, { name: String(json.content_block.name ?? ""), args: "" });
      }
    }
    if (json.type === "content_block_delta" && json.content_block_delta) {
      const delta = json.content_block_delta.delta ?? {};
      if (delta.type === "text" && typeof delta.text === "string") {
        responseText += delta.text;
      } else if (delta.type === "thinking_delta" && typeof delta.thinking_delta === "string") {
        thinkingText += delta.thinking_delta;
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const idx = json.content_block_delta.index ?? 0;
        const tool = anthropicTools.get(idx);
        if (tool) {
          tool.args += delta.partial_json;
        }
      }
    }

    const choices = json.choices ?? [];
    const usage = json.usage ?? {};
    if (Object.keys(usage).length > 0) {
      inputTokens = inputTokens ?? (usage.prompt_tokens as number) ?? null;
      outputTokens = (usage.completion_tokens as number) ?? outputTokens;
      const promptDetails = (usage.prompt_tokens_details as Record<string, unknown>) ?? {};
      cacheReadTokens = cacheReadTokens ?? (promptDetails.cached_tokens as number) ?? null;
    }
    const choice = choices[0];
    if (choice) {
      if (typeof choice.finish_reason === "string") {
        finishReason = choice.finish_reason;
      }
      const delta = (choice.delta as Record<string, unknown>) ?? {};
      if (typeof delta.content === "string") {
        responseText += delta.content;
      }
      if (typeof delta.reasoning === "string") {
        thinkingText += delta.reasoning;
      }
      const toolCalls = (delta.tool_calls as Array<Record<string, unknown>>) ?? [];
      for (const tc of toolCalls) {
        const idx = (tc.index as number) ?? 0;
        const entry = openaiTools.get(idx) ?? { name: "", args: "" };
        const fn = (tc.function as Record<string, unknown>) ?? {};
        if (typeof fn.name === "string") {
          entry.name = fn.name;
        }
        if (typeof fn.arguments === "string") {
          entry.args += fn.arguments;
        }
        openaiTools.set(idx, entry);
      }
    }
  }

  const toolCalls: ToolCall[] = [
    ...[...openaiTools.values()].map((t) => ({ name: t.name, arguments: t.args })),
    ...[...anthropicTools.values()].map((t) => ({ name: t.name, arguments: t.args })),
  ];

  return {
    responseText: truncate(responseText, MAX_LEN),
    thinkingText: truncate(thinkingText, THINKING_MAX_LEN),
    finishReason,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
}

export function detectStructuredOutput(reqBody: Record<string, unknown>): string | null {
  const rf = (reqBody.response_format as Record<string, unknown>) ?? {};
  if (rf.type === "json_object" || rf.type === "json_schema") {
    return "json";
  }
  const tools = reqBody.tools;
  if (Array.isArray(tools) && tools.length > 0) {
    return "tools";
  }
  return null;
}

export function extractToolCalls(resBody: unknown, provider: string): ToolCall[] {
  if (!resBody || typeof resBody !== "object") {
    return [];
  }
  const body = resBody as Record<string, unknown>;
  if (provider === "anthropic") {
    return extractAnthropic({ messages: [] }, body).toolCalls;
  }
  if (provider === "gemini") {
    const choices = body.choices;
    void choices;
    return extractGemini({ contents: [] }, body).toolCalls;
  }
  const choice = (body.choices as Array<Record<string, unknown>>)?.[0];
  const message = (choice?.message as Record<string, unknown>) ?? {};
  return extractOpenAITools(message.tool_calls);
}

export function promptHash(messageJson: string): string | null {
  if (!messageJson) {
    return null;
  }
  const hash = Bun.hash(messageJson).toString(16).slice(0, 16);
  return hash;
}

/** Text of the last user message in an OpenAI- or Anthropic-shaped request body. */
export function extractUserPrompt(requestBody: string | null | undefined): string | null {
  if (!requestBody) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(requestBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role !== "user") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? String((part as { text: string }).text) : ""))
        .filter(Boolean)
        .join("\n");
      if (text) {
        return text;
      }
    }
  }
  return null;
}
