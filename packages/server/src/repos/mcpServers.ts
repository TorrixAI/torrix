import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun, updateById } from "../db/sql";
import type { McpServerRepository } from "../core/ports";
import type { AgentPermission, McpOAuthState, McpServer, McpServerTool } from "../core/domain";

export function createMcpServerRepository(db: DbClient): McpServerRepository {
  const asServer = (row: Record<string, unknown>): McpServer => row as unknown as McpServer;

  return {
    async listByUser(userId: string): Promise<McpServer[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows.map(asServer);
    },

    async getById(id: string, userId: string): Promise<McpServer | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? asServer(row) : null;
    },

    async getBySlug(userId: string, slug: string): Promise<McpServer | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM mcp_servers WHERE user_id = ? AND slug = ?",
        [userId, slug],
      );
      return row ? asServer(row) : null;
    },

    async create(server: McpServer): Promise<void> {
      await insertRow(db.engine, "mcp_servers", server as unknown as Record<string, unknown>);
    },

    async update(id: string, fields: Partial<McpServer>): Promise<void> {
      await updateById(db.engine, "mcp_servers", id, fields as Record<string, unknown>);
    },

    async delete(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM mcp_server_tools WHERE server_id = ? AND user_id = ?", [id, userId]);
      await sqlRun(db.engine, "DELETE FROM mcp_servers WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async listTools(serverId: string): Promise<McpServerTool[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM mcp_server_tools WHERE server_id = ? ORDER BY name ASC",
        [serverId],
      );
      return rows as unknown as McpServerTool[];
    },

    async replaceTools(serverId: string, userId: string, tools: McpServerTool[]): Promise<void> {
      await db.engine.transaction(async () => {
        await sqlRun(db.engine, "DELETE FROM mcp_server_tools WHERE server_id = ? AND user_id = ?", [
          serverId,
          userId,
        ]);
        for (const tool of tools) {
          await insertRow(db.engine, "mcp_server_tools", tool as unknown as Record<string, unknown>);
        }
      });
    },

    async listPermissions(userId: string): Promise<AgentPermission[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM agent_permissions WHERE user_id = ? ORDER BY computed_at DESC",
        [userId],
      );
      return rows as unknown as AgentPermission[];
    },

    async createOAuthState(row: McpOAuthState): Promise<void> {
      await insertRow(db.engine, "mcp_oauth_states", row as unknown as Record<string, unknown>);
    },

    async consumeOAuthState(state: string): Promise<McpOAuthState | null> {
      const row = await sqlGet<McpOAuthState>(db.engine, "SELECT * FROM mcp_oauth_states WHERE state = ?", [state]);
      if (!row) {
        return null;
      }
      await sqlRun(db.engine, "DELETE FROM mcp_oauth_states WHERE state = ?", [state]);
      return row;
    },

    async deleteExpiredOAuthStates(nowIso: string): Promise<number> {
      const row = await sqlGet<{ count: number }>(
        db.engine,
        "SELECT COUNT(*) AS count FROM mcp_oauth_states WHERE expires_at <= ?",
        [nowIso],
      );
      await sqlRun(db.engine, "DELETE FROM mcp_oauth_states WHERE expires_at <= ?", [nowIso]);
      return Number(row?.count ?? 0);
    },
  };
}
