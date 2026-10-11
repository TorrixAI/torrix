import type { GovernanceSettings, PiiFinding, PiiType } from "../core/domain";

export interface PiiDetector {
  type: PiiType;
  pattern: RegExp;
  /** Replacement keeps the shape readable (last 4 digits) so traces stay debuggable. */
  render: (match: RegExpExecArray, placeholder: string) => string;
}

const detectors: PiiDetector[] = [
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    render: (m, p) => `${p}(email:${m[0].split("@")[1] ?? "?"})`,
  },
  {
    type: "card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    render: (m, p) => `${p}(card:****${m[0].replace(/\D/g, "").slice(-4)})`,
  },
  {
    type: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    render: (_m, p) => `${p}(ssn)`,
  },
  {
    type: "iban",
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    render: (m, p) => `${p}(iban:****${m[0].slice(-4)})`,
  },
  {
    type: "passport",
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    render: (_m, p) => `${p}(passport)`,
  },
  {
    type: "phone",
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?\b/g,
    render: (m, p) => `${p}(phone:****${m[0].replace(/\D/g, "").slice(-2)})`,
  },
  {
    type: "ipv4",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    render: (_m, p) => `${p}(ip)`,
  },
  {
    type: "postal",
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    render: (_m, p) => `${p}(postal)`,
  },
  {
    type: "api_key",
    pattern: /\b(?:sk|pk|rk|key|ghp|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/g,
    render: (_m, p) => `${p}(key)`,
  },
];

const byType = new Map(detectors.map((d) => [d.type, d]));

export const PII_TYPES: PiiType[] = detectors.map((d) => d.type);

export function parsePiiTypes(raw: string): PiiType[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((t): t is PiiType => typeof t === "string" && byType.has(t as PiiType));
  } catch {
    return [];
  }
}

export interface PiiScanResult {
  text: string;
  findings: PiiFinding[];
  masked: boolean;
}

export function scanAndMask(text: string, types: PiiType[], placeholder: string): PiiScanResult {
  if (!text || !types.length) {
    return { text, findings: [], masked: false };
  }
  let out = text;
  const findings: PiiFinding[] = [];
  let masked = false;
  for (const type of types) {
    const detector = byType.get(type);
    if (!detector) {
      continue;
    }
    const samples: string[] = [];
    let count = 0;
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    out = out.replace(pattern, (match) => {
      const groups = pattern.exec(match);
      const exec = groups ?? ([match] as unknown as RegExpExecArray);
      count += 1;
      if (samples.length < 3) {
        samples.push(maskSample(match));
      }
      return detector.render(exec, placeholder);
    });
    if (count) {
      masked = true;
      findings.push({ type, count, samples });
    }
  }
  return { text: out, findings, masked };
}

function maskSample(raw: string): string {
  if (raw.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.min(6, raw.length - 2))}${raw.slice(-2)}`;
}

/**
 * Masks PII inside an arbitrary JSON value by walking it and rewriting every
 * string leaf. Keys are left intact so the trace structure stays readable.
 */
export function maskJsonValue<T>(value: T, types: PiiType[], placeholder: string): { value: T; findings: PiiFinding[] } {
  const merged = new Map<PiiType, PiiFinding>();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const res = scanAndMask(node, types, placeholder);
      for (const f of res.findings) {
        const existing = merged.get(f.type);
        if (existing) {
          existing.count += f.count;
          for (const s of f.samples) {
            if (existing.samples.length < 3 && !existing.samples.includes(s)) {
              existing.samples.push(s);
            }
          }
        } else {
          merged.set(f.type, { type: f.type, count: f.count, samples: [...f.samples] });
        }
      }
      return res.text;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };
  return { value: walk(value) as T, findings: [...merged.values()] };
}

export function settingsTypes(settings: GovernanceSettings): PiiType[] {
  return parsePiiTypes(settings.pii_types);
}

export function summarizeFindings(findings: PiiFinding[]): string {
  if (!findings.length) {
    return "";
  }
  return findings.map((f) => `${f.type}:${f.count}`).join(", ");
}