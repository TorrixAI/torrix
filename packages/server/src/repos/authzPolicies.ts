import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { AuthorizationPolicyRepository } from "../core/ports";
import type { AuthorizationPolicy, AuthorizationPolicyVersion } from "../core/domain";

export function createAuthorizationPolicyRepository(db: DbClient): AuthorizationPolicyRepository {
  const asPolicy = (row: Record<string, unknown>): AuthorizationPolicy => row as unknown as AuthorizationPolicy;

  return {
    async listByUser(userId: string): Promise<AuthorizationPolicy[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_policies WHERE user_id = ? ORDER BY priority ASC, created_at DESC",
        [userId],
      );
      return rows.map(asPolicy);
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM authorization_policies WHERE user_id = ?",
        [userId],
      );
      return Number(row?.c ?? 0);
    },

    async getById(id: string, userId: string): Promise<AuthorizationPolicy | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_policies WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asPolicy(row) : null;
    },

    async listActive(userId: string, projectId: string | null): Promise<AuthorizationPolicy[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM authorization_policies
         WHERE user_id = ? AND enabled = 1 AND (project_id IS NULL OR project_id = ?)
         ORDER BY priority ASC, created_at ASC`,
        [userId, projectId ?? ""],
      );
      return rows.map(asPolicy);
    },

    async create(policy: AuthorizationPolicy): Promise<void> {
      await insertRow(db.engine, "authorization_policies", policy as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<AuthorizationPolicy>): Promise<void> {
      await updateById(db.engine, "authorization_policies", id, fields as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM authorization_policies WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM authorization_policy_versions WHERE policy_id = ? AND user_id = ?", [
        id,
        userId,
      ]);
      await sqlRun(db.engine, "DELETE FROM authorization_policies WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async addVersion(version: AuthorizationPolicyVersion): Promise<void> {
      await insertRow(db.engine, "authorization_policy_versions", version as unknown as Record<string, unknown>);
    },

    async listVersions(policyId: string): Promise<AuthorizationPolicyVersion[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_policy_versions WHERE policy_id = ? ORDER BY version DESC",
        [policyId],
      );
      return rows as unknown as AuthorizationPolicyVersion[];
    },

    async getVersion(policyId: string, version: number): Promise<AuthorizationPolicyVersion | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM authorization_policy_versions WHERE policy_id = ? AND version = ?",
        [policyId, version],
      );
      return row ? (row as unknown as AuthorizationPolicyVersion) : null;
    },
  };
}
