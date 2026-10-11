import type { DbClient } from "../db/client";
import { insertRow, sqlAll, sqlGet, sqlRun } from "../db/sql";
import type { GraphFilter, GraphRepository } from "../core/ports";
import type { AgentPermission } from "../core/domain";

export function createGraphRepository(db: DbClient): GraphRepository {
  return {
    async replaceForUser(userId: string, rows: AgentPermission[]): Promise<void> {
      await db.engine.transaction(async () => {
        await sqlRun(db.engine, "DELETE FROM agent_permissions WHERE user_id = ?", [userId]);
        for (const row of rows) {
          await insertRow(db.engine, "agent_permissions", row as unknown as Record<string, unknown>);
        }
      });
    },

    async list(userId: string, filter: GraphFilter): Promise<AgentPermission[]> {
      const clauses: string[] = ["user_id = ?"];
      const params: Array<string | number> = [userId];
      if (filter.agentId) {
        clauses.push("agent_id = ?");
        params.push(filter.agentId);
      }
      if (filter.action) {
        clauses.push("action = ?");
        params.push(filter.action);
      }
      if (filter.resource) {
        clauses.push("(resource_type = ? OR resource_id = ?)");
        params.push(filter.resource, filter.resource);
      }
      params.push(filter.limit, filter.offset ?? 0);
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM agent_permissions WHERE ${clauses.join(" AND ")} ORDER BY action ASC, resource_type ASC LIMIT ? OFFSET ?`,
        params,
      );
      return rows as unknown as AgentPermission[];
    },

    async countByUser(userId: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM agent_permissions WHERE user_id = ?",
        [userId],
      );
      return Number(row?.c ?? 0);
    },
  };
}
