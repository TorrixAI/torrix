import type { Repositories } from "../repos";
import type { Run, SlmOpportunity } from "../core/domain";
import { calculateCost } from "./pricing";
import { extractUserPrompt } from "./extract";
import { NO_ASSIST, type Assist } from "../core/extensions";

const MAX_SCAN = 5_000;
const PREFIX_CHARS = 240;
const CACHE_DISCOUNT = 0.1;

export interface CachingInsight {
  promptPrefix: string;
  calls: number;
  avgInputTokens: number;
  potentialSavingsUsd: number;
  sampleRunId: string | null;
}

export interface CachingReport {
  windowDays: number;
  runsScanned: number;
  repeatedGroups: CachingInsight[];
  totalPotentialSavingsUsd: number;
}

function extractPrefix(requestBody: string | null | undefined): string | null {
  if (!requestBody) {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(requestBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  const messages = parsed.messages;
  if (!Array.isArray(messages)) {
    return null;
  }
  const parts: string[] = [];
  for (const message of messages) {
    const entry = (message ?? {}) as { role?: string; content?: unknown };
    if (entry.role !== "system" && entry.role !== "user") {
      break;
    }
    if (typeof entry.content === "string") {
      parts.push(entry.content);
    }
    if (entry.role === "user") {
      break;
    }
  }
  if (!parts.length) {
    return null;
  }
  const prefix = parts.join("\n").trim();
  return prefix ? prefix.slice(0, PREFIX_CHARS) : null;
}

export async function cachingInsights(repos: Repositories, userId: string, days = 7): Promise<CachingReport> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const runs = await repos.runs.runsSince(userId, since, MAX_SCAN);
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const prefix = extractPrefix(run.request_body);
    if (!prefix) {
      continue;
    }
    const bucket = groups.get(prefix) ?? [];
    bucket.push(run);
    groups.set(prefix, bucket);
  }
  const repeated: CachingInsight[] = [];
  for (const [prefix, bucket] of groups) {
    if (bucket.length < 3) {
      continue;
    }
    let inputTokens = 0;
    let baseline = 0;
    for (const run of bucket) {
      const tokens = run.input_tokens ?? 0;
      inputTokens += tokens;
      baseline += calculateCost(run.model ?? "", tokens, 0);
    }
    const fullCost = baseline;
    const cachedCost = baseline * CACHE_DISCOUNT;
    repeated.push({
      promptPrefix: prefix.slice(0, 160),
      calls: bucket.length,
      avgInputTokens: Math.round(inputTokens / bucket.length),
      potentialSavingsUsd: Number((fullCost - cachedCost).toFixed(4)),
      sampleRunId: bucket[0]?.id ?? null,
    });
  }
  repeated.sort((a, b) => b.potentialSavingsUsd - a.potentialSavingsUsd);
  const trimmed = repeated.slice(0, 10);
  return {
    windowDays: days,
    runsScanned: runs.length,
    repeatedGroups: trimmed,
    totalPotentialSavingsUsd: Number(trimmed.reduce((sum, row) => sum + row.potentialSavingsUsd, 0).toFixed(4)),
  };
}

export interface SlmSavingsReport {
  opportunities: SlmOpportunity[];
  totalSpendUsd: number;
  estimatedSavingsUsd: number;
}

export async function slmSavingsInsights(assist: Assist, userId: string): Promise<SlmSavingsReport> {
  const opportunities = await assist.slmOpportunities(userId);
  const totalSpendUsd = Number(opportunities.reduce((sum, item) => sum + item.spendUsd, 0).toFixed(4));
  return {
    opportunities: opportunities.slice(0, 10),
    totalSpendUsd,
    estimatedSavingsUsd: Number((totalSpendUsd * 0.7).toFixed(4)),
  };
}

export interface InsightsAgentRow {
  name: string;
  runs: number;
  cost: number;
  errorCount: number;
}

