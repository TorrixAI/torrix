import * as fs from "node:fs";
import * as path from "node:path";
import type { DbClient } from "./client";
import { sqlAll, sqlRun } from "./sql";

export interface MigrationDirs {
  sqlite: string;
  postgres: string;
}

/**
 * A named set of per-dialect migration dirs. Core files are recorded in
 * `_migrations` by bare file name (as they always were); every other source is
 * namespaced as `<id>/<file>` so extensions can never collide with core.
 */
export interface MigrationSource {
  id: string;
  dirs: MigrationDirs;
}

export const CORE_MIGRATION_SOURCE_ID = "core";

export async function runMigrationSources(db: DbClient, sources: readonly MigrationSource[]): Promise<void> {
  for (const source of sources) {
    await runMigrations(db, source.dirs, source.id === CORE_MIGRATION_SOURCE_ID ? "" : `${source.id}/`);
  }
}

export async function runMigrations(db: DbClient, dirs: MigrationDirs | string, prefix = ""): Promise<void> {
  const dir = path.resolve(typeof dirs === "string" ? dirs : dirs[db.dialect]);
  await db.engine.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set<string>(
    (await sqlAll<{ name: string }>(db.engine, "SELECT name FROM _migrations")).map((r) => r.name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const name = `${prefix}${file}`;
    if (applied.has(name)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    try {
      await db.engine.transaction(async () => {
        await db.engine.exec(sql);
        await sqlRun(db.engine, "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [
          name,
          new Date().toISOString(),
        ]);
      });
    } catch (err) {
      throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
    }
  }
}