import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { AgentRepository } from "../core/ports";
import type { Agent, AgentCredential, AgentTool } from "../core/domain";

export function createAgentRepository(db: DbClient): AgentRepository {
  const asAgent = (row: Record<string, unknown>): Agent => row as unknown as Agent;

  return {
    async listByUser(userId: string): Promise<Agent[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows.map(asAgent);
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(db.engine, "SELECT COUNT(*) AS c FROM agents WHERE user_id = ?", [userId]);
      return Number(row?.c ?? 0);
    },

    async countActiveByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM agents WHERE user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)",
        [userId, new Date().toISOString()],
      );
      return Number(row?.c ?? 0);
    },

    async getById(id: string, userId: string): Promise<Agent | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agents WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asAgent(row) : null;
    },

    async getBySlug(userId: string, slug: string): Promise<Agent | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agents WHERE user_id = ? AND slug = ?",
        [userId, slug],
      );
      return row ? asAgent(row) : null;
    },

    async findByExternal(userId: string, provider: string, subject: string): Promise<Agent | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agents WHERE user_id = ? AND identity_provider = ? AND external_subject = ?",
        [userId, provider, subject],
      );
      return row ? asAgent(row) : null;
    },

    async create(agent: Agent): Promise<void> {
      await insertRow(db.engine, "agents", agent as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<Agent>): Promise<void> {
      await updateById(db.engine, "agents", id, fields as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM agents WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM agents WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async createCredential(credential: AgentCredential): Promise<void> {
      await insertRow(db.engine, "agent_credentials", credential as unknown as Record<string, unknown>);
    },

    async findCredentialByHash(hash: string): Promise<AgentCredential | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_credentials WHERE key_hash = ? AND revoked_at IS NULL",
        [hash],
      );
      return row ? (row as unknown as AgentCredential) : null;
    },

    async getCredentialById(id: string): Promise<AgentCredential | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_credentials WHERE id = ?",
        [id],
      );
      return row ? (row as unknown as AgentCredential) : null;
    },

    async listCredentials(agentId: string, userId: string): Promise<AgentCredential[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_credentials WHERE agent_id = ? AND user_id = ? ORDER BY created_at DESC",
        [agentId, userId],
      );
      return rows as unknown as AgentCredential[];
    },

    async touchCredential(id: string): Promise<void> {
      await sqlRun(db.engine, "UPDATE agent_credentials SET last_used_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
    },

    async revokeCredential(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM agent_credentials WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "UPDATE agent_credentials SET revoked_at = ? WHERE id = ? AND user_id = ?", [
        new Date().toISOString(),
        id,
        userId,
      ]);
      return true;
    },

    async listTools(agentId: string): Promise<AgentTool[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_tools WHERE agent_id = ? ORDER BY created_at DESC",
        [agentId],
      );
      return rows as unknown as AgentTool[];
    },

    async addTool(tool: AgentTool): Promise<void> {
      await insertRow(db.engine, "agent_tools", tool as unknown as Record<string, unknown>);
    },

    async removeTool(id: string, agentId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM agent_tools WHERE id = ? AND agent_id = ?",
        [id, agentId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM agent_tools WHERE id = ? AND agent_id = ?", [id, agentId]);
      return true;
    },
  };
}
