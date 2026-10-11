import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { UserRepository } from "../core/ports";
import type { User } from "../core/domain";

export function createUserRepository(db: DbClient): UserRepository {
  return {
    async countUsers(): Promise<number> {
      const row = await sqlGet<{ c: number }>(db.engine, "SELECT COUNT(*) AS c FROM users");
      return Number(row?.c ?? 0);
    },

    async list(): Promise<User[]> {
      return sqlAll<User>(db.engine, "SELECT * FROM users ORDER BY created_at ASC");
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await sqlGet<User>(db.engine, "SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1", [email]);
      return row ?? null;
    },

    async findById(id: string): Promise<User | null> {
      const row = await sqlGet<User>(db.engine, "SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
      return row ?? null;
    },

    async create(user: User): Promise<void> {
      await insertRow(db.engine, "users", user as unknown as Record<string, unknown>);
    },

    async setAdmin(userId: string, isAdmin: number): Promise<void> {
      await updateById(db.engine, "users", userId, { is_admin: isAdmin });
    },

    async delete(userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(db.engine, "SELECT id FROM users WHERE id = ?", [userId]);
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM events WHERE run_id IN (SELECT id FROM runs WHERE user_id = ?)", [userId]);
      await sqlRun(db.engine, "DELETE FROM runs WHERE user_id = ?", [userId]);
      await sqlRun(db.engine, "DELETE FROM api_keys WHERE user_id = ?", [userId]);
      await sqlRun(db.engine, "DELETE FROM projects WHERE user_id = ?", [userId]);
      await sqlRun(db.engine, "DELETE FROM users WHERE id = ?", [userId]);
      return true;
    },

    async markPasswordChange(userId: string): Promise<void> {
      await updateById(db.engine, "users", userId, { must_change_password: 1 });
    },

    async changePassword(userId: string, hash: string, mustChange: number): Promise<void> {
      await updateById(db.engine, "users", userId, { password: hash, must_change_password: mustChange });
    },
  };
}