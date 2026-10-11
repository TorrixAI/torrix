import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { Eval, EvalResult } from "../core/domain";
import type { EvalRepository } from "../core/ports";

export function createEvalRepository(db: DbClient): EvalRepository {
  return {
    async create(evalRecord: Eval): Promise<void> {
      await insertRow(db.engine, "evals", evalRecord as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<Eval>): Promise<void> {
      await updateById(db.engine, "evals", id, fields as unknown as Record<string, unknown>);
    },

    async getById(id: string, userId: string): Promise<Eval | null> {
      const row = await sqlGet<Eval>(
        db.engine,
        "SELECT * FROM evals WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      return row ?? null;
    },

    async listByUser(userId: string, datasetId?: string): Promise<Eval[]> {
      if (datasetId) {
        return sqlAll<Eval>(
          db.engine,
          "SELECT * FROM evals WHERE user_id = ? AND dataset_id = ? ORDER BY created_at DESC LIMIT 50",
          [userId, datasetId],
        );
      }
      return sqlAll<Eval>(
        db.engine,
        "SELECT * FROM evals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        [userId],
      );
    },

    async findOnlineObserved(userId: string, datasetId: string): Promise<Eval | null> {
      const row = await sqlGet<Eval>(
        db.engine,
        `SELECT * FROM evals
         WHERE user_id = ? AND dataset_id = ? AND mode = 'online' AND provider = 'observed'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, datasetId],
      );
      return row ?? null;
    },

    async findObservedByProject(userId: string, projectId: string): Promise<Eval | null> {
      const row = await sqlGet<Eval>(
        db.engine,
        `SELECT * FROM evals
         WHERE user_id = ? AND project_id = ? AND mode = 'online' AND provider = 'observed'
         ORDER BY created_at DESC LIMIT 1`,
        [userId, projectId],
      );
      return row ?? null;
    },

    async addResult(result: EvalResult): Promise<void> {
      await insertRow(db.engine, "eval_results", result as unknown as Record<string, unknown>);
    },

    async listResults(evalId: string): Promise<EvalResult[]> {
      return sqlAll<EvalResult>(
        db.engine,
        "SELECT * FROM eval_results WHERE eval_id = ? ORDER BY created_at ASC",
        [evalId],
      );
    },
  };
}