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
    pattern: /\b(?:sk|pk|rk|key|ghp|gho|ghu|ghs|ghr|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    render: (_m, p) => `${p}(key)`,
  },
  {
    type: "aws_access_key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    render: (_m, p) => `${p}(aws_access_key)`,
  },
  {
    type: "aws_secret",
    pattern: /\baws[_-]?(?:secret|secret[_-]?access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/gi,
    render: (_m, p) => `${p}(aws_secret)`,
  },
  {
    type: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    render: (_m, p) => `${p}(google_api_key)`,
  },
  {
    type: "private_key",
    pattern: /-----BEGIN [A-Z0-9 ]{0,30}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z0-9 ]{0,30}PRIVATE KEY-----/g,
    render: (_m, p) => `${p}(private_key)`,
  },
  {
    type: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    render: (_m, p) => `${p}(jwt)`,
  },
  {
    type: "bearer_token",
    pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
    render: (_m, p) => `${p}(bearer)`,
  },
];

const byType = new Map(detectors.map((d) => [d.type, d]));

export const PII_TYPES: PiiType[] = detectors.map((d) => d.type);

/** High-confidence credential shapes used by the stored-secret warning. */
export const SECRET_TYPES: PiiType[] = [
  "api_key",
  "aws_access_key",
  "aws_secret",
  "google_api_key",
  "private_key",
  "jwt",
  "bearer_token",
];

/** SQL prefilter tokens; detectors still make the final decision. */
export const SECRET_CANDIDATE_TOKENS = [
  "github_pat_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "AKIA",
  "ASIA",
  "aws_secret",
  "aws-secret",
  "AIza",
  "-----BEGIN",
  "eyJ",
  "Authorization:",
  "Bearer ",
];

export function containsSecret(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  for (const type of SECRET_TYPES) {
    const detector = byType.get(type);
    if (!detector) {
      continue;
    }
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

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