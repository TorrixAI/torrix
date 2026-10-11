import type { Repositories } from "../repos";
import type { Run } from "../core/domain";
import { normalizeCompressionMode, type CompressionMode } from "./compress";
import { calculateCost, getCostComparison } from "./pricing";
import { NO_ASSIST, type Assist } from "../core/extensions";

export type SavingsConfidence = "high" | "medium" | "low";

export type SavingsKind = "slm_downshift" | "prompt_cache" | "compression" | "model_switch";

export interface SavingsEvidence {
  runs?: number;
  models?: string[];
  run_ids?: string[];
}

export interface SavingsRecommendation {
  id: string;
  kind: SavingsKind;
  title: string;
  detail: string;
  monthly_usd: number;
  confidence: SavingsConfidence;
  evidence: SavingsEvidence;
}

export interface SavingsOptions {
  /** Lookback window in days (default 30, clamped to 1..90). */
  days?: number;
  projectId?: string;
  /** Intent clustering for the SLM downshift recommender; omitted means no SLM recommendations. */
  assist?: Assist;
}

export interface SavingsReport {
  window_days: number;
  total_monthly_usd: number;
  recommendations: SavingsRecommendation[];
}

const MAX_SCAN = 5_000;
const MAX_RESULTS = 10;
const MIN_MONTHLY_USD = 0.01;
const MONTH_DAYS = 30;
const MIN_CLUSTER_RUNS = 3;
const MIN_CACHE_RUNS = 2;
const MIN_COMPRESSION_RUNS = 3;
const LARGE_INPUT_TOKENS = 1_000;
/** Conservative share of repeat input cost recovered by provider prompt caching. */
const CACHE_RECOVERY = 0.5;
/** Conservative share of large-input cost removed by prompt compression. */
const COMPRESSION_RECOVERY = 0.1;

