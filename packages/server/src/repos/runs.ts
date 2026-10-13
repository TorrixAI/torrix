import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun, type SqlValue } from "../db/sql";
import type { AnalyticsFilter, AnalyticsRow, DashboardFilters, DashboardStats, DashboardWindow, GroupRoot, ListOptions, ObservedAgent, RunChildCount, RunGroupQuery, RunListFilters, RunListSummary, RunRepository, TraceGroup } from "../core/ports";
import type { Run } from "../core/domain";

export function toRunRow(data: Record<string, unknown>): Run {
  return data as unknown as Run;
}

const RUN_COLUMNS = [
  "id", "user_id", "project_id", "name", "provider", "model", "input_tokens", "output_tokens",
  "thinking_tokens", "cache_read_tokens", "cache_creation_tokens", "cost_usd", "latency_ms",
  "status", "finish_reason", "source", "is_golden", "score", "score_note", "scored_at", "run_note",
  "request_body", "request_bytes", "response_bytes", "target_url", "trace_id", "session_id",
  "parent_run_id", "routed_from", "fallback_used", "structured_output", "json_parse_ok",
  "agent_name", "agent_id", "end_user_id", "prompt_hash", "tags", "api_key_id", "dataset_id", "dataset_row_id",
  "share_token", "is_anomaly", "original_input_tokens", "original_request_body", "is_seed",
  "error", "review_state", "pii_masked", "pii_findings", "policy_flags", "share_expires_at", "media_count", "media_assets",
  "retrieval_docs", "intent_cluster", "created_at",
] as const;