export interface InsightsMcpToolRow {
  tool: string;
  runs: number;
  cost: number;
}

export interface InsightsMcpRollup {
  calls: number;
  denied: number;
  pending: number;
  errorCount: number;
  tools: InsightsMcpToolRow[];
}

export interface InsightsAction {
  label: string;
  href: string;
  detail: string;
}

export interface InsightsReport {
  windowDays: number;
  generatedAt: string;
  spendUsd: number;
  priorSpendUsd: number | null;
  runs: number;
  errorRate: number;
  anomalyCount: number;
  topModel: { model: string; runs: number; cost: number } | null;
  topAgent: { name: string; runs: number; cost: number } | null;
  agents: InsightsAgentRow[];
  mcp: InsightsMcpRollup;
  caching: CachingReport;
  slm: SlmSavingsReport;
  highlights: string[];
  /** Clickable next steps derived from the window's numbers. */
  actions: InsightsAction[];
  /** "judge" when the configured judge LLM wrote the bullets, otherwise rules. */
  generatedWith: "rules" | "judge";
  /** Judge token cost for the last generation, tracked separately from app spend. */
  judgeCostUsd: number;
}

export interface InsightsOptions {
  /** Attempt judge-written bullets when the judge is configured (default true). */
  useJudge?: boolean;
  assist?: Assist;
}