function normalizeDays(days: number | undefined): number {
  return Math.min(90, Math.max(1, Math.floor(days ?? 30)));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Projects a window's savings onto a 30-day month. */
function toMonthly(windowSavings: number, days: number): number {
  return round4(windowSavings * (MONTH_DAYS / days));
}

function avg(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distinctModels(runs: Run[]): string[] {
  return [...new Set(runs.map((run) => run.model).filter((model): model is string => Boolean(model)))];
}

/** Actual recorded cost when present, list-price cost otherwise. */
function runCost(run: Run): number {
  const actual = Number(run.cost_usd ?? 0);
  if (actual > 0) {
    return actual;
  }
  return calculateCost(run.model ?? "", run.input_tokens ?? 0, run.output_tokens ?? 0);
}

function dominantModel(runs: Run[]): string | null {
  const counts = new Map<string, number>();
  for (const run of runs) {
    if (!run.model) {
      continue;
    }
    counts.set(run.model, (counts.get(run.model) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

async function slmDownshiftRecommendations(assist: Assist, runs: Run[], days: number): Promise<SavingsRecommendation[]> {
  const clusters = await assist.clusterRunsByIntent(runs);
  const items: SavingsRecommendation[] = [];
  for (const cluster of clusters) {
    if (cluster.runs.length < MIN_CLUSTER_RUNS) {
      continue;
    }
    const dominant = dominantModel(cluster.runs);
    if (!dominant) {
      continue;
    }
    const avgIn = avg(cluster.runs.map((run) => Number(run.input_tokens ?? 0)));
    const avgOut = avg(cluster.runs.map((run) => Number(run.output_tokens ?? 0)));
    const cheaper = getCostComparison(avgIn, avgOut).find((row) => row.model !== dominant);
    if (!cheaper) {
      continue;
    }
    const currentCost = cluster.runs.reduce((sum, run) => sum + runCost(run), 0);
    const alternativeCost = cluster.runs.reduce(
      (sum, run) => sum + calculateCost(cheaper.model, run.input_tokens ?? 0, run.output_tokens ?? 0),
      0,
    );
    const savings = currentCost - alternativeCost;
    if (savings <= 0) {
      continue;
    }
    const share = currentCost > 0 ? savings / currentCost : 0;
    const confidence: SavingsConfidence = cluster.runs.length >= 5 && share >= 0.5 ? "high" : "medium";
    items.push({
      id: `slm:${cluster.key}`,
      kind: "slm_downshift",
      title: `Route a repeated prompt intent to ${cheaper.model}`,
      detail: `${cluster.runs.length} runs share one prompt intent and cost $${currentCost.toFixed(4)} in the last ${days} days; the same tokens at ${cheaper.model} list prices cost about $${alternativeCost.toFixed(4)}, a projected $${toMonthly(savings, days).toFixed(2)} per month.`,
      monthly_usd: toMonthly(savings, days),
      confidence,
      evidence: {
        runs: cluster.runs.length,
        models: distinctModels(cluster.runs),
        run_ids: cluster.runs.slice(0, 10).map((run) => run.id),
      },
    });
  }
  return items.sort((a, b) => b.monthly_usd - a.monthly_usd).slice(0, 4);
}

function promptCacheRecommendations(runs: Run[], days: number): SavingsRecommendation[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const hash = run.prompt_hash?.trim();
    if (!hash) {
      continue;
    }
    const bucket = groups.get(hash) ?? [];
    bucket.push(run);
    groups.set(hash, bucket);
  }
  const items: SavingsRecommendation[] = [];
  for (const [hash, bucket] of groups) {
    if (bucket.length < MIN_CACHE_RUNS) {
      continue;
    }
    const repeats = [...bucket].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(1);
    const repeatInputCost = repeats.reduce(
      (sum, run) => sum + calculateCost(run.model ?? "", run.input_tokens ?? 0, 0),
      0,
    );
    const savings = repeatInputCost * CACHE_RECOVERY;
    if (savings <= 0) {
      continue;
    }
    const confidence: SavingsConfidence = bucket.length >= 5 ? "high" : bucket.length >= 3 ? "medium" : "low";
    items.push({
      id: `cache:${hash}`,
      kind: "prompt_cache",
      title: `Serve a repeated prompt from cache (${bucket.length} calls)`,
      detail: `${bucket.length} runs in the last ${days} days share one prompt hash; assuming a conservative 50% cached-input discount, the ${repeats.length} repeat calls recover about $${toMonthly(savings, days).toFixed(2)} per month.`,
      monthly_usd: toMonthly(savings, days),
      confidence,
      evidence: {
        runs: bucket.length,
        models: distinctModels(bucket),
        run_ids: bucket.slice(0, 10).map((run) => run.id),
      },
    });
  }
  return items.sort((a, b) => b.monthly_usd - a.monthly_usd).slice(0, 3);
}

async function compressionRecommendations(
  repos: Repositories,
  userId: string,
  runs: Run[],
  days: number,
): Promise<SavingsRecommendation[]> {
  const items: SavingsRecommendation[] = [];

  const realized = runs.filter((run) => Number(run.original_input_tokens ?? 0) > Number(run.input_tokens ?? 0));
  if (realized.length) {
    const saved = realized.reduce((sum, run) => {
      const model = run.model ?? "";
      const before = calculateCost(model, Number(run.original_input_tokens), 0);
      const after = calculateCost(model, Number(run.input_tokens), 0);
      return sum + Math.max(0, before - after);
    }, 0);
    if (saved > 0) {
      items.push({
        id: "compression-realized",
        kind: "compression",
        title: "Prompt compression is already cutting input cost",
        detail: `Compression removed input tokens on ${realized.length} runs in the last ${days} days, saving an estimated $${toMonthly(saved, days).toFixed(2)} per month at list prices.`,
        monthly_usd: toMonthly(saved, days),
        confidence: "high",
        evidence: {
          runs: realized.length,
          models: distinctModels(realized),
          run_ids: realized.slice(0, 10).map((run) => run.id),
        },
      });
    }
  }

  const access = await repos.projects.listAccessible(userId);
  const modes = new Map<string, CompressionMode>();
  for (const entry of access) {
    modes.set(entry.project.id, normalizeCompressionMode(entry.project.prompt_compression));
  }
  const candidates = runs.filter((run) => {
    const mode = run.project_id ? modes.get(run.project_id) ?? "off" : "off";
    if (mode !== "off") {
      return false;
    }
    if (Number(run.original_input_tokens ?? 0) > Number(run.input_tokens ?? 0)) {
      return false;
    }
    return Number(run.input_tokens ?? 0) >= LARGE_INPUT_TOKENS;
  });
  if (candidates.length >= MIN_COMPRESSION_RUNS) {
    const inputCost = candidates.reduce(
      (sum, run) => sum + calculateCost(run.model ?? "", run.input_tokens ?? 0, 0),
      0,
    );
    const savings = inputCost * COMPRESSION_RECOVERY;
    if (savings > 0) {
      items.push({
        id: "compression-opportunity",
        kind: "compression",
        title: `Enable prompt compression for ${candidates.length} large-input runs`,
        detail: `Compression is off for these runs and their prompts are large; assuming a conservative 10% input reduction, enabling it per project would save about $${toMonthly(savings, days).toFixed(2)} per month.`,
        monthly_usd: toMonthly(savings, days),
        confidence: "low",
        evidence: {
          runs: candidates.length,
          models: distinctModels(candidates),
          run_ids: candidates.slice(0, 10).map((run) => run.id),
        },
      });
    }
  }

  return items;
}

function modelSwitchRecommendations(runs: Run[], days: number): SavingsRecommendation[] {
  const byModel = new Map<string, Run[]>();
  for (const run of runs) {
    const model = run.model?.trim();
    if (!model) {
      continue;
    }
    const bucket = byModel.get(model) ?? [];
    bucket.push(run);
    byModel.set(model, bucket);
  }
  const items: SavingsRecommendation[] = [];
  for (const [model, bucket] of byModel) {
    if (bucket.length < MIN_CLUSTER_RUNS) {
      continue;
    }
    const avgIn = avg(bucket.map((run) => Number(run.input_tokens ?? 0)));
    const avgOut = avg(bucket.map((run) => Number(run.output_tokens ?? 0)));
    const cheaper = getCostComparison(avgIn, avgOut).find((row) => row.model !== model);
    if (!cheaper) {
      continue;
    }
    const currentCost = bucket.reduce((sum, run) => sum + runCost(run), 0);
    const alternativeCost = bucket.reduce(
      (sum, run) => sum + calculateCost(cheaper.model, run.input_tokens ?? 0, run.output_tokens ?? 0),
      0,
    );
    const savings = currentCost - alternativeCost;
    if (savings <= 0) {
      continue;
    }
    const share = currentCost > 0 ? savings / currentCost : 0;
    const confidence: SavingsConfidence = share >= 0.5 && bucket.length >= 5 ? "medium" : "low";
    items.push({
      id: `switch:${model}`,
      kind: "model_switch",
      title: `Consider ${cheaper.model} for ${model} traffic`,
      detail: `Estimate only: ${bucket.length} runs on ${model} cost $${currentCost.toFixed(4)} in the last ${days} days; the same tokens at ${cheaper.model} list prices cost about $${alternativeCost.toFixed(4)}, a projected $${toMonthly(savings, days).toFixed(2)} per month. Validate quality and provider fit before switching.`,
      monthly_usd: toMonthly(savings, days),
      confidence,
      evidence: {
        runs: bucket.length,
        models: [model, cheaper.model],
        run_ids: bucket.slice(0, 10).map((run) => run.id),
      },
    });
  }
  return items.sort((a, b) => b.monthly_usd - a.monthly_usd).slice(0, 4);
}

/**
 * Ranked, dollar-denominated savings recommendations for the user's runs in
 * the lookback window. Every figure is deterministic: list prices plus the
 * window's recorded costs, projected onto a 30-day month.
 */
export async function recommendSavings(
  repos: Repositories,
  userId: string,
  options: SavingsOptions = {},
): Promise<SavingsRecommendation[]> {
  const days = normalizeDays(options.days);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { runs } = await repos.runs.list(userId, {
    limit: MAX_SCAN,
    offset: 0,
    from: since,
    projectId: options.projectId,
  });
  if (!runs.length) {
    return [];
  }
  const items = [
    ...(await slmDownshiftRecommendations(options.assist ?? NO_ASSIST, runs, days)),
    ...promptCacheRecommendations(runs, days),
    ...(await compressionRecommendations(repos, userId, runs, days)),
    ...modelSwitchRecommendations(runs, days),
  ];
  return items
    .filter((item) => item.monthly_usd > MIN_MONTHLY_USD)
    .sort((a, b) => b.monthly_usd - a.monthly_usd)
    .slice(0, MAX_RESULTS);
}

export async function savingsReport(
  repos: Repositories,
  userId: string,
  options: SavingsOptions = {},
): Promise<SavingsReport> {
  const days = normalizeDays(options.days);
  const recommendations = await recommendSavings(repos, userId, { ...options, days });
  return {
    window_days: days,
    total_monthly_usd: round4(recommendations.reduce((sum, item) => sum + item.monthly_usd, 0)),
    recommendations,
  };
}
