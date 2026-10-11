const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-haiku-3-5": { input: 0.8, output: 4.0 },
  "gemini-2-5-pro": { input: 1.25, output: 10.0 },
  "gemini-2-5-flash": { input: 0.3, output: 2.5 },
  "deepseek-r1": { input: 0.55, output: 2.19 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "kimi-k2": { input: 0.6, output: 2.5 },
};

export function detectProvider(targetUrl: string): string {
  const t = targetUrl.toLowerCase();
  if (t.includes("openai.com")) return "openai";
  if (t.includes("anthropic.com")) return "anthropic";
  if (t.includes("googleapis.com")) return "gemini";
  if (t.includes("azure.com")) return "azure";
  if (t.includes("deepseek.com")) return "deepseek";
  if (t.includes("cohere.ai")) return "cohere";
  if (t.includes("mistral.ai")) return "mistral";
  if (t.includes("groq.com")) return "groq";
  if (t.includes("together.ai")) return "together";
  if (t.includes("replicate.com")) return "replicate";
  if (t.includes("ai.cloud.sap")) return "sap";
  if (t.includes("ollama") || t.includes("11434")) return "ollama";
  if (t.includes("jsonplaceholder")) return "test";
  if (t.includes("api.nvidia.com")) return "nvidia";
  if (t.includes("api.perplexity.ai")) return "perplexity";
  if (t.includes("api.fireworks.ai")) return "fireworks";
  if (t.includes("api.openrouter.ai")) return "openrouter";
  return "unknown";
}

export interface CacheTokens {
  read?: number | null;
  write?: number | null;
}

// Anthropic reports prompt-cache reads and writes outside `input_tokens` and
// bills them at 0.1x and 1.25x the input rate. OpenAI-style usage already counts
// cached tokens inside the prompt total, so cache tokens only add cost for Claude.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function calculateCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cache?: CacheTokens,
): number {
  const normalized = normalizeModelName(model);
  const price = findPrice(normalized);
  if (!price) {
    return 0;
  }
  const inTokens = inputTokens ?? 0;
  const outTokens = outputTokens ?? 0;
  let cost = (inTokens / 1_000_000) * price.input + (outTokens / 1_000_000) * price.output;
  if (cache && normalized.toLowerCase().startsWith("claude")) {
    const cacheTokens = (cache.read ?? 0) * CACHE_READ_MULTIPLIER + (cache.write ?? 0) * CACHE_WRITE_MULTIPLIER;
    cost += (cacheTokens / 1_000_000) * price.input;
  }
  return cost;
}

function normalizeModelName(model: string): string {
  return model.replace(/^(openai\/|anthropic\/|google\/|gemini\/|deepseek\/|mistral\/|meta-llama\/|x-ai\/)/, "");
}

/** Spelling-insensitive key: `claude-opus-4.5`, `claude-opus-4-5` and `claude-opus-4-5-20251101` agree. */
function canonicalModel(model: string): string {
  return model.toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");
}

const overrides = new Map<string, { input: number; output: number }>();
const fetched = new Map<string, { input: number; output: number }>();

export function loadPricingOverrides(rows: { model: string; input: number; output: number }[]): void {
  overrides.clear();
  for (const row of rows) {
    if (row.model && Number.isFinite(row.input) && Number.isFinite(row.output)) {
      overrides.set(row.model.toLowerCase(), { input: row.input, output: row.output });
    }
  }
}

export function loadFetchedPricing(rows: { model: string; input: number; output: number }[]): number {
  fetched.clear();
  let count = 0;
  for (const row of rows) {
    const model = row.model.trim().toLowerCase();
    if (!model || model.length > 120 || !Number.isFinite(row.input) || !Number.isFinite(row.output) || row.input < 0 || row.output < 0) {
      continue;
    }
    const price = { input: row.input, output: row.output };
    fetched.set(model, price);
    const bare = model.replace(/^(openai\/|anthropic\/|google\/|gemini\/|deepseek\/|mistral\/|meta-llama\/|x-ai\/)/, "");
    if (bare !== model) {
      fetched.set(bare, price);
    }
    const canonical = canonicalModel(bare);
    if (!fetched.has(canonical)) {
      fetched.set(canonical, price);
    }
    count += 1;
  }
  return count;
}

export function fetchedPricingSize(): number {
  return fetched.size;
}

export function setPricingOverride(model: string, input: number, output: number): void {
  if (model && Number.isFinite(input) && Number.isFinite(output)) {
    overrides.set(model.toLowerCase(), { input, output });
  }
}

export function removePricingOverride(model: string): boolean {
  return overrides.delete(model.toLowerCase());
}

function findPrice(model: string): { input: number; output: number } | null {
  const normalized = model.toLowerCase();
  const override = overrides.get(normalized);
  if (override) {
    return override;
  }
  for (const [key, price] of overrides) {
    if (normalized.startsWith(key)) {
      return price;
    }
  }
  const fetchedExact = fetched.get(normalized) ?? fetched.get(canonicalModel(normalized));
  if (fetchedExact) {
    return fetchedExact;
  }
  for (const [key, price] of fetched) {
    if (normalized.startsWith(key)) {
      return price;
    }
  }
  const exact = PRICING[model];
  if (exact) {
    return exact;
  }
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) {
      return PRICING[key];
    }
  }
  return null;
}

export interface CostComparisonRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export function getCostComparison(inputTokens: number, outputTokens: number): CostComparisonRow[] {
  const rows: CostComparisonRow[] = [];
  const merged = new Map<string, { input: number; output: number }>(Object.entries(PRICING));
  for (const [model, price] of fetched) {
    merged.set(model, price);
  }
  for (const [model, price] of merged) {
    const cost = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
    rows.push({ model, inputTokens, outputTokens, estimatedCost: cost });
  }
  return rows.sort((a, b) => a.estimatedCost - b.estimatedCost);
}