export function createRunRepository(db: DbClient): RunRepository {
  const queryGroups = async (
    userId: string,
    kind: "trace" | "session",
    filters: RunListFilters,
    limit: number,
    offset: number,
    includeEmpty: boolean,
  ): Promise<{ groups: TraceGroup[]; total: number }> => {
    const column = kind === "trace" ? "trace_id" : "session_id";
    const where = runListWhere(userId, filters);
    const keyExpr = includeEmpty ? `COALESCE(${column}, '')` : column;
    const emptyClause = includeEmpty ? "" : ` AND ${column} IS NOT NULL AND ${column} != ''`;
    const total = Number(
      (await sqlGet<{ c: number }>(db.engine, `SELECT COUNT(DISTINCT ${keyExpr}) AS c FROM runs WHERE ${where.sql}${emptyClause}`, where.params))?.c ?? 0,
    );
    const rows = await sqlAll<{
      id: string;
      runs: number;
      subagents: number;
      cost: number;
      tokens: number;
      errorCount: number;
      firstAt: string;
      lastAt: string;
    }>(
      db.engine,
      `SELECT ${keyExpr} AS id,
              COUNT(*) AS runs,
              COALESCE(SUM(CASE WHEN parent_run_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS subagents,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS tokens,
              COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount",
              MIN(created_at) AS "firstAt",
              MAX(created_at) AS "lastAt"
       FROM runs
       WHERE ${where.sql}${emptyClause}
       GROUP BY ${keyExpr}
       ORDER BY "lastAt" DESC
       LIMIT ? OFFSET ?`,
      [...where.params, limit, offset],
    );
    const ids = rows.map((r) => String(r.id));
    const facet = new Map<string, { models: Set<string>; agents: Set<string> }>();
    if (ids.length) {
      const marks = ids.map(() => "?").join(", ");
      const members = await sqlAll<{ groupId: string; model: string | null; agent_name: string | null }>(
        db.engine,
        `SELECT ${keyExpr} AS "groupId", model, agent_name FROM runs WHERE ${where.sql} AND ${keyExpr} IN (${marks})`,
        [...where.params, ...ids],
      );
      for (const m of members) {
        const key = String(m.groupId);
        const bucket = facet.get(key) ?? { models: new Set<string>(), agents: new Set<string>() };
        if (m.model) {
          bucket.models.add(String(m.model));
        }
        if (m.agent_name) {
          bucket.agents.add(String(m.agent_name));
        }
        facet.set(key, bucket);
      }
    }
    const groups = rows.map((r) => {
      const extra = facet.get(String(r.id));
      return {
        kind,
        id: String(r.id),
        runs: Number(r.runs),
        subagents: Number(r.subagents),
        cost: Number(r.cost),
        tokens: Number(r.tokens),
        errorCount: Number(r.errorCount),
        firstAt: String(r.firstAt),
        lastAt: String(r.lastAt),
        models: extra ? [...extra.models] : [],
        agents: extra ? [...extra.agents] : [],
      };
    });
    return { groups, total };
  };

  return {
    async save(run: Run): Promise<void> {
      const cols = RUN_COLUMNS.map((c) => `"${c}"`).join(", ");
      const placeholders = RUN_COLUMNS.map(() => "?").join(", ");
      const values: SqlValue[] = RUN_COLUMNS.map((c) => {
        const v = (run as unknown as Record<string, unknown>)[c];
        if (typeof v === "boolean") {
          return v ? 1 : 0;
        }
        if (v === undefined) {
          return null;
        }
        if (v !== null && c === "tags" && typeof v === "object") {
          return JSON.stringify(v);
        }
        return (v as SqlValue) ?? null;
      });
      await sqlRun(db.engine, `INSERT OR IGNORE INTO runs (${cols}) VALUES (${placeholders})`, values);
    },

    async update(id: string, fields: Partial<Run>, ownerId?: string): Promise<void> {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (!entries.length) {
        return;
      }
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values: SqlValue[] = entries.map(([, v]) => {
        if (typeof v === "boolean") {
          return v ? 1 : 0;
        }
        return (v as SqlValue) ?? null;
      });
      values.push(id);
      if (ownerId) {
        values.push(ownerId);
      }
      await sqlRun(db.engine, `UPDATE runs SET ${sets} WHERE id = ?${ownerId ? " AND user_id = ?" : ""}`, values);
    },

    async ownerOf(runId: string): Promise<string | null> {
      const row = await sqlGet<{ user_id: string }>(db.engine, "SELECT user_id FROM runs WHERE id = ?", [runId]);
      return row?.user_id ?? null;
    },

    async getById(runId: string, userId: string): Promise<Run | null> {
      const row = await sqlGet<Record<string, unknown>>(db.engine, "SELECT * FROM runs WHERE id = ? AND user_id = ?", [runId, userId]);
      return row ? toRunRow(row) : null;
    },

    async countRuns(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(db.engine, "SELECT COUNT(*) AS c FROM runs WHERE user_id = ?", [userId]);
      return Number(row?.c ?? 0);
    },

    async countBySource(userId: string, source: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM runs WHERE user_id = ? AND source = ?",
        [userId, source],
      );
      return Number(row?.c ?? 0);
    },

    async countGolden(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM runs WHERE user_id = ? AND is_golden = 1",
        [userId],
      );
      return Number(row?.c ?? 0);
    },

    async deleteOld(userId: string, olderThanDays: number): Promise<number> {
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM runs WHERE user_id = ? AND created_at <= ? AND COALESCE(is_golden, 0) = 0",
        [userId, cutoff],
      );
      await sqlRun(db.engine, "DELETE FROM runs WHERE user_id = ? AND created_at <= ? AND COALESCE(is_golden, 0) = 0", [userId, cutoff]);
      return Number(row?.c ?? 0);
    },

    async dashboardStats(userId: string, filters: DashboardFilters): Promise<DashboardStats> {
      const where = buildWhere(userId, filters);

      const readTotals = async (w: { sql: string; params: SqlValue[] }): Promise<DashboardWindow> => {
        const row = await sqlGet<{
          totalCost: number;
          totalRuns: number;
          totalTokens: number;
          errorCount: number;
          flaggedCount: number;
          avgLatencyMs: number;
          avgScore: number | null;
          scoredCount: number;
        }>(
          db.engine,
          `SELECT
             COALESCE(SUM(cost_usd), 0) AS "totalCost",
             COUNT(*) AS "totalRuns",
             COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS "totalTokens",
             COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount",
             COALESCE(SUM(CASE WHEN review_state IS NOT NULL OR is_anomaly = 1 THEN 1 ELSE 0 END), 0) AS "flaggedCount",
             COALESCE(AVG(latency_ms), 0) AS "avgLatencyMs",
             AVG(CASE WHEN score IS NOT NULL THEN score END) AS "avgScore",
             COUNT(CASE WHEN score IS NOT NULL THEN 1 END) AS "scoredCount"
           FROM runs WHERE ${w.sql}`,
          w.params,
        );
        return {
          totalCost: Number(row?.totalCost ?? 0),
          totalRuns: Number(row?.totalRuns ?? 0),
          totalTokens: Number(row?.totalTokens ?? 0),
          errorCount: Number(row?.errorCount ?? 0),
          flaggedCount: Number(row?.flaggedCount ?? 0),
          avgLatencyMs: Math.round(Number(row?.avgLatencyMs ?? 0)),
          p95LatencyMs: 0,
          avgScore: row?.avgScore == null ? null : Number(row.avgScore),
          scoredCount: Number(row?.scoredCount ?? 0),
        };
      };

      const percentile = async (p: number, w: { sql: string; params: SqlValue[] }): Promise<number> => {
        const countRow = await sqlGet<{ c: number }>(
          db.engine,
          `SELECT COUNT(*) AS c FROM runs WHERE ${w.sql} AND latency_ms IS NOT NULL`,
          w.params,
        );
        const count = Number(countRow?.c ?? 0);
        if (count === 0) {
          return 0;
        }
        const idx = Math.max(0, Math.floor(p * (count - 1)));
        const row = await sqlGet<{ v: number | null }>(
          db.engine,
          `SELECT latency_ms AS v FROM runs WHERE ${w.sql} AND latency_ms IS NOT NULL
           ORDER BY latency_ms ASC LIMIT 1 OFFSET ${idx}`,
          w.params,
        );
        return row ? Number(row.v) : 0;
      };

      const totals = await sqlGet<{
        totalCost: number;
        totalRuns: number;
        totalTokens: number;
        errorCount: number;
        flaggedCount: number;
        avgLatencyMs: number;
        avgScore: number | null;
        scoredCount: number;
      }>(
        db.engine,
        `SELECT
           COALESCE(SUM(cost_usd), 0) AS "totalCost",
           COUNT(*) AS "totalRuns",
           COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS "totalTokens",
           COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount",
           COALESCE(SUM(CASE WHEN review_state IS NOT NULL OR is_anomaly = 1 THEN 1 ELSE 0 END), 0) AS "flaggedCount",
           COALESCE(AVG(latency_ms), 0) AS "avgLatencyMs",
           AVG(CASE WHEN score IS NOT NULL THEN score END) AS "avgScore",
           COUNT(CASE WHEN score IS NOT NULL THEN 1 END) AS "scoredCount"
         FROM runs WHERE ${where.sql}`,
        where.params,
      );
      const totalRuns = Number(totals?.totalRuns ?? 0);

      const perDay = await sqlAll<{ date: string; cost: number; runs: number; tokens: number; errors: number; latencyMs: number | null }>(
        db.engine,
        `SELECT substr(created_at, 1, 10) AS date,
                COALESCE(SUM(cost_usd), 0) AS cost,
                COUNT(*) AS runs,
                COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS tokens,
                COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors,
                AVG(latency_ms) AS "latencyMs"
         FROM runs WHERE ${where.sql}
         GROUP BY substr(created_at, 1, 10) ORDER BY date ASC`,
        where.params,
      );

      const byModel = await sqlAll<{ model: string; runs: number; cost: number }>(
        db.engine,
        `SELECT COALESCE(model, 'unknown') AS model, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost
         FROM runs WHERE ${where.sql}
         GROUP BY COALESCE(model, 'unknown') ORDER BY cost DESC LIMIT 20`,
        where.params,
      );

      const bySource = await sqlAll<{ source: string; runs: number; cost: number }>(
        db.engine,
        `SELECT COALESCE(source, 'direct') AS source, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost
         FROM runs WHERE ${where.sql}
         GROUP BY COALESCE(source, 'direct') ORDER BY runs DESC LIMIT 8`,
        where.params,
      );

      const byAgent = await sqlAll<{ agent: string; runs: number; cost: number; errorCount: number }>(
        db.engine,
        `SELECT COALESCE(agent_name, agent_id) AS agent, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost,
                COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount"
         FROM runs WHERE ${where.sql} AND (agent_name IS NOT NULL OR agent_id IS NOT NULL)
         GROUP BY COALESCE(agent_name, agent_id) ORDER BY runs DESC LIMIT 8`,
        where.params,
      );

      const mcpWhere = `${where.sql} AND source IN ('mcp', 'mcp_gateway', 'mcp_proxy')`;
      const mcpSummary = await sqlGet<{ calls: number; denied: number; pending: number; errorCount: number }>(
        db.engine,
        `SELECT COUNT(*) AS calls,
                COALESCE(SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END), 0) AS denied,
                COALESCE(SUM(CASE WHEN status = 202 THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount"
         FROM runs WHERE ${mcpWhere}`,
        where.params,
      );
      const mcpTools = await sqlAll<{ tool: string; runs: number; cost: number; errorCount: number }>(
        db.engine,
        `SELECT name AS tool, COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS cost,
                COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount"
         FROM runs WHERE ${mcpWhere}
         GROUP BY name ORDER BY runs DESC LIMIT 10`,
        where.params,
      );

      const latencyBucketsRaw = await sqlAll<{ bucket: string; count: number }>(
        db.engine,
        `SELECT CASE
                  WHEN latency_ms < 100 THEN '<100ms'
                  WHEN latency_ms < 250 THEN '100-250ms'
                  WHEN latency_ms < 500 THEN '250-500ms'
                  WHEN latency_ms < 1000 THEN '0.5-1s'
                  WHEN latency_ms < 2000 THEN '1-2s'
                  WHEN latency_ms < 5000 THEN '2-5s'
                  WHEN latency_ms < 10000 THEN '5-10s'
                  ELSE '10s+'
                END AS bucket, COUNT(*) AS count
         FROM runs WHERE ${where.sql} AND latency_ms IS NOT NULL
         GROUP BY bucket`,
        where.params,
      );
      const bucketOrder = ["<100ms", "100-250ms", "250-500ms", "0.5-1s", "1-2s", "2-5s", "5-10s", "10s+"];
      const latencyBuckets = bucketOrder.map((bucket) => ({
        bucket,
        count: Number(latencyBucketsRaw.find((row) => String(row.bucket) === bucket)?.count ?? 0),
      }));

      let previous: DashboardWindow | null = null;
      if (filters.from) {
        const fromMs = Date.parse(filters.from);
        const toMs = filters.to ? Date.parse(filters.to) : Date.now();
        if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
          const prevFrom = new Date(fromMs - (toMs - fromMs)).toISOString();
          const prevWhere = buildWhere(userId, { projectId: filters.projectId, from: prevFrom, to: filters.from });
          const prevTotals = await readTotals(prevWhere);
          previous = { ...prevTotals, p95LatencyMs: await percentile(0.95, prevWhere) };
        }
      }

      return {
        totalCost: Number(totals?.totalCost ?? 0),
        totalRuns,
        totalTokens: Number(totals?.totalTokens ?? 0),
        errorCount: Number(totals?.errorCount ?? 0),
        flaggedCount: Number(totals?.flaggedCount ?? 0),
        avgLatencyMs: Math.round(Number(totals?.avgLatencyMs ?? 0)),
        p50LatencyMs: await percentile(0.5, where),
        p95LatencyMs: await percentile(0.95, where),
        p99LatencyMs: await percentile(0.99, where),
        avgScore: totals?.avgScore == null ? null : Number(totals.avgScore),
        scoredCount: Number(totals?.scoredCount ?? 0),
        previous,
        perDay: perDay.map((d) => ({
          date: String(d.date),
          cost: Number(d.cost),
          runs: Number(d.runs),
          tokens: Number(d.tokens),
          errors: Number(d.errors),
          latencyMs: Math.round(Number(d.latencyMs ?? 0)),
        })),
        byModel: byModel.map((m) => ({ model: String(m.model), runs: Number(m.runs), cost: Number(m.cost) })),
        bySource: bySource.map((s) => ({ source: String(s.source), runs: Number(s.runs), cost: Number(s.cost) })),
        byAgent: byAgent.map((a) => ({
          agent: String(a.agent),
          runs: Number(a.runs),
          cost: Number(a.cost),
          errorCount: Number(a.errorCount),
        })),
        mcp: {
          calls: Number(mcpSummary?.calls ?? 0),
          denied: Number(mcpSummary?.denied ?? 0),
          pending: Number(mcpSummary?.pending ?? 0),
          errorCount: Number(mcpSummary?.errorCount ?? 0),
          tools: mcpTools.map((t) => ({
            tool: displayToolName(String(t.tool)),
            runs: Number(t.runs),
            cost: Number(t.cost),
            errorCount: Number(t.errorCount),
          })),
        },
        latencyBuckets,
      };
    },

    async list(userId: string, opts: ListOptions): Promise<{ runs: Run[]; total: number }> {
      const where = runListWhere(userId, opts);
      const total = Number((await sqlGet<{ c: number }>(db.engine, `SELECT COUNT(*) AS c FROM runs WHERE ${where.sql}`, where.params))?.c ?? 0);
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE ${where.sql} ${orderByClause(opts)} LIMIT ? OFFSET ?`,
        [...where.params, opts.limit, opts.offset],
      );
      return { runs: rows.map(toRunRow), total };
    },

    async listSummary(userId: string, opts: RunListFilters): Promise<RunListSummary> {
      const where = runListWhere(userId, opts);
      const row = await sqlGet<{ agents: number; subagents: number; sessions: number; traces: number }>(
        db.engine,
        `SELECT COUNT(DISTINCT COALESCE(agent_name, agent_id)) AS agents,
                COALESCE(SUM(CASE WHEN parent_run_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS subagents,
                COUNT(DISTINCT session_id) AS sessions,
                COUNT(DISTINCT trace_id) AS traces
         FROM runs WHERE ${where.sql}`,
        where.params,
      );
      return {
        agents: Number(row?.agents ?? 0),
        subagents: Number(row?.subagents ?? 0),
        sessions: Number(row?.sessions ?? 0),
        traces: Number(row?.traces ?? 0),
      };
    },

    async countChildren(userId: string, parentIds: string[]): Promise<RunChildCount[]> {
      const ids = [...new Set(parentIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ parentRunId: string; count: number }>(
        db.engine,
        `SELECT parent_run_id AS "parentRunId", COUNT(*) AS count FROM runs
         WHERE user_id = ? AND parent_run_id IN (${marks}) GROUP BY parent_run_id`,
        [userId, ...ids],
      );
      return rows.map((row) => ({ parentRunId: String(row.parentRunId), count: Number(row.count) }));
    },

    async deleteMany(userId: string, ids: string[]): Promise<number> {
      const owned = [...new Set(ids.filter(Boolean))];
      if (!owned.length) {
        return 0;
      }
      const marks = owned.map(() => "?").join(", ");
      const rows = await sqlAll<{ id: string }>(
        db.engine,
        `SELECT id FROM runs WHERE user_id = ? AND id IN (${marks})`,
        [userId, ...owned],
      );
      const verified = rows.map((row) => row.id);
      if (!verified.length) {
        return 0;
      }
      const idMarks = verified.map(() => "?").join(", ");
      await sqlRun(db.engine, `DELETE FROM events WHERE run_id IN (${idMarks})`, verified);
      await sqlRun(db.engine, `DELETE FROM run_judgments WHERE run_id IN (${idMarks})`, verified);
      await sqlRun(db.engine, `DELETE FROM runs WHERE id IN (${idMarks})`, verified);
      return verified.length;
    },

    async updateScoreMany(userId: string, ids: string[], score: number | null, note: string | null, scoredAt: string | null): Promise<number> {
      const owned = [...new Set(ids.filter(Boolean))];
      if (!owned.length) {
        return 0;
      }
      const marks = owned.map(() => "?").join(", ");
      const rows = await sqlAll<{ id: string }>(
        db.engine,
        `SELECT id FROM runs WHERE user_id = ? AND id IN (${marks})`,
        [userId, ...owned],
      );
      const verified = rows.map((row) => row.id);
      if (!verified.length) {
        return 0;
      }
      const idMarks = verified.map(() => "?").join(", ");
      await sqlRun(
        db.engine,
        `UPDATE runs SET score = ?, score_note = ?, scored_at = ? WHERE id IN (${idMarks})`,
        [score, note, scoredAt, ...verified],
      );
      return verified.length;
    },

    async getByShareToken(token: string): Promise<Run | null> {
      const row = await sqlGet<Record<string, unknown>>(db.engine, "SELECT * FROM runs WHERE share_token = ?", [token]);
      return row ? toRunRow(row) : null;
    },

    async listByShareToken(token: string, limit: number): Promise<Run[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM runs WHERE share_token = ? ORDER BY created_at DESC LIMIT ?",
        [token, limit],
      );
      return rows.map(toRunRow);
    },

    async listGroups(userId: string, kind: "trace" | "session", limit: number): Promise<TraceGroup[]> {
      const { groups } = await queryGroups(userId, kind, {}, limit, 0, false);
      return groups;
    },

    async listGroupsFiltered(
      userId: string,
      kind: "trace" | "session",
      filters: RunListFilters,
      limit: number,
      offset: number,
    ): Promise<{ groups: TraceGroup[]; total: number }> {
      return queryGroups(userId, kind, filters, limit, offset, true);
    },

    async listByGroupIds(
      userId: string,
      kind: "trace" | "session",
      groupIds: string[],
      filters: RunListFilters,
      limit: number,
    ): Promise<Run[]> {
      const column = kind === "trace" ? "trace_id" : "session_id";
      const keys = [...new Set(groupIds)];
      const named = keys.filter((key) => key.length > 0);
      const includeEmpty = keys.some((key) => key.length === 0);
      if (!named.length && !includeEmpty) {
        return [];
      }
      const where = runListWhere(userId, filters);
      const clauses: string[] = [];
      const params: SqlValue[] = [...where.params];
      if (named.length) {
        clauses.push(`${column} IN (${named.map(() => "?").join(", ")})`);
        params.push(...named);
      }
      if (includeEmpty) {
        clauses.push(`(${column} IS NULL OR ${column} = '')`);
      }
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE ${where.sql} AND (${clauses.join(" OR ")}) ORDER BY created_at DESC LIMIT ?`,
        [...params, limit],
      );
      return rows.map(toRunRow);
    },

    async listGroupRoots(userId: string, kind: "trace" | "session", groupIds: string[], projectId?: string): Promise<GroupRoot[]> {
      if (!groupIds.length) {
        return [];
      }
      const column = kind === "trace" ? "trace_id" : "session_id";
      const marks = groupIds.map(() => "?").join(", ");
      const rows = await sqlAll<{ groupId: string; agentName: string | null; requestBody: string | null }>(
        db.engine,
        `SELECT ${column} AS "groupId", agent_name AS "agentName", substr(request_body, 1, 4000) AS "requestBody"
         FROM runs
         WHERE user_id = ? AND ${column} IN (${marks}) AND parent_run_id IS NULL${projectId ? " AND project_id = ?" : ""}
         ORDER BY created_at ASC`,
        projectId ? [userId, ...groupIds, projectId] : [userId, ...groupIds],
      );
      const seen = new Set<string>();
      const out: GroupRoot[] = [];
      for (const row of rows) {
        const key = String(row.groupId);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push({ groupId: key, agentName: row.agentName ?? null, requestBody: row.requestBody ?? null });
      }
      return out;
    },

    async listGroup(userId: string, query: RunGroupQuery): Promise<{ runs: Run[]; total: number }> {
      const column = query.kind === "trace" ? "trace_id" : "session_id";
      const total = Number(
        (await sqlGet<{ c: number }>(db.engine, `SELECT COUNT(*) AS c FROM runs WHERE user_id = ? AND ${column} = ?`, [
          userId,
          query.id,
        ]))?.c ?? 0,
      );
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE user_id = ? AND ${column} = ? ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        [userId, query.id, query.limit, query.offset],
      );
      return { runs: rows.map(toRunRow), total };
    },

    async listByParents(userId: string, parentIds: string[], limit: number): Promise<Run[]> {
      const ids = [...new Set(parentIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE user_id = ? AND parent_run_id IN (${marks}) ORDER BY created_at ASC LIMIT ?`,
        [userId, ...ids, limit],
      );
      return rows.map(toRunRow);
    },

    async listObservedAgents(userId: string, limit: number, projectId?: string): Promise<ObservedAgent[]> {
      const rows = await sqlAll<{
        name: string;
        runs: number;
        tokens: number;
        cost: number;
        errorCount: number;
        firstSeen: string;
        lastSeen: string;
      }>(
        db.engine,
        `SELECT COALESCE(agent_name, agent_id) AS name,
                COUNT(*) AS runs,
                COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0) + COALESCE(thinking_tokens,0)), 0) AS tokens,
                COALESCE(SUM(cost_usd), 0) AS cost,
                COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount",
                MIN(created_at) AS "firstSeen",
                MAX(created_at) AS "lastSeen"
         FROM runs
         WHERE user_id = ? AND (agent_name IS NOT NULL OR agent_id IS NOT NULL)${projectId ? " AND project_id = ?" : ""}
         GROUP BY COALESCE(agent_name, agent_id)
         ORDER BY "lastSeen" DESC
         LIMIT ?`,
        projectId ? [userId, projectId, limit] : [userId, limit],
      );
      return rows.map((row) => ({
        name: String(row.name),
        runs: Number(row.runs),
        tokens: Number(row.tokens),
        cost: Number(row.cost),
        errorCount: Number(row.errorCount),
        firstSeen: String(row.firstSeen),
        lastSeen: String(row.lastSeen),
      }));
    },

    async analyticsByModel(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]> {
      return analyticsQuery(db, userId, filter, "COALESCE(model, 'unknown')", "");
    },

    async analyticsByEndUser(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]> {
      return analyticsQuery(db, userId, filter, "COALESCE(end_user_id, 'anonymous')", " AND end_user_id IS NOT NULL");
    },

    async analyticsByAgent(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]> {
      return analyticsQuery(db, userId, filter, "COALESCE(agent_name, agent_id)", " AND (agent_name IS NOT NULL OR agent_id IS NOT NULL)");
    },

    async analyticsByProject(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]> {
      return analyticsQuery(db, userId, filter, "project_id", " AND project_id IS NOT NULL");
    },

    async spendByProjectSince(since: string): Promise<Array<{ projectId: string; spend: number; runs: number }>> {
      const rows = await sqlAll<{ projectId: string; spend: number; runs: number }>(
        db.engine,
        `SELECT project_id AS "projectId", COALESCE(SUM(cost_usd), 0) AS spend, COUNT(*) AS runs
         FROM runs
         WHERE project_id IS NOT NULL AND created_at >= ?
         GROUP BY project_id`,
        [since],
      );
      return rows.map((row) => ({ projectId: String(row.projectId), spend: Number(row.spend), runs: Number(row.runs) }));
    },

    async analyticsByTool(userId: string, filter: AnalyticsFilter): Promise<AnalyticsRow[]> {
      const key = "REPLACE(REPLACE(name, 'mcp_proxy: ', ''), 'mcp: ', '')";
      return analyticsQuery(
        db,
        userId,
        filter,
        key,
        " AND source IN ('mcp', 'mcp_gateway', 'mcp_proxy')",
        "runs DESC",
      );
    },

    async listGolden(userId: string, limit: number, projectId?: string): Promise<Run[]> {
      const where: SqlValue[] = [userId];
      let clause = "user_id = ? AND is_golden = 1";
      if (projectId) {
        clause += " AND project_id = ?";
        where.push(projectId);
      }
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE ${clause} ORDER BY created_at DESC LIMIT ?`,
        [...where, limit],
      );
      return rows.map(toRunRow);
    },

    async runsSince(userId: string, isoCutoff: string, limit: number, projectId?: string): Promise<Run[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM runs WHERE user_id = ? AND created_at > ?${projectId ? " AND project_id = ?" : ""} ORDER BY created_at ASC LIMIT ?`,
        projectId ? [userId, isoCutoff, projectId, limit] : [userId, isoCutoff, limit],
      );
      return rows.map(toRunRow);
    },
  };
}

function buildWhere(userId: string, filters: DashboardFilters): { sql: string; params: SqlValue[] } {
  const where: string[] = ["user_id = ?"];
  const params: SqlValue[] = [userId];
  if (filters.projectId) {
    where.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.from) {
    where.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("created_at <= ?");
    params.push(filters.to);
  }
  return { sql: where.join(" AND "), params };
}

function runListWhere(userId: string, opts: RunListFilters): { sql: string; params: SqlValue[] } {
  const where: string[] = ["user_id = ?"];
  const params: SqlValue[] = [userId];
  if (opts.projectId) {
    where.push("project_id = ?");
    params.push(opts.projectId);
  }
  if (opts.source) {
    where.push("source = ?");
    params.push(opts.source);
  }
  if (opts.model) {
    where.push("model = ?");
    params.push(opts.model);
  }
  if (opts.provider) {
    where.push("provider = ?");
    params.push(opts.provider);
  }
  if (opts.status === "error") {
    where.push("status >= 400");
  } else if (typeof opts.status === "number" && Number.isFinite(opts.status)) {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.from) {
    where.push("created_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("created_at <= ?");
    params.push(opts.to);
  }
  if (opts.tag) {
    where.push("tags LIKE ?");
    params.push(`%${opts.tag}%`);
  }
  if (opts.isGolden === true) {
    where.push("is_golden = 1");
  } else if (opts.isGolden === false) {
    where.push("COALESCE(is_golden, 0) = 0");
  }
  if (opts.sessionId) {
    where.push("session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts.traceId) {
    where.push("trace_id = ?");
    params.push(opts.traceId);
  }
  if (opts.agentName) {
    where.push("agent_name = ?");
    params.push(opts.agentName);
  }
  if (opts.endUserId) {
    where.push("end_user_id = ?");
    params.push(opts.endUserId);
  }
  if (opts.reviewState) {
    where.push("review_state = ?");
    params.push(opts.reviewState);
  }
  if (opts.anomalyOnly) {
    where.push("is_anomaly = 1");
  }
  if (opts.score === "good") {
    where.push("score >= 1");
  } else if (opts.score === "bad") {
    where.push("score <= 0");
  } else if (opts.score === "unscored") {
    where.push("score IS NULL");
  }
  if (opts.search) {
    const like = `%${opts.search}%`;
    if (opts.deepSearch) {
      where.push("(name LIKE ? OR model LIKE ? OR run_note LIKE ? OR score_note LIKE ? OR request_body LIKE ?)");
      params.push(like, like, like, like, like);
    } else {
      where.push("(name LIKE ? OR model LIKE ? OR run_note LIKE ? OR score_note LIKE ?)");
      params.push(like, like, like, like);
    }
  }
  return { sql: where.join(" AND "), params };
}

const SORT_COLUMNS: Record<string, string> = {
  created: "created_at",
  created_at: "created_at",
  cost: "cost_usd",
  cost_usd: "cost_usd",
  latency: "latency_ms",
  latency_ms: "latency_ms",
  tokens: "(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0))",
  score: "score",
  status: "status",
  name: "name",
};

function orderByClause(opts: Pick<ListOptions, "sort" | "dir">): string {
  const column = SORT_COLUMNS[opts.sort ?? ""] ?? "created_at";
  const direction = opts.dir === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${column} ${direction}`;
}

