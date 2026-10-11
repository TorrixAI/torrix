export type CompressionMode = "off" | "conservative" | "balanced";

const BUILTIN_FILLERS = [
  "thanks in advance",
  "as an ai language model",
  "i would like you to",
  "i want you to",
  "could you please",
  "if you don't mind",
  "thank you",
  "thanks",
  "kindly",
  "please",
];

export function normalizeCompressionMode(raw: unknown): CompressionMode {
  return raw === "conservative" || raw === "balanced" ? raw : "off";
}

export function parseCompressionWords(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeFillers(text: string, words: string[]): string {
  let out = text;
  const ordered = [...words].sort((a, b) => b.length - a.length);
  for (const word of ordered) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b[\\s,.;:!?]*`, "gi"), " ");
  }
  return collapseWhitespace(out);
}

function compressText(text: string, mode: CompressionMode, words: string[]): string {
  if (mode === "conservative") {
    return collapseWhitespace(text);
  }
  return removeFillers(text, words);
}

export interface CompressionResult {
  body: Record<string, unknown>;
  changed: boolean;
  originalText: string;
  compressedText: string;
}

/**
 * Shrinks the text parts of an OpenAI/Anthropic/Gemini request body without
 * touching structure, media or tool definitions. Returns the original text so
 * the run can keep a pre-compression copy.
 */
export function compressRequestBody(
  body: Record<string, unknown>,
  mode: CompressionMode,
  customWords: string[] = [],
): CompressionResult {
  if (mode === "off") {
    return { body, changed: false, originalText: "", compressedText: "" };
  }
  const words = mode === "balanced" ? [...BUILTIN_FILLERS, ...customWords] : customWords;
  const clone = structuredClone(body);
  const before: string[] = [];
  const after: string[] = [];
  const compress = (value: string): string => {
    const next = compressText(value, mode, words);
    before.push(value);
    after.push(next);
    return next;
  };

  const messages = clone.messages;
  if (Array.isArray(messages)) {
    for (const message of messages as Array<Record<string, unknown>>) {
      if (typeof message.content === "string") {
        message.content = compress(message.content);
      } else if (Array.isArray(message.content)) {
        for (const part of message.content as Array<Record<string, unknown>>) {
          if (typeof part.text === "string") {
            part.text = compress(part.text);
          }
        }
      }
    }
  }
  if (typeof clone.system === "string") {
    clone.system = compress(clone.system);
  }
  const contents = clone.contents;
  if (Array.isArray(contents)) {
    for (const entry of contents as Array<Record<string, unknown>>) {
      if (!Array.isArray(entry.parts)) {
        continue;
      }
      for (const part of entry.parts as Array<Record<string, unknown>>) {
        if (typeof part.text === "string") {
          part.text = compress(part.text);
        }
      }
    }
  }
  const systemInstruction = clone.systemInstruction as Record<string, unknown> | undefined;
  if (systemInstruction && Array.isArray(systemInstruction.parts)) {
    for (const part of systemInstruction.parts as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") {
        part.text = compress(part.text);
      }
    }
  }

  const changed = before.some((value, index) => value !== after[index]);
  return { body: clone, changed, originalText: before.join("\n"), compressedText: after.join("\n") };
}
