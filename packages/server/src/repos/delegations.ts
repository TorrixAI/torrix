import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { DelegationRepository } from "../core/ports";
import type { Delegation } from "../core/domain";

export function createDelegationRepository(db: DbClient): DelegationRepository {
  const asDelegation = (row: Record<string, unknown>): Delegation => row as unknown as Delegation;

  return {
    async listByUser(userId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows.map(asDelegation);
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM delegations WHERE user_id = ?",
        [userId],
      );
      return Number(row?.c ?? 0);
    },

    async getById(id: string, userId: string): Promise<Delegation | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asDelegation(row) : null;
    },

    async listByAgent(agentId: string, userId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC",
        [agentId, userId],
      );
      return rows.map(asDelegation);
    },

    async listByPrincipal(principalId: string, userId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE principal_id = ? AND user_id = ? ORDER BY created_at DESC",
        [principalId, userId],
      );
      return rows.map(asDelegation);
    },

    async listActiveForAgent(agentId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE agent_id = ? AND status = 'active' ORDER BY created_at ASC",
        [agentId],
      );
      return rows.map(asDelegation);
    },

    async listActiveForPrincipal(principalId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE principal_id = ? AND status = 'active' ORDER BY created_at ASC",
        [principalId],
      );
      return rows.map(asDelegation);
    },

    async listChildren(parentId: string): Promise<Delegation[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM delegations WHERE parent_delegation_id = ? ORDER BY created_at ASC",
        [parentId],
      );
      return rows.map(asDelegation);
    },

    async create(delegation: Delegation): Promise<void> {
      await insertRow(db.engine, "delegations", delegation as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<Delegation>): Promise<void> {
      await updateById(db.engine, "delegations", id, fields as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM delegations WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM delegations WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },
  };
}
