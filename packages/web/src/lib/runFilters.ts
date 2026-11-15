import { formatDate } from "./format";

/**
 * The Runs filters the API understands. Grouping, sorting, paging and the
 * project scope are view state, not filters, so they stay out of the chips and
 * out of "Clear all".
 */
export const RUN_FILTER_KEYS = [
  "model",
  "provider",
  "source",
  "from",
  "to",
  "tag",
  "score",
  "is_golden",
  "anomaly",
  "end_user",
  "review_state",
  "status",
  "agent",
  "q",
] as const;

export type RunFilterKey = (typeof RUN_FILTER_KEYS)[number];

export interface RunFilterChip {
  key: RunFilterKey;
  label: string;
  value: string;
}

const LABELS: Record<RunFilterKey, string> = {
  model: "Model",
  provider: "Provider",
  source: "Source",
  from: "From",
  to: "To",
  tag: "Tag",
  score: "Score",
  is_golden: "Golden",
  anomaly: "Anomaly",
  end_user: "End user",
  review_state: "Review",
  status: "Status",
  agent: "Agent",
  q: "Search",
};

export const RUN_SOURCES = [
  "proxy",
  "sdk",
  "playground",
  "eval",
  "mcp",
  "mcp_proxy",
  "mcp_gateway",
  "a2a",
  "otel",
  "dataset",
] as const;

export function dayToIso(day: string, endOfDay = false): string {
  if (!day) return "";
  // The date input is a local calendar day; convert that day's boundaries to
  // UTC so a "from" filter includes the user's whole first day, not 00:00 UTC.
  const date = new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** `datetime-local`/ISO timestamps both collapse to the local day input value. */
export function isoToDay(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function filterValueLabel(key: RunFilterKey, raw: string): string {
  if (!raw) return "";
  switch (key) {
    case "status":
      return raw === "error" ? "Errors" : raw === "200" ? "Success (200)" : raw;
    case "score":
      return raw === "good" ? "Good" : raw === "bad" ? "Bad" : raw === "unscored" ? "Unscored" : raw;
    case "is_golden":
      return raw === "1" || raw === "true" ? "Golden" : raw === "0" || raw === "false" ? "Not golden" : raw;
    case "anomaly":
      return raw === "1" || raw === "true" ? "Anomalies only" : raw;
    case "from":
    case "to":
      return formatDate(raw);
    default:
      return raw;
  }
}

export function activeRunFilters(params: URLSearchParams): RunFilterChip[] {
  return RUN_FILTER_KEYS.flatMap((key) => {
    const raw = params.get(key)?.trim() ?? "";
    if (!raw) return [];
    const value = filterValueLabel(key, raw);
    return value ? [{ key, label: LABELS[key], value }] : [];
  });
}

/** Applies one filter change and drops both list cursors the new results invalidate. */
export function applyRunFilter(params: URLSearchParams, patch: Record<string, string>): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    value ? next.set(key, value) : next.delete(key);
  }
  next.delete("page");
  next.delete("gpage");
  return next;
}

/** Deletes every filter and list cursor, leaving grouping, sort and project scope. */
export function clearRunFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of RUN_FILTER_KEYS) next.delete(key);
  next.delete("page");
  next.delete("gpage");
  next.delete("spage");
  next.delete("tpage");
  return next;
}

export function activeFilterNames(chips: RunFilterChip[]): string {
  if (!chips.length) return "";
  if (chips.length === 1) return chips[0].label.toLowerCase();
  return `${chips.slice(0, -1).map((chip) => chip.label.toLowerCase()).join(", ")} and ${chips[chips.length - 1].label.toLowerCase()}`;
}
