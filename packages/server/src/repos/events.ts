import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun } from "../db/sql";
import type { Events } from "../core/domain";
import type { EventRepository, RunEventCount, RunToolEvent } from "../core/ports";

export function createEventRepository(db: DbClient): EventRepository {
  return {
    async add(event: Events): Promise<void> {
      await sqlRun(db.engine, "INSERT OR IGNORE INTO events (id, run_id, message, type, created_at) VALUES (?, ?, ?, ?, ?)", [
        event.id,
        event.run_id,
        event.message,
        event.type,
        event.created_at,
      ]);
    },

    async addMany(eventList: Events[]): Promise<void> {
      for (const event of eventList) {
        await sqlRun(db.engine, "INSERT OR IGNORE INTO events (id, run_id, message, type, created_at) VALUES (?, ?, ?, ?, ?)", [
          event.id,
          event.run_id,
          event.message,
          event.type,
          event.created_at,
        ]);
      }
    },

    async listByRun(runId: string): Promise<Events[]> {
      return sqlAll<Events>(db.engine, "SELECT * FROM events WHERE run_id = ? ORDER BY created_at ASC", [runId]);
    },

    async listByRunIds(runIds: string[]): Promise<Events[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      return sqlAll<Events>(
        db.engine,
        `SELECT * FROM events WHERE run_id IN (${marks}) ORDER BY created_at ASC`,
        ids,
      );
    },

    async countByRunIds(runIds: string[]): Promise<RunEventCount[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ runId: string; type: string; count: number }>(
        db.engine,
        `SELECT run_id AS "runId", type, COUNT(*) AS count FROM events WHERE run_id IN (${marks}) GROUP BY run_id, type`,
        ids,
      );
      return rows.map((row) => ({ runId: String(row.runId), type: String(row.type), count: Number(row.count) }));
    },

    async listToolEvents(runIds: string[], limit: number): Promise<RunToolEvent[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length || limit <= 0) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ runId: string; message: string; createdAt: string }>(
        db.engine,
        `SELECT run_id AS "runId", message, created_at AS "createdAt" FROM events
         WHERE run_id IN (${marks}) AND type = 'tool_call'
         ORDER BY created_at ASC LIMIT ?`,
        [...ids, limit],
      );
      return rows.map((row) => ({
        runId: String(row.runId),
        message: String(row.message ?? ""),
        createdAt: String(row.createdAt),
      }));
    },
  };
}