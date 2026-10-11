import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun, type SqlValue } from "../db/sql";
import type { RoutingRepository } from "../core/ports";
import type { RoutingRule } from "../core/domain";

const RULE_COLUMNS = [
  "id", "user_id", "project_id", "name", "enabled", "priority", "match_provider", "match_model",
  "match_kind", "match_prompt", "match_prompt_regex", "target_model", "target_url", "fallback_model",
  "max_cost_usd", "min_quality_score", "created_at", "updated_at",
] as const;

export function createRoutingRepository(db: DbClient): RoutingRepository {
  return {
    async listRules(userId: string): Promise<RoutingRule[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM routing_rules WHERE user_id = ? ORDER BY priority ASC, created_at ASC",
        [userId],
      );
      return rows.map((r) => r as unknown as RoutingRule);
    },

    async getRule(id: string, userId: string): Promise<RoutingRule | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM routing_rules WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      return row ? (row as unknown as RoutingRule) : null;
    },

    async createRule(rule: RoutingRule): Promise<void> {
      const cols = RULE_COLUMNS.map((c) => `"${c}"`).join(", ");
      const marks = RULE_COLUMNS.map(() => "?").join(", ");
      const values: SqlValue[] = RULE_COLUMNS.map((c) => {
        const v = (rule as unknown as Record<string, unknown>)[c];
        return v === undefined ? null : (v as SqlValue);
      });
      await sqlRun(db.engine, `INSERT OR IGNORE INTO routing_rules (${cols}) VALUES (${marks})`, values);
    },

    async updateRule(id: string, fields: Partial<RoutingRule>): Promise<void> {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (!entries.length) {
        return;
      }
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values = entries.map(([, v]) => (v === null ? null : (v as SqlValue)));
      await sqlRun(db.engine, `UPDATE routing_rules SET ${sets} WHERE id = ?`, [...values, id]);
    },

    async deleteRule(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(
        db.engine,
        "SELECT id FROM routing_rules WHERE id = ? AND user_id = ?",
        [id, userId],
      );
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM routing_rules WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },
  };
}