function displayToolName(name: string): string {
  return name.replace(/^mcp_proxy:\s*/, "").replace(/^mcp:\s*/, "");
}

async function analyticsQuery(
  db: DbClient,
  userId: string,
  filter: AnalyticsFilter,
  keyExpression: string,
  extraWhere: string,
  orderBy = "cost DESC",
): Promise<AnalyticsRow[]> {
  const days = Math.min(365, Math.max(1, Math.floor(filter.days ?? 30)));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const params: SqlValue[] = [userId, since];
  let where = "user_id = ? AND created_at >= ?";
  if (filter.projectId) {
    where += " AND project_id = ?";
    params.push(filter.projectId);
  }
  const rows = await sqlAll<{
    key: string;
    runs: number;
    cost: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    errorCount: number;
    avgLatencyMs: number | null;
    avgScore: number | null;
  }>(
    db.engine,
    `SELECT ${keyExpression} AS key,
            COUNT(*) AS runs,
            COALESCE(SUM(cost_usd), 0) AS cost,
            COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)), 0) AS tokens,
            COALESCE(SUM(COALESCE(input_tokens,0)), 0) AS "inputTokens",
            COALESCE(SUM(COALESCE(output_tokens,0)), 0) AS "outputTokens",
            COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS "errorCount",
            AVG(latency_ms) AS "avgLatencyMs",
            AVG(CASE WHEN score IS NOT NULL THEN score END) AS "avgScore"
     FROM runs WHERE ${where}${extraWhere}
     GROUP BY ${keyExpression}
     ORDER BY ${orderBy}
     LIMIT 100`,
    params,
  );
  return rows.map((row) => ({
    key: String(row.key),
    runs: Number(row.runs),
    cost: Number(row.cost),
    tokens: Number(row.tokens),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    errorCount: Number(row.errorCount),
    avgLatencyMs: Math.round(Number(row.avgLatencyMs ?? 0)),
    avgScore: row.avgScore == null ? null : Number(row.avgScore),
  }));
}