import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun, type SqlValue } from "../db/sql";
import type { AuditQuery, AuditRepository, GovernanceRepository } from "../core/ports";
import type { AuditEntry, GovernanceSettings, Policy, ReviewItem, ReviewState } from "../core/domain";

const POLICY_COLUMNS = [
  "id", "user_id", "project_id", "name", "enabled", "action", "stage", "match_kind",
  "match_value", "severity", "hit_count", "last_hit_at", "created_at", "updated_at",
] as const;

function policyParams(policy: Policy): SqlValue[] {
  return POLICY_COLUMNS.map((c) => {
    const v = (policy as unknown as Record<string, unknown>)[c];
    return v === undefined ? null : (v as SqlValue);
  });
}

export function createAuditRepository(db: DbClient): AuditRepository {
  const write = async (entry: AuditEntry): Promise<void> => {
    await sqlRun(
      db.engine,
      `INSERT OR IGNORE INTO audit_log
       (id, user_id, project_id, actor, action, target_type, target_id, detail, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.user_id, entry.project_id, entry.actor, entry.action, entry.target_type, entry.target_id, entry.detail, entry.ip, entry.created_at],
    );
  };

  return {
    record: write,

    async recordMany(entries: AuditEntry[]): Promise<void> {
      for (const entry of entries) {
        await write(entry);
      }
    },

    async list(userId: string, query: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
      const where: string[] = ["user_id = ?"];
      const params: SqlValue[] = [userId];
      if (query.action) {
        where.push("action = ?");
        params.push(query.action);
      }
      if (query.targetType) {
        where.push("target_type = ?");
        params.push(query.targetType);
      }
      if (query.targetId) {
        where.push("target_id = ?");
        params.push(query.targetId);
      }
      if (query.from) {
        where.push("created_at >= ?");
        params.push(query.from);
      }
      if (query.to) {
        where.push("created_at <= ?");
        params.push(query.to);
      }
      const whereSql = where.join(" AND ");
      const total = Number((await sqlGet<{ c: number }>(db.engine, `SELECT COUNT(*) AS c FROM audit_log WHERE ${whereSql}`, params))?.c ?? 0);
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM audit_log WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, query.limit, query.offset],
      );
      return {
        entries: rows.map((r) => r as unknown as AuditEntry),
        total,
      };
    },

    async countBefore(userId: string, isoCutoff: string): Promise<number> {
      const row = await sqlGet<{ c: number }>(
        db.engine,
        "SELECT COUNT(*) AS c FROM audit_log WHERE user_id = ? AND created_at < ?",
        [userId, isoCutoff],
      );
      return Number(row?.c ?? 0);
    },
  };
}

const DEFAULT_SETTINGS: Omit<GovernanceSettings, "user_id" | "updated_at"> = {
  pii_enabled: 0,
  pii_types: JSON.stringify(["email", "phone", "card", "ssn", "api_key"]),
  pii_placeholder: "[redacted]",
  pii_mask_input: 1,
  pii_mask_output: 0,
  human_review_enabled: 0,
  audit_enabled: 1,
};

export function createGovernanceRepository(db: DbClient): GovernanceRepository {
  return {
    async getSettings(userId: string): Promise<GovernanceSettings> {
      const row = await sqlGet<Record<string, unknown>>(db.engine, "SELECT * FROM governance_settings WHERE user_id = ?", [userId]);
      if (!row) {
        return { ...DEFAULT_SETTINGS, user_id: userId, updated_at: new Date().toISOString() };
      }
      return row as unknown as GovernanceSettings;
    },

    async updateSettings(userId: string, fields: Partial<GovernanceSettings>): Promise<void> {
      await sqlRun(
        db.engine,
        "INSERT OR IGNORE INTO governance_settings (user_id, updated_at) VALUES (?, ?)",
        [userId, new Date().toISOString()],
      );
      const entries = Object.entries(fields).filter(
        ([k, v]) => k !== "user_id" && k !== "updated_at" && v !== undefined,
      );
      if (!entries.length) {
        return;
      }
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values = entries.map(([, v]) => (v === null ? null : (v as SqlValue)));
      values.push(new Date().toISOString(), userId);
      await sqlRun(db.engine, `UPDATE governance_settings SET ${sets}, updated_at = ? WHERE user_id = ?`, values);
    },

    async listPolicies(userId: string): Promise<Policy[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM policies WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      return rows.map((r) => r as unknown as Policy);
    },

    async getPolicy(id: string, userId: string): Promise<Policy | null> {
      const row = await sqlGet<Record<string, unknown>>(db.engine, "SELECT * FROM policies WHERE id = ? AND user_id = ?", [id, userId]);
      return row ? (row as unknown as Policy) : null;
    },

    async createPolicy(policy: Policy): Promise<void> {
      const cols = POLICY_COLUMNS.map((c) => `"${c}"`).join(", ");
      const marks = POLICY_COLUMNS.map(() => "?").join(", ");
      await sqlRun(db.engine, `INSERT OR IGNORE INTO policies (${cols}) VALUES (${marks})`, policyParams(policy));
    },

    async updatePolicy(id: string, fields: Partial<Policy>): Promise<void> {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      if (!entries.length) {
        return;
      }
      const sets = entries.map(([k]) => `${k} = ?`).join(", ");
      const values = entries.map(([, v]) => (v === null ? null : (v as SqlValue)));
      await sqlRun(db.engine, `UPDATE policies SET ${sets} WHERE id = ?`, [...values, id]);
    },

    async deletePolicy(id: string, userId: string): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(db.engine, "SELECT id FROM policies WHERE id = ? AND user_id = ?", [id, userId]);
      if (!existing) {
        return false;
      }
      await sqlRun(db.engine, "DELETE FROM policies WHERE id = ? AND user_id = ?", [id, userId]);
      return true;
    },

    async listActivePolicies(userId: string, projectId: string, stage: Policy["stage"]): Promise<Policy[]> {
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM policies
         WHERE user_id = ? AND enabled = 1 AND stage = ?
           AND (project_id IS NULL OR project_id = ?)
         ORDER BY created_at ASC`,
        [userId, stage, projectId],
      );
      return rows.map((r) => r as unknown as Policy);
    },

    async notePolicyHit(id: string): Promise<void> {
      await sqlRun(db.engine, "UPDATE policies SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?", [
        new Date().toISOString(),
        id,
      ]);
    },

    async enqueueReview(item: ReviewItem): Promise<void> {
      await sqlRun(
        db.engine,
        `INSERT OR IGNORE INTO review_queue (id, run_id, user_id, project_id, state, reviewer_user_id, note, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, item.run_id, item.user_id, item.project_id, item.state, item.reviewer_user_id, item.note, item.created_at, item.decided_at],
      );
    },

    async listReviewQueue(userId: string, states: ReviewState[], limit: number): Promise<ReviewItem[]> {
      if (!states.length) {
        return [];
      }
      const marks = states.map(() => "?").join(", ");
      const rows = await sqlAll<Record<string, unknown>>(
        db.engine,
        `SELECT * FROM review_queue WHERE user_id = ? AND state IN (${marks}) ORDER BY created_at DESC LIMIT ?`,
        [userId, ...states, limit],
      );
      return rows.map((r) => r as unknown as ReviewItem);
    },

    async getReviewForRun(runId: string): Promise<ReviewItem | null> {
      const row = await sqlGet<Record<string, unknown>>(
        db.engine,
        "SELECT * FROM review_queue WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
        [runId],
      );
      return row ? (row as unknown as ReviewItem) : null;
    },

    async decideReview(id: string, state: ReviewState, reviewerUserId: string, note: string | null): Promise<boolean> {
      const existing = await sqlGet<{ id: string }>(db.engine, "SELECT id FROM review_queue WHERE id = ?", [id]);
      if (!existing) {
        return false;
      }
      await sqlRun(
        db.engine,
        "UPDATE review_queue SET state = ?, reviewer_user_id = ?, note = ?, decided_at = ? WHERE id = ?",
        [state, reviewerUserId, note, new Date().toISOString(), id],
      );
      return true;
    },
  };
}