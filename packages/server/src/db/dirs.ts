import * as path from "node:path";
import { EMBEDDED_CORE_MIGRATIONS } from "./embeddedMigrations";
import { CORE_MIGRATION_SOURCE_ID, type MigrationDirs, type MigrationSource } from "./migrate";

export function migrationDirs(): MigrationDirs {
  return {
    sqlite: path.join(import.meta.dir, "..", "..", "drizzle"),
    postgres: path.join(import.meta.dir, "..", "..", "drizzle-pg"),
  };
}

export function coreMigrationSource(): MigrationSource {
  return { id: CORE_MIGRATION_SOURCE_ID, dirs: migrationDirs(), files: EMBEDDED_CORE_MIGRATIONS };
}