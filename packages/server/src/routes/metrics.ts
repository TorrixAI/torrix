import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Repositories } from "../repos";
import type { ServerConfig } from "../core/config";
import type { ExtensionHost } from "../core/extensionHost";
import { extractBearer, authenticateKey } from "../lib/auth";
import { sqlAll } from "../db/sql";

export interface MetricsDeps {
  repos: Repositories;
  config: ServerConfig;
  host?: ExtensionHost;
}

const PERCENTILES = [0.5, 0.95, 0.99] as const;

/**
 * Prometheus text exposition at GET /metrics. Authenticated with a bearer API
 * key, matching the rest of the machine-facing surface. Every series carries a
 * `model` label so Grafana can split spend by model without a recording rule.
 */
export async function metricsRoute(app: FastifyInstance, deps: MetricsDeps): Promise<void> {
  const { repos, config } = deps;

  app.get("/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
    const key = extractBearer(String((request.headers as Record<string, unknown>).authorization ?? ""));
    const auth = key ? await authenticateKey(repos.db, key) : null;
    if (!auth) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const userId = auth.user.id;
    const projectFilter = String((request.query as Record<string, string | undefined>)?.project ?? "");

    const params: (string | number)[] = [userId];
    let projectClause = "";
    if (projectFilter) {
      projectClause = " AND project_id = ?";
      params.push(projectFilter);
    }

    const totals = await sqlAll<{
      model: string;
      source: string;
      runs: number;
      cost: number;
      tokensIn: number;
      tokensOut: number;
      errors: number;
      latencySum: number;
      latencyCount: number;
    }>(
      repos.db.engine,
      `SELECT COALESCE(model, 'unknown') AS model,
              COALESCE(source, 'unknown') AS source,
              COUNT(*) AS runs,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(COALESCE(input_tokens,0)), 0) AS "tokensIn",
              COALESCE(SUM(COALESCE(output_tokens,0)), 0) AS "tokensOut",
              COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors,
              COALESCE(SUM(COALESCE(latency_ms,0)), 0) AS "latencySum",
              COUNT(latency_ms) AS "latencyCount"
       FROM runs
       WHERE user_id = ?${projectClause}
       GROUP BY COALESCE(model, 'unknown'), COALESCE(source, 'unknown')`,
      params,
    );

    const latencySeries = await sqlAll<{ model: string; latency: number }>(
      repos.db.engine,
      `SELECT COALESCE(model, 'unknown') AS model, latency_ms AS latency
       FROM runs
       WHERE user_id = ?${projectClause} AND latency_ms IS NOT NULL
       ORDER BY latency_ms ASC`,
      params,
    );

    const lines: string[] = [];
    lines.push(`# HELP torrix_info Build information for the running Torrix instance.`);
    lines.push(`# TYPE torrix_info gauge`);
    lines.push(`torrix_info{version="${escapeLabel(config.version)}",edition="${escapeLabel(config.edition)}"} 1`);

    lines.push(`# HELP torrix_runs_total Number of logged LLM calls.`);
    lines.push(`# TYPE torrix_runs_total counter`);
    lines.push(`# HELP torrix_run_cost_usd_total Cumulative spend in USD.`);
    lines.push(`# TYPE torrix_run_cost_usd_total counter`);
    lines.push(`# HELP torrix_run_errors_total Calls that returned HTTP >= 400.`);
    lines.push(`# TYPE torrix_run_errors_total counter`);
    lines.push(`# HELP torrix_input_tokens_total Prompt tokens consumed.`);
    lines.push(`# TYPE torrix_input_tokens_total counter`);
    lines.push(`# HELP torrix_output_tokens_total Completion tokens produced.`);
    lines.push(`# TYPE torrix_output_tokens_total counter`);
    lines.push(`# HELP torrix_latency_ms_sum Sum of observed latencies in milliseconds.`);
    lines.push(`# TYPE torrix_latency_ms_sum counter`);
    lines.push(`# HELP torrix_latency_ms_count Number of latency observations.`);
    lines.push(`# TYPE torrix_latency_ms_count counter`);

    for (const row of totals) {
      const labels = `model="${escapeLabel(row.model)}",source="${escapeLabel(row.source)}"`;
      lines.push(`torrix_runs_total{${labels}} ${row.runs}`);
      lines.push(`torrix_run_cost_usd_total{${labels}} ${num(row.cost)}`);
      lines.push(`torrix_run_errors_total{${labels}} ${row.errors}`);
      lines.push(`torrix_input_tokens_total{${labels}} ${row.tokensIn}`);
      lines.push(`torrix_output_tokens_total{${labels}} ${row.tokensOut}`);
      lines.push(`torrix_latency_ms_sum{${labels}} ${row.latencySum}`);
      lines.push(`torrix_latency_ms_count{${labels}} ${row.latencyCount}`);
    }

    lines.push(`# HELP torrix_request_latency_ms Observed call latency by model.`);
    lines.push(`# TYPE torrix_request_latency_ms summary`);
    for (const model of new Set(latencySeries.map((r) => r.model))) {
      const values = latencySeries.filter((r) => r.model === model).map((r) => Number(r.latency));
      if (!values.length) {
        continue;
      }
      const labels = `model="${escapeLabel(model)}"`;
      for (const p of PERCENTILES) {
        const value = percentile(values, p);
        lines.push(`torrix_request_latency_ms{${labels},quantile="${p}"} ${num(value)}`);
      }
      lines.push(`torrix_request_latency_ms_sum{${labels}} ${num(values.reduce((a, b) => a + b, 0))}`);
      lines.push(`torrix_request_latency_ms_count{${labels}} ${values.length}`);
    }

    // Legacy series names kept for dashboards built against earlier releases.
    const allLatencies = latencySeries.map((row) => Number(row.latency));
    const totalRuns = totals.reduce((sum, row) => sum + Number(row.runs), 0);
    const totalCost = totals.reduce((sum, row) => sum + Number(row.cost), 0);
    const totalTokens = totals.reduce((sum, row) => sum + Number(row.tokensIn) + Number(row.tokensOut), 0);
    const totalErrors = totals.reduce((sum, row) => sum + Number(row.errors), 0);
    const modelRuns = new Map<string, number>();
    for (const row of totals) {
      modelRuns.set(row.model, (modelRuns.get(row.model) ?? 0) + Number(row.runs));
    }
    lines.push(`# HELP torrix_requests_total Total logged calls.`);
    lines.push(`# TYPE torrix_requests_total counter`);
    lines.push(`torrix_requests_total ${totalRuns}`);
    lines.push(`# HELP torrix_cost_usd_total Total spend in USD.`);
    lines.push(`# TYPE torrix_cost_usd_total counter`);
    lines.push(`torrix_cost_usd_total ${num(totalCost)}`);
    lines.push(`# HELP torrix_tokens_total Input plus output tokens.`);
    lines.push(`# TYPE torrix_tokens_total counter`);
    lines.push(`torrix_tokens_total ${totalTokens}`);
    lines.push(`# HELP torrix_errors_total Calls that returned HTTP >= 400.`);
    lines.push(`# TYPE torrix_errors_total counter`);
    lines.push(`torrix_errors_total ${totalErrors}`);
    lines.push(`# HELP torrix_latency_p50_ms P50 response latency.`);
    lines.push(`# TYPE torrix_latency_p50_ms gauge`);
    lines.push(`torrix_latency_p50_ms ${num(allLatencies.length ? percentile(allLatencies, 0.5) : 0)}`);
    lines.push(`# HELP torrix_latency_p95_ms P95 response latency.`);
    lines.push(`# TYPE torrix_latency_p95_ms gauge`);
    lines.push(`torrix_latency_p95_ms ${num(allLatencies.length ? percentile(allLatencies, 0.95) : 0)}`);
    lines.push(`# HELP torrix_latency_p99_ms P99 response latency.`);
    lines.push(`# TYPE torrix_latency_p99_ms gauge`);
    lines.push(`torrix_latency_p99_ms ${num(allLatencies.length ? percentile(allLatencies, 0.99) : 0)}`);
    lines.push(`# HELP torrix_requests_by_model Requests per model (top 8).`);
    lines.push(`# TYPE torrix_requests_by_model gauge`);
    for (const [model, count] of [...modelRuns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      lines.push(`torrix_requests_by_model{model="${escapeLabel(model)}"} ${count}`);
    }

    const storedRuns = await sqlAll<{ c: number }>(
      repos.db.engine,
      `SELECT COUNT(*) AS c FROM runs WHERE user_id = ?${projectClause}`,
      params,
    );
    lines.push(`# HELP torrix_stored_runs Runs currently retained in the local database.`);
    lines.push(`# TYPE torrix_stored_runs gauge`);
    lines.push(`torrix_stored_runs ${Number(storedRuns[0]?.c ?? 0)}`);

    const maxRuns = config.editionConfig.maxRuns;
    if (Number.isFinite(maxRuns)) {
      const used = Number(storedRuns[0]?.c ?? 0);
      lines.push(`# HELP torrix_run_capacity_remaining Run slots left under the edition cap.`);
      lines.push(`# TYPE torrix_run_capacity_remaining gauge`);
      lines.push(`torrix_run_capacity_remaining ${Math.max(0, maxRuns - used)}`);
    }

    lines.push(...(await (deps.host?.metricsLines(userId) ?? Promise.resolve([]))));

    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .header("cache-control", "no-store")
      .send(`${lines.join("\n")}\n`);
  });
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function num(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return "0";
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeLabel(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}