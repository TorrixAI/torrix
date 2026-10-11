import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, updateById } from "../db/sql";
import type { ApiKeyRepository } from "../core/ports";
import type { ApiKey } from "../core/domain";

export function createApiKeyRepository(db: DbClient): ApiKeyRepository {
  return {
    async create(key: ApiKey): Promise<void> {
      await insertRow(db.engine, "api_keys", key as unknown as Record<string, unknown>);
    },

    async findByHash(hash: string): Promise<ApiKey | null> {
      const row = await sqlGet<ApiKey>(db.engine, "SELECT * FROM api_keys WHERE key_hash = ? LIMIT 1", [hash]);
      return row ?? null;
    },

    async getById(id: string): Promise<ApiKey | null> {
      const row = await sqlGet<ApiKey>(db.engine, "SELECT * FROM api_keys WHERE id = ? LIMIT 1", [id]);
      return row ?? null;
    },

    async touchUsage(id: string): Promise<void> {
      await updateById(db.engine, "api_keys", id, { last_used_at: new Date().toISOString() });
    },

    async listByUser(userId: string): Promise<ApiKey[]> {
      return sqlAll<ApiKey>(
        db.engine,
        "SELECT * FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
        [userId],
      );
    },

    async revoke(id: string): Promise<void> {
      await updateById(db.engine, "api_keys", id, { revoked_at: new Date().toISOString() });
    },

    async updateLimits(id: string, fields: Partial<Pick<ApiKey, "budget_usd" | "hard_cap_usd">>): Promise<void> {
      const allowed: Record<string, unknown> = {};
      if ("budget_usd" in fields) allowed.budget_usd = fields.budget_usd;
      if ("hard_cap_usd" in fields) allowed.hard_cap_usd = fields.hard_cap_usd;
      if (Object.keys(allowed).length) {
        await updateById(db.engine, "api_keys", id, allowed);
      }
    },
  };
}