export type CapTone = "ok" | "warn" | "limit";

export interface CapUsage {
  spend: number;
  cap: number;
  /** Raw percentage; may exceed 100 when the cap is already crossed. */
  rawPct: number;
  /** Bar width percentage, clamped to 100. */
  pct: number;
  remaining: number;
  tone: CapTone;
  label: string;
}

/**
 * Spend against a hard cap. 80% is "near" and 100% is "reached"; the label is
 * the semantic state so colour is never the only signal.
 */
export function capUsage(spend: number, cap: number | null | undefined): CapUsage | null {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) return null;
  const safeSpend = Number.isFinite(spend) ? Math.max(0, spend) : 0;
  const rawPct = (safeSpend / cap) * 100;
  const tone: CapTone = rawPct >= 100 ? "limit" : rawPct >= 80 ? "warn" : "ok";
  return {
    spend: safeSpend,
    cap,
    rawPct,
    pct: Math.min(100, Math.max(0, rawPct)),
    remaining: Math.max(0, cap - safeSpend),
    tone,
    label: tone === "limit" ? "Cap reached" : tone === "warn" ? "Near cap" : "Within cap",
  };
}
