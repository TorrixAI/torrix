import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { PrincipalRepository } from "../core/ports";
import type { Principal } from "../core/domain";

export function createPrincipalRepository(db: DbClient): PrincipalRepository {
  return {
    async listByUser(userId: string): Promise<Principal[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM principals WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows as unknown as Principal[];
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM principals WHERE user_id = ?",
        [userId],
      );
      return Number(row?.c ?? 0);
    },

    async getById(id: string, userId: string): Promise<Principal | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM principals WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? (row as unknown as Principal) : null;
    },

    async findByExternal(userId: string, provider: string, subject: string): Promise<Principal | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM principals WHERE user_id = ? AND identity_provider = ? AND external_subject = ?",
        [userId, provider, subject],
      );
      return row ? (row as unknown as Principal) : null;
    },

    async create(principal: Principal): Promise<void> {
      await insertRow(db.engine, "principals", principal as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<Principal>): Promise<void> {
      await updateById(db.engine, "principals", id, fields as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM principals WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM principals WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },
  };
}
