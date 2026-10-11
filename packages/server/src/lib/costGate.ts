import type { Repositories } from "../repos";
import { sqlGet } from "../db/sql";
import { hasNotificationChannel, notifyChannels, type NotifyDeps } from "./notify";

export interface CostContext {
  userId: string;
  projectId: string | null;
  apiKeyId: string | null;
}

export interface CostGateDeps {
  repos: Repositories;
  notify?: NotifyDeps;
}

const ALERT_BUDGET_LEVELS = [0.5, 0.8, 1.0];
const ANOMALY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ANOMALY_COOLDOWN_MS = 60 * 60 * 1000;
const ANOMALY_MIN_BASELINE_RUNS = 10;
const ANOMALY_MIN_COST_USD = 0.001;

export function monthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00.000Z`;
}

export function spendSince(repos: Repositories, userId: string, since: string, scope: "user" | "project" | "api_key" = "user", scopeId?: string): Promise<number> {
  const base = "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM runs WHERE user_id = ? AND created_at >= ?";
  let query = base;
  if (scope === "project") {
    query = `${base} AND project_id = ?`;
  } else if (scope === "api_key") {
    query = `${base} AND api_key_id = ? AND api_key_id IS NOT NULL`;
  }
  return sqlGet<{ total: number }>(repos.db.engine, query, scopeId ? [userId, since, scopeId] : [userId, since]).then((row) => Number(row?.total ?? 0));
}

export interface HardCapRow {
  cap: number | null;
  spend: number;
}

export async function effectiveHardCap(deps: CostGateDeps, ctx: CostContext): Promise<HardCapRow> {
  const since = monthStart();
  const settings = await deps.repos.alerts.getByUser(ctx.userId);
  const candidates: HardCapRow[] = [];

  if (settings.hard_cap_usd != null) {
    candidates.push({ cap: settings.hard_cap_usd, spend: await spendSince(deps.repos, ctx.userId, since) });
  }

  if (ctx.projectId) {
    const project = await deps.repos.projects.findById(ctx.projectId);
    if (project && project.hard_cap_usd != null) {
      candidates.push({
        cap: project.hard_cap_usd,
        spend: await spendSince(deps.repos, ctx.userId, since, "project", project.id),
      });
    }
  }

  if (ctx.apiKeyId) {
    const key = await deps.repos.apiKeys.getById(ctx.apiKeyId);
    if (key && key.hard_cap_usd != null) {
      candidates.push({
        cap: key.hard_cap_usd,
        spend: await spendSince(deps.repos, ctx.userId, since, "api_key", key.id),
      });
    }
  }

  const defined = candidates.filter((c): c is { cap: number; spend: number } => c.cap != null && Number.isFinite(c.cap));
  if (!defined.length) {
    return { cap: null, spend: 0 };
  }
  const utilization = (row: { cap: number; spend: number }): number => (row.cap > 0 ? row.spend / row.cap : Number.POSITIVE_INFINITY);
  const binding = defined.reduce((a, b) => (utilization(b) > utilization(a) ? b : a));
  return { cap: binding.cap, spend: binding.spend };
}

export async function checkHardCap(deps: CostGateDeps, ctx: CostContext): Promise<{ blocked: boolean; cap: number | null; spend: number }> {
  const { cap, spend } = await effectiveHardCap(deps, ctx);
  if (cap !== null && spend >= cap) {
    return { blocked: true, cap, spend };
  }
  return { blocked: false, cap, spend };
}

export interface EvalRunOutcome {
  isAnomaly: boolean;
  alertSent: boolean;
}

export interface RunAlertMeta {
  runId?: string | null;
  model?: string | null;
  status?: number | null;
  error?: string | null;
}

interface BudgetCandidate {
  scope: "user" | "project" | "api_key";
  scopeId: string | null;
  scopeName: string;
  budget: number;
  spend: number;
}

export async function evaluateRunCost(
  deps: CostGateDeps,
  ctx: CostContext,
  runCostUsd: number,
  meta: RunAlertMeta = {},
): Promise<EvalRunOutcome> {
  const settings = await deps.repos.alerts.getByUser(ctx.userId);
  if (!settings.enabled) {
    return { isAnomaly: false, alertSent: false };
  }

  const hasChannel = hasNotificationChannel(settings);
  const statusOk = meta.status == null || meta.status < 400;
  let alertSent = false;
  let isAnomaly = false;

  if (hasChannel && !statusOk && settings.notify_on_error) {
    const payload = buildErrorAlert({
      runId: meta.runId ?? null,
      model: meta.model ?? null,
      status: Number(meta.status),
      detail: meta.error ?? null,
    });
    void notifyChannels(settings, payload, deps.notify);
    alertSent = true;
  }

  if (hasChannel) {
    const since = monthStart();
    const scopeBudgets: BudgetCandidate[] = [];
    if (settings.budget_usd != null && settings.budget_usd > 0) {
      scopeBudgets.push({
        scope: "user",
        scopeId: null,
        scopeName: "Account",
        budget: settings.budget_usd,
        spend: await spendSince(deps.repos, ctx.userId, since),
      });
    }
    if (ctx.projectId) {
      const project = await deps.repos.projects.findById(ctx.projectId);
      if (project && project.budget_usd != null && project.budget_usd > 0) {
        scopeBudgets.push({
          scope: "project",
          scopeId: project.id,
          scopeName: project.name,
          budget: project.budget_usd,
          spend: await spendSince(deps.repos, ctx.userId, since, "project", project.id),
        });
      }
    }
    if (ctx.apiKeyId) {
      const key = await deps.repos.apiKeys.getById(ctx.apiKeyId);
      if (key && key.budget_usd != null && key.budget_usd > 0) {
        scopeBudgets.push({
          scope: "api_key",
          scopeId: key.id,
          scopeName: key.name,
          budget: key.budget_usd,
          spend: await spendSince(deps.repos, ctx.userId, since, "api_key", key.id),
        });
      }
    }

    const projected = scopeBudgets
      .map((b) => ({ ...b, ratio: (b.spend + Math.max(0, runCostUsd)) / b.budget }))
      .filter((b) => b.ratio >= ALERT_BUDGET_LEVELS[0]);
    if (projected.length) {
      const top = projected.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      const level = crossedBudgetLevel(top.ratio);
      if (level != null && shouldFireBudgetAlert(settings, level)) {
        const payload = buildBudgetAlert({
          scope: top.scope,
          scopeId: top.scopeId,
          scopeName: top.scopeName,
          spend: top.spend,
          runCostUsd,
          budget: top.budget,
          level,
        });
        void notifyChannels(settings, payload, deps.notify);
        await deps.repos.alerts.touchAlert(ctx.userId, level);
        alertSent = true;
      }
    }
  }

  if (settings.anomaly_enabled && settings.anomaly_multiplier > 0 && runCostUsd >= ANOMALY_MIN_COST_USD && meta.model) {
    const baseline = await modelCostBaseline(deps, ctx.userId, meta.model, meta.runId ?? null);
    if (baseline != null && baseline > 0 && runCostUsd > baseline * settings.anomaly_multiplier) {
      isAnomaly = true;
      if (hasChannel && !(await inAnomalyCooldown(deps, ctx.userId, meta.model))) {
        const payload = buildAnomalyAlert(settings, {
          runId: meta.runId ?? null,
          model: meta.model,
          runCostUsd,
          baseline,
          multiplier: settings.anomaly_multiplier,
          factor: runCostUsd / baseline,
        });
        void notifyChannels(settings, payload, deps.notify);
        await deps.repos.alerts.touchAnomalyCooldown(ctx.userId, meta.model);
        alertSent = true;
      }
    }
  }

  return { isAnomaly, alertSent };
}

function crossedBudgetLevel(ratio: number): number | null {
  let crossed: number | null = null;
  for (const level of ALERT_BUDGET_LEVELS) {
    if (ratio >= level) {
      crossed = level;
    }
  }
  return crossed;
}

function shouldFireBudgetAlert(
  settings: { last_alert_at: string | null; last_alert_level: number | null },
  level: number,
): boolean {
  if (!settings.last_alert_at) {
    return true;
  }
  const last = new Date(settings.last_alert_at).getTime();
  if (!Number.isFinite(last)) {
    return true;
  }
  const sameUtcDay = settings.last_alert_at.slice(0, 10) === new Date().toISOString().slice(0, 10);
  if (!sameUtcDay) {
    return true;
  }
  return (settings.last_alert_level ?? 0) < level;
}

async function modelCostBaseline(
  deps: CostGateDeps,
  userId: string,
  model: string,
  excludeRunId: string | null,
): Promise<number | null> {
  const since = new Date(Date.now() - ANOMALY_WINDOW_MS).toISOString();
  let where = "user_id = ? AND model = ? AND created_at >= ? AND cost_usd > 0";
  const params: (string | number)[] = [userId, model, since];
  if (excludeRunId) {
    where += " AND id <> ?";
    params.push(excludeRunId);
  }
  const countRow = await sqlGet<{ c: number }>(deps.repos.db.engine, `SELECT COUNT(*) AS c FROM runs WHERE ${where}`, params);
  const count = Number(countRow?.c ?? 0);
  if (count < ANOMALY_MIN_BASELINE_RUNS) {
    return null;
  }
  const idx = Math.max(0, Math.floor(0.95 * (count - 1)));
  const row = await sqlGet<{ v: number }>(
    deps.repos.db.engine,
    `SELECT cost_usd AS v FROM runs WHERE ${where} ORDER BY cost_usd ASC LIMIT 1 OFFSET ${idx}`,
    params,
  );
  return row ? Number(row.v) : null;
}

async function inAnomalyCooldown(deps: CostGateDeps, userId: string, model: string): Promise<boolean> {
  const last = await deps.repos.alerts.getAnomalyCooldown(userId, model);
  if (!last) {
    return false;
  }
  const ts = new Date(last).getTime();
  return Number.isFinite(ts) && Date.now() - ts < ANOMALY_COOLDOWN_MS;
}

export function buildBudgetAlert(data: {
  scope: "user" | "project" | "api_key";
  scopeId: string | null;
  scopeName: string;
  spend: number;
  runCostUsd: number;
  budget: number;
  level: number;
}): Record<string, unknown> {
  const scopeLabel = data.scope === "api_key" ? "API key" : data.scope;
  return {
    event: "cost.budget",
    message: `Monthly spend for ${scopeLabel} "${data.scopeName}" has reached ${Math.round(data.level * 100)}% of budget`,
    scope: data.scope,
    scope_id: data.scopeId,
    scope_name: data.scopeName,
    spend_usd: roundMoney(data.spend + Math.max(0, data.runCostUsd)),
    budget_usd: roundMoney(data.budget),
    level: data.level,
    usage_pct: Math.round(data.level * 100),
  };
}

export function buildAnomalyAlert(
  _settings: { webhook_url: string | null },
  data: { runId: string | null; model: string; runCostUsd: number; baseline: number; multiplier: number; factor: number },
): Record<string, unknown> {
  return {
    event: "cost.anomaly",
    message: "A run exceeded the model cost baseline",
    run_id: data.runId,
    model: data.model,
    run_cost_usd: roundMoney(data.runCostUsd),
    baseline_p95_usd: roundMoney(data.baseline),
    multiplier: data.multiplier,
    factor: Math.round(data.factor * 10) / 10,
  };
}

export function buildErrorAlert(data: { runId?: string | null; model?: string | null; status: number; detail?: string | null }): Record<string, unknown> {
  return {
    event: "run.error",
    message: "A run failed",
    run_id: data.runId ?? null,
    model: data.model ?? null,
    http_status: data.status,
    detail: data.detail ?? null,
  };
}

export { dispatchWebhook } from "./notify";

function roundMoney(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface DigestResult {
  sent: boolean;
  payload: Record<string, unknown> | null;
}

export async function runWeeklyDigest(deps: CostGateDeps, userId: string, force = false): Promise<DigestResult> {
  const settings = await deps.repos.alerts.getByUser(userId);
  if (!force && (!settings.digest_enabled || !hasNotificationChannel(settings))) {
    return { sent: false, payload: null };
  }
  if (!force && settings.last_digest_sent_at) {
    const last = new Date(settings.last_digest_sent_at).getTime();
    if (Number.isFinite(last) && Date.now() - last < SEVEN_DAYS_MS) {
      return { sent: false, payload: null };
    }
  }
  if (!hasNotificationChannel(settings)) {
    return { sent: false, payload: null };
  }

  const from = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
  const since = monthStart();
  const stats = await deps.repos.runs.dashboardStats(userId, { from });
  const priorFrom = new Date(Date.now() - 2 * SEVEN_DAYS_MS).toISOString();
  const prior = await deps.repos.runs.dashboardStats(userId, { from: priorFrom, to: from });
  const monthSpend = await spendSince(deps.repos, userId, since);
  const payload = {
    event: "cost.weekly_digest",
    period_start: from.slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
    runs: stats.totalRuns,
    cost_usd: roundMoney(stats.totalCost),
    month_spend_usd: roundMoney(monthSpend),
    tokens: stats.totalTokens,
    errors: stats.errorCount,
    error_rate: stats.totalRuns ? Math.round((100 * stats.errorCount) / stats.totalRuns) : 0,
    avg_latency_ms: Math.round(stats.avgLatencyMs),
    top_models: stats.byModel.slice(0, 3).map((m) => `${m.model}:$${roundMoney(m.cost)}`),
    vs_prior_week: {
      cost_change_pct: percentChange(stats.totalCost, prior.totalCost),
      runs_change_pct: percentChange(stats.totalRuns, prior.totalRuns),
    },
    week_start: from.slice(0, 10),
  };
  await notifyChannels(settings, payload, deps.notify);
  await deps.repos.alerts.touchDigest(userId);
  return { sent: true, payload };
}

function percentChange(current: number, prior: number): number | null {
  if (prior <= 0) {
    return null;
  }
  return Math.round(((current - prior) / prior) * 1000) / 10;
}