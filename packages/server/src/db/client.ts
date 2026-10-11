import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { createPostgresEngine, createSqliteEngine, openPg, type SqlEngine } from "./engine";

export type { Dialect } from "./engine";

export interface DbClient {
  dialect: SqlEngine["dialect"];
  engine: SqlEngine;
}

export function openDatabase(dbPath: string): DbClient {
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });

  const database = new Database(dbPath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA cache_size = -64000;");
  database.exec("PRAGMA synchronous = NORMAL;");
  database.exec("PRAGMA foreign_keys = ON;");

  return { dialect: "sqlite", engine: createSqliteEngine(database) };
}

export function openPostgres(databaseUrl: string): DbClient {
  const sql = openPg(databaseUrl);
  return { dialect: "postgres", engine: createPostgresEngine(sql) };
}