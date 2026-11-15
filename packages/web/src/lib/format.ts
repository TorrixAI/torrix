/**
 * One formatter set for the console. Money, counts, percentages, durations and
 * dates are rendered here so pages cannot drift into local variants.
 */

const countFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const moneyTwo = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFour = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
// Calendar keys from the API (2026-11-08) are UTC days, not instants. Format
// them in UTC so a console in New York does not label the same bucket a day
// earlier than one in Berlin.
const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export type DeltaMetric = "spend" | "errors" | "latency" | "runs" | "score" | "tokens";
export type DeltaTone = "good" | "bad" | "neutral";

/** Money: two decimals at or above $1, four below, grouped above a thousand. */
export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return Math.abs(value) >= 1 ? moneyTwo.format(value) : moneyFour.format(value);
}

/** Full counts use grouping; compact counts are reserved for chart labels. */
export function formatCount(value: number | null | undefined): string {
  return Number.isFinite(value) ? countFormat.format(value ?? 0) : "-";
}

export function formatCompact(value: number | null | undefined): string {
  return Number.isFinite(value) ? compactFormat.format(value ?? 0) : "-";
}

/** Percentage values arrive already multiplied by 100. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(Math.floor(value / 100) / 10).toFixed(1)}s`;
  if (value < 3_600_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.floor((value % 60_000) / 1000);
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (value < 86_400_000) {
    const hours = Math.floor(value / 3_600_000);
    const minutes = Math.floor((value % 3_600_000) / 60_000);
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  const days = Math.floor(value / 86_400_000);
  const hours = Math.floor((value % 86_400_000) / 3_600_000);
  return `${days}d ${hours}h`;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 Oct 2026" in every console surface. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  if (DAY_KEY.test(iso)) {
    const [year, month, day] = iso.split("-").map(Number);
    return dayFormat.format(new Date(Date.UTC(year, month - 1, day)));
  }
  const date = parseDate(iso);
  return date ? dateFormat.format(date) : "-";
}

/** "3 Oct 2026, 14:02" in every console surface. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = parseDate(iso);
  // Some ICU builds join the date and time with " at " instead of ", "; pin the separator.
  return date ? dateTimeFormat.format(date).replace(" at ", ", ") : "-";
}

/**
 * Single meaning-based delta policy. Spend rises are neutral, spend falls can
 * be good; error and latency rises are bad. Runs and token changes stay quiet.
 */
export function deltaTone(metric: DeltaMetric, direction: -1 | 0 | 1): DeltaTone {
  if (direction === 0) return "neutral";
  if (metric === "errors" || metric === "latency") return direction > 0 ? "bad" : "good";
  if (metric === "spend") return direction < 0 ? "good" : "neutral";
  return "neutral";
}

export function deltaArrow(direction: -1 | 0 | 1): string {
  if (direction > 0) return "↑";
  if (direction < 0) return "↓";
  return "→";
}
