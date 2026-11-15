import type { RunEvent } from "../api";

export interface ToolStep {
  name: string;
  detail: string;
}

export interface ParsedResponse {
  text: string | null;
  reasoning: string | null;
  toolCall: ToolStep | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      if (!record) return "";
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function toolArgumentDetail(args: unknown): string {
  let value = args;
  if (typeof args === "string") {
    try {
      value = JSON.parse(args) as unknown;
    } catch {
      return args.replace(/\s+/g, " ").trim().slice(0, 78);
    }
  }
  const record = asRecord(value);
  if (!record) return "";
  const keys = ["command", "file_path", "path", "pattern", "query", "url", "description", "prompt", "task"];
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.replace(/\s+/g, " ").trim().slice(0, 78);
    }
  }
  for (const candidate of Object.values(record)) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.replace(/\s+/g, " ").trim().slice(0, 78);
    }
  }
  return "";
}

function toolFromRecord(record: Record<string, unknown>): ToolStep | null {
  const fn = asRecord(record.function);
  const name = record.name ?? fn?.name;
  if (typeof name !== "string" || !name) return null;
  return { name: name.slice(0, 40), detail: toolArgumentDetail(record.arguments ?? fn?.arguments ?? record.input ?? record.args) };
}

/**
 * Large tool payloads are truncated before storage, so their JSON no longer
 * parses. Recover the tool name from the raw text instead of labelling every
 * one of them "tool call".
 */
function rawToolName(message: string): string | null {
  const match = /"(?:name|toolName|tool_name|tool)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(message);
  if (!match) return null;
  try {
    return (JSON.parse(`"${match[1]}"`) as string).slice(0, 40) || null;
  } catch {
    return match[1].slice(0, 40) || null;
  }
}

/** A truncated event still holds the first argument field, escaped. */
function rawToolDetail(message: string): string {
  const match = /\\"(command|file_path|path|pattern|query|url|description|prompt|task)\\":\\"((?:(?!\\"(?:,|})).)*)/s.exec(message);
  if (!match) return "";
  return match[2]
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 78);
}

export function toolStep(message: string): ToolStep {
  try {
    const parsed = JSON.parse(message) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const record = asRecord(first);
    const step = record ? toolFromRecord(record) : null;
    if (step) return step;
  } catch {
    // A malformed tool event still needs a visible label.
  }
  const name = rawToolName(message);
  if (name) return { name, detail: rawToolDetail(message) };
  return { name: "tool call", detail: "" };
}

export function toolLabel(message: string): string {
  const step = toolStep(message);
  return step.detail ? `${step.name} ${step.detail}` : step.name;
}

/** A human-readable argument line for a tool row, e.g. "path DESIGN.md". */
export function toolArgumentSummary(message: string): string {
  try {
    const parsed = JSON.parse(message) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const record = asRecord(first);
    if (!record) return "";
    const args = record.arguments ?? record.input ?? record.args;
    let value: unknown = args;
    if (typeof args === "string") {
      try {
        value = JSON.parse(args) as unknown;
      } catch {
        return args.replace(/\s+/g, " ").trim().slice(0, 96);
      }
    }
    const argsRecord = asRecord(value);
    if (!argsRecord) return "";
    const keys: Array<[string, string]> = [
      ["file_path", "path"],
      ["path", "path"],
      ["command", "command"],
      ["url", "url"],
      ["query", "query"],
      ["pattern", "pattern"],
      ["description", "description"],
      ["prompt", "prompt"],
      ["task", "task"],
    ];
    for (const [key, label] of keys) {
      const candidate = argsRecord[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return `${label} ${candidate.replace(/\s+/g, " ").trim().slice(0, 96)}`;
      }
    }
    for (const [key, candidate] of Object.entries(argsRecord)) {
      if (typeof candidate === "string" && candidate.trim()) {
        return `${key} ${candidate.replace(/\s+/g, " ").trim().slice(0, 96)}`;
      }
    }
  } catch {
    // Not a JSON tool event; the row falls back to the answer or nothing.
  }
  return "";
}

/** Unescape text for display only; stored values are never rewritten. */
export function displayText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function collectResponse(parsed: unknown): ParsedResponse {
  const record = asRecord(parsed);
  if (!record) {
    if (typeof parsed === "string") return { text: displayText(parsed), reasoning: null, toolCall: null };
    return { text: null, reasoning: null, toolCall: null };
  }

  let text = "";
  let reasoning = "";
  let toolCall: ToolStep | null = null;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message) ?? asRecord(choice?.delta);
  if (message) {
    text = textFromContent(message.content);
    const reasoningValue = message.reasoning_content ?? message.reasoning ?? message.thinking;
    if (typeof reasoningValue === "string") reasoning = reasoningValue;
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      const callRecord = asRecord(call);
      const step = callRecord ? toolFromRecord(callRecord) : null;
      if (step) { toolCall = step; break; }
    }
  }

  const content = Array.isArray(record.content) ? record.content : [];
  for (const part of content) {
    const partRecord = asRecord(part);
    if (!partRecord) continue;
    if (partRecord.type === "text" && typeof partRecord.text === "string") {
      text = text ? `${text}\n${partRecord.text}` : partRecord.text;
    }
    if (partRecord.type === "thinking" && typeof partRecord.thinking === "string") {
      reasoning = reasoning ? `${reasoning}\n${partRecord.thinking}` : partRecord.thinking;
    }
    if (partRecord.type === "tool_use" && !toolCall) {
      const step = toolFromRecord(partRecord);
      if (step) toolCall = step;
    }
  }

  if (typeof record.output_text === "string") text = text || record.output_text;
  if (!text && typeof record.text === "string") text = record.text;
  if (!reasoning && typeof record.reasoning === "string") reasoning = record.reasoning;

  return {
    text: text ? displayText(text) : null,
    reasoning: reasoning ? displayText(reasoning) : null,
    toolCall,
  };
}

export function parseResponse(message: string | null | undefined): ParsedResponse {
  if (!message) return { text: null, reasoning: null, toolCall: null };
  try {
    return collectResponse(JSON.parse(message) as unknown);
  } catch {
    return { text: displayText(message), reasoning: null, toolCall: null };
  }
}

export function responseDisplay(message: string | null | undefined): string | null {
  const parsed = parseResponse(message);
  if (parsed.text) return parsed.text;
  if (parsed.reasoning) return parsed.reasoning;
  if (parsed.toolCall) {
    return `Tool call: ${parsed.toolCall.name}${parsed.toolCall.detail ? ` ${parsed.toolCall.detail}` : ""}`;
  }
  return null;
}

export function conversationAnswer(events: RunEvent[], error?: string | null): string {
  const response = [...events].reverse().find((event) => event.type === "response");
  return responseDisplay(response?.message) ?? error ?? "No text answer captured.";
}

export interface TurnSummary {
  prompt: string | null;
  answer: string | null;
}

export function lastAnswer(events: RunEvent[]): string | null {
  const response = [...events].reverse().find((event) => event.type === "response");
  return responseDisplay(response?.message);
}
