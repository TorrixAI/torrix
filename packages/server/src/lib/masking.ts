import type { PiiFinding } from "../core/domain";
import { PII_TYPES, parsePiiTypes, scanAndMask } from "./pii";

export interface MaskingSettings {
  pii_enabled: number;
  pii_types: string;
  pii_placeholder: string;
  pii_mask_input: number;
  pii_mask_output: number;
}

export interface MaskingInput {
  request?: string | null;
  response?: string | null;
  prompt?: string | null;
  name?: string | null;
  thinking?: string | null;
  toolCalls?: string | null;
}

export interface MaskingResult {
  request: string | null;
  response: string | null;
  prompt: string | null;
  name: string | null;
  thinking: string | null;
  toolCalls: string | null;
  findings: PiiFinding[];
  masked: boolean;
}

/**
 * Redacts PII from every text field that is about to be persisted, so the
 * stored trace and the events derived from it agree on what was masked. Input
 * fields (request, prompt and the run name, which is derived from the prompt)
 * are gated by `pii_mask_input`, output fields by `pii_mask_output`.
 */
export function applyMasking(settings: MaskingSettings, input: MaskingInput): MaskingResult {
  const unchanged: MaskingResult = {
    request: input.request ?? null,
    response: input.response ?? null,
    prompt: input.prompt ?? null,
    name: input.name ?? null,
    thinking: input.thinking ?? null,
    toolCalls: input.toolCalls ?? null,
    findings: [],
    masked: false,
  };
  if (!settings.pii_enabled) {
    return unchanged;
  }
  // Fail closed: masking is on, so an empty list (a settings row saved before
  // types were chosen, or the database default) means every known type rather
  // than storing the personal data the operator asked to hide.
  const configured = parsePiiTypes(settings.pii_types);
  const types = configured.length ? configured : PII_TYPES;
  const placeholder = settings.pii_placeholder || "[redacted]";
  const merged = new Map<string, PiiFinding>();

  const pass = (text: string | null | undefined, enabled: boolean): string | null => {
    if (!text || !enabled) {
      return text ?? null;
    }
    const res = scanAndMask(text, types, placeholder);
    for (const f of res.findings) {
      const existing = merged.get(f.type);
      if (existing) {
        existing.count += f.count;
      } else {
        merged.set(f.type, { ...f, samples: [...f.samples] });
      }
    }
    return res.text;
  };

  const maskInput = settings.pii_mask_input === 1;
  const maskOutput = settings.pii_mask_output === 1;
  return {
    request: pass(input.request, maskInput),
    prompt: pass(input.prompt, maskInput),
    name: pass(input.name, maskInput),
    response: pass(input.response, maskOutput),
    thinking: pass(input.thinking, maskOutput),
    toolCalls: pass(input.toolCalls, maskOutput),
    findings: [...merged.values()],
    masked: merged.size > 0,
  };
}