export const PROMPT_NAME_RE = /^[a-zA-Z0-9._-]{1,80}$/;

export interface PromptRef {
  name: string;
  revision: number | null;
}

export function parsePromptRef(ref: string): PromptRef | null {
  const idx = ref.lastIndexOf(":");
  if (idx === -1) {
    return PROMPT_NAME_RE.test(ref.trim()) ? { name: ref.trim(), revision: null } : null;
  }
  const name = ref.slice(0, idx).trim();
  const revRaw = ref.slice(idx + 1).trim();
  if (!PROMPT_NAME_RE.test(name) || !/^[1-9]\d*$/.test(revRaw)) {
    return null;
  }
  return { name, revision: Number(revRaw) };
}

export function extractVariables(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function mergeVariables(explicit: string[], template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...explicit, ...extractVariables(template)]) {
    const trimmed = v.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g");
    out = out.replace(re, value);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}