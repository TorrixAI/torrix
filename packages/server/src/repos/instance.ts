import type { DbClient } from "../db/client";
import { sqlGet, sqlRun } from "../db/sql";
import type { InstanceRepository } from "../core/ports";

export function createInstanceRepository(db: DbClient): InstanceRepository {
  return {
    async get(key: string): Promise<string | null> {
      const row = await sqlGet<{ value: string }>(db.engine, "SELECT value FROM instance_config WHERE key = ?", [key]);
      return row?.value ?? null;
    },

    async set(key: string, value: string): Promise<void> {
      await sqlRun(db.engine, "INSERT INTO instance_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
    },
  };
}