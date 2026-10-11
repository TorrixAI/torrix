import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun } from "../db/sql";
import type { OnlineEvalConfig } from "../core/domain";
import type { OnlineEvalRepository } from "../core/ports";

export function createOnlineEvalRepository(db: DbClient): OnlineEvalRepository {
  return {
    async getByProject(projectId: string): Promise<OnlineEvalConfig | null> {
      const row = await sqlGet<OnlineEvalConfig>(
        db.engine,
        "SELECT * FROM online_eval_configs WHERE project_id = ? LIMIT 1",
        [projectId],
      );
      return row ?? null;
    },

    async listByUser(userId: string): Promise<OnlineEvalConfig[]> {
      return sqlAll<OnlineEvalConfig>(
        db.engine,
        "SELECT * FROM online_eval_configs WHERE user_id = ? ORDER BY updated_at DESC",
        [userId],
      );
    },

    async upsert(config: OnlineEvalConfig): Promise<void> {
      const existing = await this.getByProject(config.project_id);
      if (!existing) {
        await insertRow(db.engine, "online_eval_configs", config as unknown as Record<string, unknown>);
        return;
      }
      await sqlRun(
        db.engine,
        `UPDATE online_eval_configs
         SET enabled = ?, dataset_id = ?, scorer = ?, judge_enabled = ?, judge_criteria = ?,
             guardrail_action = ?, guardrail_threshold = ?, guardrail_window_minutes = ?, updated_at = ?
         WHERE project_id = ?`,
        [
          config.enabled,
          config.dataset_id,
          config.scorer,
          config.judge_enabled,
          config.judge_criteria,
          config.guardrail_action,
          config.guardrail_threshold,
          config.guardrail_window_minutes,
          config.updated_at,
          config.project_id,
        ],
      );
    },

    async delete(projectId: string): Promise<void> {
      await sqlRun(db.engine, "DELETE FROM online_eval_configs WHERE project_id = ?", [projectId]);
    },
  };
}
