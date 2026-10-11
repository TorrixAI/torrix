import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun, type SqlValue } from "../db/sql";
import type { ExportRepository } from "../core/ports";
import type { ExportConfig } from "../core/domain";

const EXPORT_COLUMNS = [
  "id", "user_id", "provider", "endpoint", "bucket", "prefix", "access_key_id",
  "secret_access_key", "schedule_minutes", "enabled", "last_export_at", "last_run_count",
  "last_error", "created_at", "updated_at",
] as const;

export function createExportRepository(db: DbClient): ExportRepository {
  return {
    async listByUser(userId: string): Promise<ExportConfig[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM export_configs WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows.map((r) => r as unknown as ExportConfig);
    },

    async getById(id: string, userId: string): Promise<ExportConfig | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM export_configs WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? (row as unknown as ExportConfig) : null;
    },

    async create(config: ExportConfig): Promise<void> {
      const cols = EXPORT_COLUMNS.map((c) => `"${c}"`).join(", ");
      const marks = EXPORT_COLUMNS.map(() => "?").join(", ");
      const values: SqlValue[] = EXPORT_COLUMNS.map((c) => {
        const v = (config as unknown as Record<string, unknown>)[c];
        return v === undefined ? null : (v as SqlValue);
      });
      await sqlRun(db.engine, `INSERT OR IGNORE INTO export_configs (${cols}) VALUES (${marks})`, values);
    },

    async update(id: string, fields: Partial<ExportConfig>): Promise<void> {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (!entries.length) {
        return;
      }
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values = entries.map(([, v]) => (v === null ? null : (v as SqlValue)));
      await sqlRun(db.engine, `UPDATE export_configs SET ${sets} WHERE id = ?`, [...values, id]);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM export_configs WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM export_configs WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async listEnabled(): Promise<ExportConfig[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM export_configs WHERE enabled = 1",
      );
      return rows.map((r) => r as unknown as ExportConfig);
    },
  };
}