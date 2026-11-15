import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { JudgeSettings, RunJudgment, TraceJudgment } from "../core/domain";
import type { JudgeRepository } from "../core/ports";

export function createJudgeRepository(db: DbClient): JudgeRepository {
  return {
    async getSettings(userId: string): Promise<JudgeSettings | null> {
      const row = await sqlGet<JudgeSettings>(
        db.engine,
        "SELECT * FROM judge_settings WHERE user_id = ? LIMIT 1",
        [userId],
      );
      return row ?? null;
    },

    async saveSettings(userId: string, fields: Partial<JudgeSettings>): Promise<void> {
      const existing = await this.getSettings(userId);
      if (!existing) {
        await insertRow(db.engine, "judge_settings", {
          user_id: userId,
          provider: fields.provider ?? "openai",
          base_url: fields.base_url ?? null,
          model: fields.model ?? null,
          api_key: fields.api_key ?? null,
          criteria: fields.criteria ?? null,
          updated_at: fields.updated_at ?? new Date().toISOString(),
        });
        return;
      }
      await updateById(db.engine, "judge_settings", userId, fields as unknown as Record<string, unknown>, "user_id");
    },

    async addJudgment(judgment: RunJudgment): Promise<void> {
      await insertRow(db.engine, "run_judgments", judgment as unknown as Record<string, unknown>);
    },

    async listJudgments(runId: string): Promise<RunJudgment[]> {
      return sqlAll<RunJudgment>(
        db.engine,
        "SELECT * FROM run_judgments WHERE run_id = ? ORDER BY created_at DESC",
        [runId],
      );
    },

    async sumCostSince(userId: string, sinceIso: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COALESCE((SELECT SUM(cost_usd) FROM run_judgments WHERE user_id = ? AND created_at >= ?), 0) + COALESCE((SELECT SUM(cost_usd) FROM trace_judgments WHERE user_id = ? AND created_at >= ?), 0) AS c",
        [userId, sinceIso, userId, sinceIso],
      );
      return Number(row?.c ?? 0);
    },

    async getTraceJudgment(userId: string, traceId: string): Promise<TraceJudgment | null> {
      return (await sqlGet<TraceJudgment>(db.engine, "SELECT * FROM trace_judgments WHERE user_id = ? AND trace_id = ? LIMIT 1", [userId, traceId])) ?? null;
    },

    async listTraceJudgments(userId: string, traceIds: string[]): Promise<TraceJudgment[]> {
      const ids = [...new Set(traceIds.filter(Boolean))];
      if (!ids.length) return [];
      return sqlAll<TraceJudgment>(
        db.engine,
        `SELECT * FROM trace_judgments WHERE user_id = ? AND trace_id IN (${ids.map(() => "?").join(", ")})`,
        [userId, ...ids],
      );
    },

    async saveTraceJudgment(judgment: TraceJudgment): Promise<void> {
      await sqlRun(
        db.engine,
        `INSERT INTO trace_judgments
          (id, user_id, trace_id, score, reason, confidence, first_failing_run_id, provider, model, criteria, input_tokens, output_tokens, cost_usd, raw, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, trace_id) DO UPDATE SET
          score = excluded.score, reason = excluded.reason, confidence = excluded.confidence,
          first_failing_run_id = excluded.first_failing_run_id, provider = excluded.provider,
          model = excluded.model, criteria = excluded.criteria, input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens, cost_usd = excluded.cost_usd, raw = excluded.raw,
          error = excluded.error, created_at = excluded.created_at`,
        [
          judgment.id, judgment.user_id, judgment.trace_id, judgment.score, judgment.reason,
          judgment.confidence, judgment.first_failing_run_id, judgment.provider, judgment.model,
          judgment.criteria, judgment.input_tokens, judgment.output_tokens, judgment.cost_usd,
          judgment.raw, judgment.error, judgment.created_at,
        ],
      );
    },
  };
}
