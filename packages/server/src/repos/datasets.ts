import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { Dataset, DatasetRow } from "../core/domain";
import type { DatasetRepository } from "../core/ports";

export function createDatasetRepository(db: DbClient): DatasetRepository {
  return {
    async listByUser(userId: string): Promise<Dataset[]> {
      return sqlAll<Dataset>(
        db.engine,
        "SELECT * FROM datasets WHERE user_id = ? ORDER BY updated_at DESC",
        [userId],
      );
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM datasets WHERE user_id = ?",
        [userId],
      );
      return Number(row?.c ?? 0);
    },

    async getById(id: string, userId: string): Promise<Dataset | null> {
      const row = await sqlGet<Dataset>(
        db.engine,
        "SELECT * FROM datasets WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      return row ?? null;
    },

    async create(dataset: Dataset): Promise<void> {
      await insertRow(db.engine, "datasets", dataset as unknown as Record<string, unknown>);
    },

    async updateMeta(id: string, fields: Partial<Dataset>): Promise<void> {
      await updateById(db.engine, "datasets", id, fields as unknown as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await this.getById(id, userId);
      if (!existing) {
        return false;
      }
      const rowIds = (
        await sqlAll<{ id: string }>(db.engine, "SELECT id FROM dataset_rows WHERE dataset_id = ?", [id])
      ).map((r) => r.id);
      if (rowIds.length) {
        await sqlRun(
          db.engine,
          `DELETE FROM eval_results WHERE dataset_row_id IN (${rowIds.map(() => "?").join(",")})`,
          rowIds,
        );
      }
      await sqlRun(db.engine, "DELETE FROM dataset_rows WHERE dataset_id = ?", [id]);
      const evalIds = (
        await sqlAll<{ id: string }>(db.engine, "SELECT id FROM evals WHERE dataset_id = ?", [id])
      ).map((r) => r.id);
      for (const evalId of evalIds) {
        await sqlRun(db.engine, "DELETE FROM eval_results WHERE eval_id = ?", [evalId]);
      }
      await sqlRun(db.engine, "DELETE FROM evals WHERE dataset_id = ?", [id]);
      await sqlRun(db.engine, "DELETE FROM datasets WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async countRows(datasetId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM dataset_rows WHERE dataset_id = ?",
        [datasetId],
      );
      return Number(row?.c ?? 0);
    },

    async listRows(datasetId: string): Promise<DatasetRow[]> {
      return sqlAll<DatasetRow>(
        db.engine,
        "SELECT * FROM dataset_rows WHERE dataset_id = ? ORDER BY idx ASC",
        [datasetId],
      );
    },

    async getRow(rowId: string, userId: string): Promise<DatasetRow | null> {
      const row = await sqlGet<DatasetRow>(
        db.engine,
        `SELECT r.* FROM dataset_rows r
         JOIN datasets d ON d.id = r.dataset_id
         WHERE r.id = ? AND d.user_id = ? LIMIT 1`,
        [rowId, userId],
      );
      return row ?? null;
    },

    async addRow(row: DatasetRow): Promise<void> {
      await insertRow(db.engine, "dataset_rows", row as unknown as Record<string, unknown>);
    },

    async addRows(rows: DatasetRow[]): Promise<void> {
      for (const row of rows) {
        await insertRow(db.engine, "dataset_rows", row as unknown as Record<string, unknown>);
      }
    },

    async updateRow(rowId: string, userId: string, fields: Partial<DatasetRow>): Promise<boolean> {
      const row = await sqlGet<DatasetRow>(
        db.engine,
        `SELECT r.* FROM dataset_rows r
         JOIN datasets d ON d.id = r.dataset_id
         WHERE r.id = ? AND d.user_id = ? LIMIT 1`,
        [rowId, userId],
      );
      if (!row) {
        return false;
      }
      const entries = Object.entries(fields).filter(([key, value]) => value !== undefined && key !== "id" && key !== "dataset_id" && key !== "idx");
      if (entries.length) {
        const sets = entries.map(([key]) => `${key} = ?`).join(", ");
        const values = entries.map(([, value]) => (value === undefined ? null : (value as string | null)));
        await sqlRun(db.engine, `UPDATE dataset_rows SET ${sets} WHERE id = ?`, [...values, rowId]);
      }
      return true;
    },

    async deleteRow(rowId: string, userId: string): Promise<boolean> {
      const row = await sqlGet<{ dataset_id: string }>(
        db.engine,
        "SELECT dataset_id FROM dataset_rows WHERE id = ? LIMIT 1",
        [rowId],
      );
      if (!row) {
        return false;
      }
      const dataset = await sqlGet<{ user_id: string }>(
        db.engine,
        "SELECT user_id FROM datasets WHERE id = ? LIMIT 1",
        [row.dataset_id],
      );
      if (!dataset || dataset.user_id !== userId) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM eval_results WHERE dataset_row_id = ?", [rowId]);
      await sqlRun(db.engine, "DELETE FROM dataset_rows WHERE id = ?", [rowId]);
      return true;
    },
  };
}