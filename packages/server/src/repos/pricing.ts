import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun } from "../db/sql";
import type { PricingOverride } from "../core/domain";
import type { PricingRepository } from "../core/ports";

export function createPricingRepository(db: DbClient): PricingRepository {
  return {
    async list(): Promise<PricingOverride[]> {
      return sqlAll<PricingOverride>(
        db.engine,
        "SELECT model, input, output, created_at FROM model_pricing ORDER BY created_at ASC",
      );
    },

    async upsert(model: string, input: number, output: number): Promise<void> {
      await sqlRun(
        db.engine,
        "INSERT INTO model_pricing (model, input, output, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(model) DO UPDATE SET input = excluded.input, output = excluded.output",
        [model, input, output, new Date().toISOString()],
      );
    },

    async remove(model: string): Promise<boolean> {
      const existing = await sqlGet<{ model: string }>(db.engine, "SELECT model FROM model_pricing WHERE model = ?", [model]);
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM model_pricing WHERE model = ?", [model]);
      return true;
    },
  };
}