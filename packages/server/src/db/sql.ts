import type { SqlEngine, SqlValue } from "./engine";

export type { SqlValue };

export async function sqlAll<T = Record<string, unknown>>(
  engine: SqlEngine,
  query: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  return (await engine.all<T>(query, params)) as T[];
}

export async function sqlGet<T = Record<string, unknown>>(
  engine: SqlEngine,
  query: string,
  params: SqlValue[] = [],
): Promise<T | undefined> {
  return (await engine.get<T>(query, params)) as T | undefined;
}

export async function sqlRun(engine: SqlEngine, query: string, params: SqlValue[] = []): Promise<void> {
  await engine.run(query, params);
}

function normalizeValue(value: unknown): SqlValue {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === undefined) {
    return null;
  }
  return value as SqlValue;
}

export function insertRow(engine: SqlEngine, table: string, row: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => `"${k}"`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const values = entries.map(([, v]) => normalizeValue(v));
  return engine.run(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, values) as Promise<void>;
}

export function updateById(
  engine: SqlEngine,
  table: string,
  id: string,
  fields: Record<string, unknown>,
  keyColumn = "id",
): Promise<void | void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) {
    return Promise.resolve();
  }
  const sets = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = [...entries.map(([, v]) => normalizeValue(v)), id];
  return engine.run(`UPDATE ${table} SET ${sets} WHERE ${keyColumn} = ?`, values) as Promise<void>;
}