export async function generateInsights(
  repos: Repositories,
  userId: string,
  days = 7,
  options: InsightsOptions = {},
): Promise<InsightsReport> {
  const assist = options.assist ?? NO_ASSIST;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const stats = await repos.runs.dashboardStats(userId, { from });
  const anomalies = await repos.runs.list(userId, { limit: 1, offset: 0, anomalyOnly: true });
  const caching = await cachingInsights(repos, userId, days);
  const slm = await slmSavingsInsights(assist, userId);
  const topModel = stats.byModel[0] ? { model: stats.byModel[0].model, runs: stats.byModel[0].runs, cost: stats.byModel[0].cost } : null;
  const agents: InsightsAgentRow[] = stats.byAgent.map((row) => ({
    name: row.agent,
    runs: row.runs,
    cost: row.cost,
    errorCount: row.errorCount,
  }));
  const mcp: InsightsMcpRollup = {
    calls: stats.mcp.calls,
    denied: stats.mcp.denied,
    pending: stats.mcp.pending,
    errorCount: stats.mcp.errorCount,
    tools: stats.mcp.tools.map((row) => ({ tool: row.tool, runs: row.runs, cost: row.cost })),
  };
  const topAgent = agents[0] ? { name: agents[0].name, runs: agents[0].runs, cost: agents[0].cost } : null;
  const errorRate = stats.totalRuns ? Number(((stats.errorCount / stats.totalRuns) * 100).toFixed(1)) : 0;
  let highlights: string[] = [];
  if (stats.previous && stats.previous.totalCost > 0) {
    const delta = ((stats.totalCost - stats.previous.totalCost) / stats.previous.totalCost) * 100;
    if (Math.abs(delta) >= 10) {
      highlights.push(`Spend is ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(0)}% versus the prior ${days}-day window.`);
    }
  }
  if (topModel) {
    highlights.push(`Top cost driver: ${topModel.model} with $${topModel.cost.toFixed(2)} across ${topModel.runs} runs.`);
  }
  if (topAgent) {
    highlights.push(`Top agent: ${topAgent.name} with ${topAgent.runs} runs and $${topAgent.cost.toFixed(2)}.`);
  }
  if (mcp.calls > 0) {
    highlights.push(
      `MCP traffic: ${mcp.calls} tool call${mcp.calls === 1 ? "" : "s"}, ${mcp.denied} denied, ${mcp.pending} awaiting approval.`,
    );
  }
  if (errorRate >= 5) {
    highlights.push(`Error rate is ${errorRate}% (${stats.errorCount} of ${stats.totalRuns} runs). Review failing models and policies.`);
  }
  if (anomalies.total > 0) {
    highlights.push(`${anomalies.total} run${anomalies.total === 1 ? "" : "s"} exceeded the cost baseline. Check the anomalies filter on the runs page.`);
  }
  if (caching.totalPotentialSavingsUsd > 0) {
    highlights.push(`Repeated prompt prefixes could save about $${caching.totalPotentialSavingsUsd.toFixed(2)} with provider prompt caching.`);
  }
  if (slm.estimatedSavingsUsd > 0) {
    highlights.push(`Routing simple clusters to a smaller model could save about $${slm.estimatedSavingsUsd.toFixed(2)}.`);
  }
  if (!highlights.length) {
    highlights.push("No cost, error or routing concerns in this window.");
  }

  const actions: InsightsAction[] = [];
  if (stats.errorCount > 0) {
    actions.push({
      label: `Review ${stats.errorCount} failed run${stats.errorCount === 1 ? "" : "s"}`,
      href: "/ui/runs?status=error",
      detail: `${errorRate}% error rate`,
    });
  }
  if (anomalies.total > 0) {
    actions.push({
      label: `Inspect ${anomalies.total} cost anomal${anomalies.total === 1 ? "y" : "ies"}`,
      href: "/ui/runs?anomaly=1",
      detail: "above the 30-day p95 baseline",
    });
  }
  if (caching.totalPotentialSavingsUsd > 0) {
    actions.push({
      label: "Apply prompt caching",
      href: "/ui/insights#caching",
      detail: `$${caching.totalPotentialSavingsUsd.toFixed(2)} potential savings`,
    });
  }
  if (slm.estimatedSavingsUsd > 0) {
    actions.push({
      label: "Route simple clusters to a smaller model",
      href: "/ui/governance",
      detail: `$${slm.estimatedSavingsUsd.toFixed(2)} estimated savings`,
    });
  }
  if (mcp.denied > 0) {
    actions.push({
      label: `Review ${mcp.denied} denied MCP call${mcp.denied === 1 ? "" : "s"}`,
      href: "/ui/runs?source=mcp_gateway",
      detail: "blocked by authorization policy",
    });
  }
  if (mcp.pending > 0) {
    actions.push({
      label: `Resolve ${mcp.pending} held approval${mcp.pending === 1 ? "" : "s"}`,
      href: "/ui/agents/approvals",
      detail: "waiting on a human decision",
    });
  }
  if (topAgent) {
    actions.push({
      label: `Drill into ${topAgent.name}`,
      href: `/ui/runs?agent=${encodeURIComponent(topAgent.name)}`,
      detail: `${topAgent.runs} runs · $${topAgent.cost.toFixed(2)}`,
    });
  }
  if (topModel && topModel.model !== "unknown") {
    actions.push({
      label: `Inspect ${topModel.model} runs`,
      href: `/ui/runs?model=${encodeURIComponent(topModel.model)}`,
      detail: `${topModel.runs} runs · $${topModel.cost.toFixed(2)}`,
    });
  }

  let generatedWith: "rules" | "judge" = "rules";
  let judgeCostUsd = 0;
  if (options.useJudge !== false) {
    try {
      const completion = await assist.complete(userId, {
        system:
          "You are an operations analyst for an LLM observability platform. Reply with exactly 3 to 5 bullet lines, each starting with \"- \", under 140 characters. Every bullet must name a concrete finding with numbers and end with one recommended action. Never restate a total without an implication, and never write filler such as \"no anomalies were detected\" unless it changes what the operator should do. No preamble, no headings, no code fences.",
        user: JSON.stringify({
          windowDays: days,
          spendUsd: Number(stats.totalCost.toFixed(4)),
          priorSpendUsd: stats.previous ? Number(stats.previous.totalCost.toFixed(4)) : null,
          runs: stats.totalRuns,
          errorRate,
          anomalies: anomalies.total,
          topModel,
          topAgent,
          topModels: stats.byModel.slice(0, 5),
          topAgents: agents.slice(0, 5),
          mcp: {
            calls: mcp.calls,
            denied: mcp.denied,
            pending: mcp.pending,
            errorCount: mcp.errorCount,
            topTools: mcp.tools.slice(0, 5),
          },
          cachingSavingsUsd: caching.totalPotentialSavingsUsd,
          slmSavingsUsd: slm.estimatedSavingsUsd,
          suggestedActions: actions.map((action) => action.label),
        }),
      });
      const bullets = (completion?.text ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("-"))
        .map((line) => line.replace(/^-\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 5);
      if (completion && !completion.error && bullets.length) {
        highlights = bullets;
        generatedWith = "judge";
        judgeCostUsd = completion.costUsd;
        try {
          await repos.judge.addJudgment({
            id: crypto.randomUUID(),
            run_id: "insights",
            user_id: userId,
            provider: completion.provider,
            model: completion.model,
            criteria: "insights",
            score: null,
            rationale: `insight generation (${days}d, ${bullets.length} bullets)`,
            input_tokens: completion.inputTokens,
            output_tokens: completion.outputTokens,
            cost_usd: completion.costUsd,
            raw: null,
            error: null,
            created_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error("insight cost persist failed", err);
        }
      }
    } catch (err) {
      console.error("insight generation via judge failed", err);
    }
  }

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    spendUsd: Number(stats.totalCost.toFixed(4)),
    priorSpendUsd: stats.previous ? Number(stats.previous.totalCost.toFixed(4)) : null,
    runs: stats.totalRuns,
    errorRate,
    anomalyCount: anomalies.total,
    topModel,
    topAgent,
    agents,
    mcp,
    caching,
    slm,
    highlights,
    actions,
    generatedWith,
    judgeCostUsd: Number(judgeCostUsd.toFixed(6)),
  };
}

const insightsCacheKey = (userId: string): string => `insights_cache:${userId}`;

export async function loadCachedInsights(repos: Repositories, userId: string): Promise<InsightsReport | null> {
  try {
    const raw = await repos.instance.get(insightsCacheKey(userId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { report?: InsightsReport };
    const report = parsed?.report;
    if (
      !report ||
      typeof report.generatedAt !== "string" ||
      !Array.isArray(report.highlights) ||
      !Array.isArray(report.agents) ||
      !Array.isArray(report.actions) ||
      !report.mcp
    ) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
}

/**
 * Cached-on-demand entry point: returns the stored report when present,
 * otherwise generates (and stores) one. `force` regenerates and replaces it,
 * which is what the console's Generate button uses.
 */
export async function getInsights(
  repos: Repositories,
  userId: string,
  days = 7,
  force = false,
  assist: Assist = NO_ASSIST,
): Promise<InsightsReport> {
  if (!force) {
    const cached = await loadCachedInsights(repos, userId);
    if (cached && cached.windowDays === days) {
      return cached;
    }
  }
  const report = await generateInsights(repos, userId, days, { useJudge: true, assist });
  try {
    await repos.instance.set(insightsCacheKey(userId), JSON.stringify({ generatedAt: report.generatedAt, report }));
  } catch (err) {
    console.error("insights cache write failed", err);
  }
  return report;
}

/* ------------------------------------------------------------------ traces */

export interface TraceInsightsReport {
  kind: "trace" | "session";
  id: string;
  generatedAt: string;
  runs: number;
  costUsd: number;
  tokens: number;
  errorCount: number;
  spanMs: number;
  agents: string[];
  models: string[];
  highlights: string[];
  generatedWith: "rules" | "judge";
  judgeCostUsd: number;
}

const traceInsightsCacheKey = (userId: string, kind: string, id: string): string =>
  `trace_insights:${userId}:${kind}:${id}`;

async function collectGroupRuns(repos: Repositories, userId: string, kind: "trace" | "session", id: string): Promise<Run[]> {
  const { runs } = await repos.runs.listGroup(userId, { kind, id, limit: 200, offset: 0 });
  const seen = new Map<string, Run>(runs.map((run) => [run.id, run]));
  let frontier = runs.map((run) => run.id);
  while (frontier.length && seen.size < 300) {
    const children = await repos.runs.listByParents(userId, frontier.slice(0, 100), 200);
    const fresh: string[] = [];
    for (const child of children) {
      if (!seen.has(child.id)) {
        seen.set(child.id, child);
        fresh.push(child.id);
      }
    }
    if (!fresh.length) {
      break;
    }
    frontier = fresh;
  }
  return [...seen.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function loadCachedTraceInsights(
  repos: Repositories,
  userId: string,
  kind: "trace" | "session",
  id: string,
): Promise<TraceInsightsReport | null> {
  try {
    const raw = await repos.instance.get(traceInsightsCacheKey(userId, kind, id));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { report?: TraceInsightsReport };
    const report = parsed?.report;
    if (!report || typeof report.generatedAt !== "string" || !Array.isArray(report.highlights)) {
      return null;
    }
    return report;
  } catch {
    return null;
  }
}

export async function generateTraceInsights(
  repos: Repositories,
  userId: string,
  kind: "trace" | "session",
  id: string,
  assist: Assist = NO_ASSIST,
): Promise<TraceInsightsReport | null> {
  const runs = await collectGroupRuns(repos, userId, kind, id);
  if (!runs.length) {
    return null;
  }
  const eventCounts = await repos.events.countByRunIds(runs.map((run) => run.id));
  const toolsByRun = new Map<string, number>();
  const thinkingByRun = new Map<string, number>();
  for (const row of eventCounts) {
    if (row.type === "tool_call") {
      toolsByRun.set(row.runId, (toolsByRun.get(row.runId) ?? 0) + Number(row.count));
    } else if (row.type === "thinking") {
      thinkingByRun.set(row.runId, (thinkingByRun.get(row.runId) ?? 0) + Number(row.count));
    }
  }
  const agents = [...new Set(runs.map((run) => run.agent_name ?? run.agent_id ?? "").filter(Boolean))];
  const models = [...new Set(runs.map((run) => run.model ?? "").filter(Boolean))];
  const costUsd = runs.reduce((sum, run) => sum + Number(run.cost_usd ?? 0), 0);
  const tokens = runs.reduce((sum, run) => sum + Number(run.input_tokens ?? 0) + Number(run.output_tokens ?? 0), 0);
  const errors = runs.filter((run) => run.status != null && run.status >= 400);
  const toolCalls = runs.reduce((sum, run) => sum + (toolsByRun.get(run.id) ?? 0), 0);
  const thinking = runs.filter((run) => (run.thinking_tokens ?? 0) > 0 || (thinkingByRun.get(run.id) ?? 0) > 0).length;
  const starts = runs.map((run) => Date.parse(run.created_at)).filter(Number.isFinite);
  const spanMs = starts.length ? Date.now() - Math.min(...starts) : 0;
  const slowest = [...runs].sort((a, b) => Number(b.latency_ms ?? 0) - Number(a.latency_ms ?? 0))[0];
  const priciest = [...runs].sort((a, b) => Number(b.cost_usd ?? 0) - Number(a.cost_usd ?? 0))[0];
  const responseSnippet = runs
    .map((run) => extractUserPrompt(run.request_body))
    .find((prompt): prompt is string => Boolean(prompt))
    ?.slice(0, 300) ?? null;

  let highlights: string[] = [];
  highlights.push(
    `${runs.length} run${runs.length === 1 ? "" : "s"} across ${agents.length} agent${agents.length === 1 ? "" : "s"} and ${models.length} model${models.length === 1 ? "" : "s"}: $${costUsd.toFixed(4)} and ${tokens.toLocaleString()} tokens.`,
  );
  if (slowest && Number(slowest.latency_ms ?? 0) > 0) {
    highlights.push(`Slowest step: ${slowest.name ?? slowest.id} at ${Math.round(Number(slowest.latency_ms))}ms${slowest.model ? ` (${slowest.model})` : ""}.`);
  }
  if (priciest && Number(priciest.cost_usd ?? 0) > 0 && runs.length > 1) {
    highlights.push(`Most expensive step: ${priciest.name ?? priciest.id} at $${Number(priciest.cost_usd).toFixed(4)}.`);
  }
  if (errors.length) {
    highlights.push(`${errors.length} step${errors.length === 1 ? "" : "s"} failed (${errors.map((run) => run.status).join(", ")}); check the error events above.`);
  }
  if (toolCalls || thinking) {
    highlights.push(`${toolCalls} tool call${toolCalls === 1 ? "" : "s"} and ${thinking} reasoning step${thinking === 1 ? "" : "s"} recorded.`);
  }
  if (!errors.length && runs.length > 1) {
    highlights.push("No failing steps; the flow completed without policy or upstream errors.");
  }
  if (!highlights.length) {
    highlights.push("Single run captured; no multi-step flow to summarize.");
  }

  let generatedWith: "rules" | "judge" = "rules";
  let judgeCostUsd = 0;
  try {
    const completion = await assist.complete(userId, {
      system:
        "You are an agent-operations analyst. Explain what this trace/session did and give 2 to 4 concrete improvements. Reply with 3 to 6 bullet lines, each starting with \"- \", under 140 characters. No preamble, no headings.",
      user: JSON.stringify({
        kind,
        id,
        runs: runs.length,
        agents,
        models,
        costUsd: Number(costUsd.toFixed(6)),
        tokens,
        errorCount: errors.length,
        toolCalls,
        reasoningSteps: thinking,
        steps: runs.slice(0, 40).map((run) => ({
          name: run.name,
          agent: run.agent_name,
          model: run.model,
          status: run.status,
          cost_usd: run.cost_usd,
          latency_ms: run.latency_ms,
          input_tokens: run.input_tokens,
          output_tokens: run.output_tokens,
          parent: run.parent_run_id,
        })),
        firstPrompt: responseSnippet,
      }),
    });
    const bullets = (completion?.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 6);
    if (completion && !completion.error && bullets.length) {
      highlights = bullets;
      generatedWith = "judge";
      judgeCostUsd = completion.costUsd;
      try {
        await repos.judge.addJudgment({
          id: crypto.randomUUID(),
          run_id: "insights",
          user_id: userId,
          provider: completion.provider,
          model: completion.model,
          criteria: `${kind} insights`,
          score: null,
          rationale: `${kind} insight generation (${id.slice(0, 12)}, ${bullets.length} bullets)`,
          input_tokens: completion.inputTokens,
          output_tokens: completion.outputTokens,
          cost_usd: completion.costUsd,
          raw: null,
          error: null,
          created_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error("trace insight cost persist failed", err);
      }
    }
  } catch (err) {
    console.error("trace insight generation via judge failed", err);
  }

  const report: TraceInsightsReport = {
    kind,
    id,
    generatedAt: new Date().toISOString(),
    runs: runs.length,
    costUsd: Number(costUsd.toFixed(6)),
    tokens,
    errorCount: errors.length,
    spanMs,
    agents,
    models,
    highlights,
    generatedWith,
    judgeCostUsd: Number(judgeCostUsd.toFixed(6)),
  };
  try {
    await repos.instance.set(traceInsightsCacheKey(userId, kind, id), JSON.stringify({ generatedAt: report.generatedAt, report }));
  } catch (err) {
    console.error("trace insights cache write failed", err);
  }
  return report;
}
