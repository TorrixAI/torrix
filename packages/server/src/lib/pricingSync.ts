import type { Repositories } from "../repos";
import { loadFetchedPricing } from "./pricing";

export interface FetchedPrice {
  model: string;
  input: number;
  output: number;
}

export interface PricingSyncOptions {
  openRouterUrl?: string;
  liteLlmUrl?: string;
  timeoutMs?: number;
}

export interface PricingSyncResult {
  source: "openrouter" | "litellm" | "stored" | "none";
  models: number;
  fetchedAt: string | null;
}

const DEFAULT_OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DEFAULT_TIMEOUT_MS = 10_000;

function perMillionFromTokenPrice(value: unknown): number | null {
  const perToken = Number(value);
  if (!Number.isFinite(perToken) || perToken < 0) {
    return null;
  }
  return Math.round(perToken * 1_000_000 * 1_000_000) / 1_000_000;
}

export async function fetchOpenRouterPricing(url: string, timeoutMs: number): Promise<FetchedPrice[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`openrouter ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
  };
  const rows: FetchedPrice[] = [];
  for (const item of json.data ?? []) {
    const input = perMillionFromTokenPrice(item.pricing?.prompt);
    const output = perMillionFromTokenPrice(item.pricing?.completion);
    if (item.id && input != null && output != null) {
      rows.push({ model: item.id, input, output });
    }
  }
  return rows;
}

export async function fetchLiteLlmPricing(url: string, timeoutMs: number): Promise<FetchedPrice[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`litellm ${res.status}`);
  }
  const json = (await res.json()) as Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }>;
  const rows: FetchedPrice[] = [];
  for (const [model, info] of Object.entries(json)) {
    const input = perMillionFromTokenPrice(info?.input_cost_per_token);
    const output = perMillionFromTokenPrice(info?.output_cost_per_token);
    if (input != null && output != null) {
      rows.push({ model, input, output });
    }
  }
  return rows;
}

/**
 * Refreshes the fetched pricing layer: OpenRouter first, LiteLLM as the
 * fallback cascade, persisted in instance_config so restarts keep the table.
 * Never throws: an unreachable source falls back to the stored copy.
 */
export async function syncLivePricing(repos: Repositories, options: PricingSyncOptions = {}): Promise<PricingSyncResult> {
  const openRouterUrl = options.openRouterUrl ?? DEFAULT_OPENROUTER_URL;
  const liteLlmUrl = options.liteLlmUrl ?? DEFAULT_LITELLM_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let rows: FetchedPrice[] = [];
  let source: PricingSyncResult["source"] = "none";
  try {
    rows = await fetchOpenRouterPricing(openRouterUrl, timeoutMs);
    if (rows.length) {
      source = "openrouter";
    }
  } catch {
    rows = [];
  }
  if (!rows.length) {
    try {
      rows = await fetchLiteLlmPricing(liteLlmUrl, timeoutMs);
      if (rows.length) {
        source = "litellm";
      }
    } catch {
      rows = [];
    }
  }
  if (!rows.length) {
    return loadStoredPricing(repos);
  }

  const models = loadFetchedPricing(rows);
  const fetchedAt = new Date().toISOString();
  try {
    await repos.instance.set("pricing_fetched", JSON.stringify(rows));
    await repos.instance.set("pricing_fetched_at", fetchedAt);
  } catch {
    // persistence is best-effort; the in-memory layer still works
  }
  return { source, models, fetchedAt };
}

export async function loadStoredPricing(repos: Repositories): Promise<PricingSyncResult> {
  try {
    const stored = await repos.instance.get("pricing_fetched");
    if (!stored) {
      return { source: "none", models: 0, fetchedAt: null };
    }
    const parsed = JSON.parse(stored) as FetchedPrice[];
    const models = Array.isArray(parsed) ? loadFetchedPricing(parsed) : 0;
    return {
      source: models ? "stored" : "none",
      models,
      fetchedAt: (await repos.instance.get("pricing_fetched_at")) ?? null,
    };
  } catch {
    return { source: "none", models: 0, fetchedAt: null };
  }
}
