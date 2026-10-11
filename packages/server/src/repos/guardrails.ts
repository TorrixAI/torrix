import type { DbClient } from "../db/client";
import { insertRow, sqlGet, sqlRun } from "../db/sql";
import type { GuardrailEvent } from "../core/domain";
import type { GuardrailRepository } from "../core/ports";

export function createGuardrailRepository(db: DbClient): GuardrailRepository {
  return {
    async insert(event: GuardrailEvent): Promise<void> {
      await insertRow(db.engine, "guardrail_events", event as unknown as Record<string, unknown>);
    },

    async findActive(userId: string, sessionId: string, nowIso: string): Promise<GuardrailEvent | null> {
      const row = await sqlGet<GuardrailEvent>(
        db.engine,
        `SELECT * FROM guardrail_events
         WHERE user_id = ? AND session_id = ? AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
        [userId, sessionId, nowIso],
      );
      return row ?? null;
    },

    async clearForSession(userId: string, sessionId: string): Promise<void> {
      await sqlRun(db.engine, "DELETE FROM guardrail_events WHERE user_id = ? AND session_id = ?", [
        userId,
        sessionId,
      ]);
    },

    async deleteExpired(userId: string, sessionId: string, nowIso: string): Promise<void> {
      await sqlRun(
        db.engine,
        "DELETE FROM guardrail_events WHERE user_id = ? AND session_id = ? AND expires_at <= ?",
        [userId, sessionId, nowIso],
      );
    },
  };
}
