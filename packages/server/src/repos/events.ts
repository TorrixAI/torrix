import type { DbClient } from "../db/client";
import { sqlAll, sqlGet, sqlRun } from "../db/sql";
import type { Events } from "../core/domain";
import type { EventRepository, RunEventCount, RunTextMatch, RunToolEvent, RunToolName } from "../core/ports";
import { toolNameFromEventMessage } from "../lib/toolNames";

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

    async listLastResponseEvents(runIds: string[]): Promise<RunToolEvent[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ runId: string; message: string; createdAt: string }>(
        db.engine,
        `SELECT e.run_id AS "runId", substr(e.message, 1, 2000) AS message, e.created_at AS "createdAt"
         FROM events e
         WHERE e.run_id IN (${marks}) AND e.type = 'response'
           AND NOT EXISTS (
             SELECT 1 FROM events p
             WHERE p.run_id = e.run_id AND p.type = 'response'
               AND (p.created_at > e.created_at OR (p.created_at = e.created_at AND p.id > e.id))
           )
         ORDER BY e.created_at ASC`,
        ids,
      );
      return rows.map((row) => ({
        runId: String(row.runId),
        message: String(row.message ?? ""),
        createdAt: String(row.createdAt),
      }));
    },

    async listFirstToolEvents(runIds: string[]): Promise<RunToolEvent[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ runId: string; message: string; createdAt: string }>(
        db.engine,
        `SELECT e.run_id AS "runId", e.message, e.created_at AS "createdAt"
         FROM events e
         WHERE e.run_id IN (${marks}) AND e.type = 'tool_call'
           AND NOT EXISTS (
             SELECT 1 FROM events p
             WHERE p.run_id = e.run_id AND p.type = 'tool_call'
               AND (p.created_at < e.created_at OR (p.created_at = e.created_at AND p.id < e.id))
           )
         ORDER BY e.created_at ASC`,
        ids,
      );
      return rows.map((row) => ({
        runId: String(row.runId),
        message: String(row.message ?? ""),
        createdAt: String(row.createdAt),
      }));
    },

    async listToolNamesByRunIds(runIds: string[]): Promise<RunToolName[]> {
      const ids = [...new Set(runIds.filter(Boolean))];
      if (!ids.length) {
        return [];
      }
      const marks = ids.map(() => "?").join(", ");
      const rows = await sqlAll<{ runId: string; message: string }>(
        db.engine,
        `SELECT run_id AS "runId", substr(message, 1, 500) AS message FROM events WHERE run_id IN (${marks}) AND type = 'tool_call' ORDER BY created_at ASC`,
        ids,
      );
      const seen = new Set<string>();
      const out: RunToolName[] = [];
      for (const row of rows) {
        const name = toolNameFromEventMessage(String(row.message ?? ""));
        if (!name) continue;
        const key = `${row.runId}\u0000${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ runId: String(row.runId), name });
      }
      return out;
    },

    async findTextMatches(userId: string, since: string, needles: string[], limit: number): Promise<RunTextMatch[]> {
      if (!needles.length || limit <= 0) {
        return [];
      }
      const likes = needles.map(() => "e.message LIKE ?").join(" OR ");
      const params: Array<string | number> = [userId, since];
      for (const needle of needles) {
        params.push(`%${needle}%`);
      }
      params.push(limit);
      const rows = await sqlAll<{ runId: string; text: string }>(
        db.engine,
        `SELECT e.run_id AS "runId", e.message AS text
         FROM events e JOIN runs r ON r.id = e.run_id
         WHERE r.user_id = ? AND e.created_at >= ? AND (${likes})
         ORDER BY e.created_at DESC LIMIT ?`,
        params,
      );
      return rows.map((row) => ({ runId: String(row.runId), text: String(row.text ?? "") }));
    },
  };
}