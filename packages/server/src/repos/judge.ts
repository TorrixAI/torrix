import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, updateById } from "../db/sql";
import type { JudgeSettings, RunJudgment } from "../core/domain";
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
        "SELECT COALESCE(SUM(cost_usd), 0) AS c FROM run_judgments WHERE user_id = ? AND created_at >= ?",
        [userId, sinceIso],
      );
      return Number(row?.c ?? 0);
    },
  };
}
