import * as path from "node:path";
import type { DbClient } from "./client";
import { openDatabase, openPostgres } from "./client";
import { coreMigrationSource } from "./dirs";
import { runMigrationSources, type MigrationSource } from "./migrate";
import { loadPreference, maskDbUrl, preferenceFilePath, savePreference, type DbPreference } from "./preference";
import { sqlAll, sqlGet, insertRow } from "./sql";

export type EngineChoice =
  | { driver: "postgres"; url: string }
  | { driver: "sqlite"; path?: string };

export interface SwapResult {
  swapped: boolean;
  seeded: number;
}

let activeChoice: EngineChoice | null = null;

function choiceKey(choice: EngineChoice, dbPath: string): string {
  return choice.driver === "postgres" ? `postgres:${choice.url}` : `sqlite:${path.resolve(choice.path ?? dbPath)}`;
}

export async function openInitialClient(
  dbPath: string,
  envUrl: string | null,
  sources: readonly MigrationSource[] = [coreMigrationSource()],
): Promise<DbClient> {
  const pref = loadPreference(preferenceFilePath(dbPath));
  const choice: EngineChoice = envUrl
    ? { driver: "postgres", url: envUrl }
    : pref?.driver === "postgres"
      ? { driver: "postgres", url: pref.url ?? "" }
      : { driver: "sqlite", path: pref?.path };
  activeChoice = choice;
  const client = await openVerified(choice, dbPath);
  await runMigrationSources(client, sources);
  return client;
}

/**
 * Swaps the engine in place on the shared DbClient. Every repository and route
 * reads `db.engine` per call, so reassigning the two fields re-wires the whole
 * app instantly. The new connection is verified and migrated BEFORE the old one
 * is torn down, so a failed switch leaves the previous database untouched.
 */
export async function swapDatabase(
  current: DbClient,
  dbPath: string,
  choice: EngineChoice,
  sources: readonly MigrationSource[] = [coreMigrationSource()],
): Promise<SwapResult> {
  const nextKey = choiceKey(choice, dbPath);
  if (activeChoice && activeKeyEquals(activeChoice, nextKey, dbPath)) {
    return { swapped: false, seeded: 0 };
  }
  const next = await openVerified(choice, dbPath);
  const prev = current.engine;
  let seeded = 0;
  try {
    await runMigrationSources(next, sources);
    seeded = await seedAdminIfEmpty(prev, next);
  } catch (err) {
    next.engine.close();
    throw new Error(`switch to ${choice.driver} failed: ${(err as Error).message}`);
  }
  current.dialect = next.dialect;
  current.engine = next.engine;
  activeChoice = choice;
  try {
    prev.close();
  } catch {
    // best-effort close
  }
  return { swapped: true, seeded };
}

export function describeActive(dbPath: string): { driver: "sqlite" | "postgres"; label: string } {
  const choice = activeChoice;
  if (!choice) {
    return { driver: "sqlite", label: "SQLite" };
  }
  if (choice.driver === "postgres") {
    return { driver: "postgres", label: `PostgreSQL · ${maskDbUrl(choice.url)}` };
  }
  return { driver: "sqlite", label: `SQLite · ${path.resolve(choice.path ?? dbPath)}` };
}

export function persistChoice(dbPath: string, choice: EngineChoice): void {
  const pref: DbPreference =
    choice.driver === "postgres" ? { driver: "postgres", url: choice.url } : { driver: "sqlite" };
  savePreference(preferenceFilePath(dbPath), pref);
}

export function isPostgresUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "postgres:" || u.protocol === "postgresql:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function activeKeyEquals(choice: EngineChoice, nextKey: string, dbPath: string): boolean {
  return choiceKey(choice, dbPath) === nextKey;
}

async function openVerified(choice: EngineChoice, dbPath: string): Promise<DbClient> {
  const client: DbClient =
    choice.driver === "postgres"
      ? openPostgres(choice.url)
      : openDatabase(path.resolve(choice.path ?? dbPath));
  try {
    await sqlGet(client.engine, "SELECT 1 AS ok");
    return client;
  } catch (err) {
    client.engine.close();
    throw new Error(`cannot reach ${choice.driver}: ${(err as Error).message}`);
  }
}

/**
 * When the target database has no accounts yet, port the current instance's
 * admin user, their default project and API keys over, so the UI session keeps
 * working after the swap instead of silently locking the admin out.
 */
async function seedAdminIfEmpty(source: DbClient["engine"], target: DbClient): Promise<number> {
  const first = await sqlGet<{ c: number }>(target.engine, "SELECT COUNT(*) AS c FROM users").catch(() => undefined);
  if (Number(first?.c ?? 0) > 0) {
    return 0;
  }
  const admin = await sqlGet<Record<string, unknown>>(source, "SELECT * FROM users WHERE is_admin = 1 LIMIT 1");
  if (!admin) {
    return 0;
  }
  const adminId = String(admin.id);
  const projects = await sqlAll<Record<string, unknown>>(source, "SELECT * FROM projects WHERE user_id = ?", [adminId]);
  const keys = await sqlAll<Record<string, unknown>>(source, "SELECT * FROM api_keys WHERE user_id = ?", [adminId]);
  await target.engine.transaction(async () => {
    await insertRow(target.engine, "users", admin);
    for (const p of projects) {
      await insertRow(target.engine, "projects", p);
    }
    for (const k of keys) {
      await insertRow(target.engine, "api_keys", k);
    }
  });
  return 1;
}