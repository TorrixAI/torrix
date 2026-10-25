import type { Database } from "bun:sqlite";
import postgres, { type Sql } from "postgres";

export type Dialect = "sqlite" | "postgres";

export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

/**
 * Dialect-agnostic data access seam. SQLite implementations stay synchronous;
 * the Postgres driver is async. Helpers in db/sql.ts always await, so either
 * flavour satisfies the same call sites.
 */
export interface SqlEngine {
  readonly dialect: Dialect;
  exec(sql: string): Promise<void> | void;
  run(sql: string, params?: SqlValue[]): Promise<void> | void;
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | undefined> | T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]> | T[];
  transaction(fn: () => void | Promise<void>): Promise<void> | void;
  close(): void;
}

export function createSqliteEngine(database: Database): SqlEngine {
  // SQLite has one write connection, so transactions are serialized here. Two
  // concurrent check-then-insert requests must not both run inside one BEGIN.
  let txChain: Promise<unknown> = Promise.resolve();
  return {
    dialect: "sqlite",
    exec(sql: string): void {
      database.exec(sql);
    },
    run(sql: string, params: SqlValue[] = []): void {
      database.query(sql).run(...(params as never[]));
    },
    get<T>(sql: string, params: SqlValue[] = []): T | undefined {
      return database.query(sql).get(...(params as never[])) as T | undefined;
    },
    all<T>(sql: string, params: SqlValue[] = []): T[] {
      return database.query(sql).all(...(params as never[])) as T[];
    },
    transaction(fn: () => void | Promise<void>): Promise<void> {
      const run = txChain.then(async () => {
        database.exec("BEGIN;");
        try {
          await fn();
          database.exec("COMMIT;");
        } catch (err) {
          database.exec("ROLLBACK;");
          throw err;
        }
      });
      txChain = run.catch(() => {});
      return run;
    },
    close(): void {
      database.close();
    },
  };
}

export function createPostgresEngine(sql: Sql): SqlEngine {
  let activeTx: Sql | null = null;

  const runQuery = async (query: string, params: SqlValue[]): Promise<unknown[]> => {
    const target: Sql = activeTx ?? sql;
    return (await target.unsafe(translatePg(query), params as never[])) as unknown[];
  };

  const runTx = (fn: () => void | Promise<void>): Promise<void> =>
    sql.begin(async (tx) => {
      activeTx = tx as unknown as Sql;
      try {
        await fn();
      } finally {
        activeTx = null;
      }
    });

  return {
    dialect: "postgres",
    exec(query: string): Promise<void> {
      return (activeTx ?? sql).unsafe(query).then(() => undefined);
    },
    run(query: string, params: SqlValue[] = []): Promise<void> {
      return runQuery(query, params).then(() => undefined);
    },
    async get<T>(query: string, params: SqlValue[] = []): Promise<T | undefined> {
      const rows = await runQuery(query, params);
      const first = rows[0] ?? undefined;
      return first as T | undefined;
    },
    async all<T>(query: string, params: SqlValue[] = []): Promise<T[]> {
      return (await runQuery(query, params)) as T[];
    },
    transaction(fn: () => void | Promise<void>): Promise<void> {
      return runTx(fn);
    },
    close(): void {
      void sql.end();
    },
  };
}

export function openPg(url: string): Sql {
  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
  });
}

/**
 * Rewrites a SQLite query for Postgres:
 *  - `?` positional placeholders become `$1, $2, ...` (string literals are honoured)
 *  - `INSERT OR IGNORE INTO ...` becomes `INSERT INTO ... ON CONFLICT DO NOTHING`
 */
function translatePg(query: string): string {
  const withoutIgnore = query.replace(/\bINSERT OR IGNORE INTO\b/g, "INSERT INTO");
  const withPlaceholders = rewritePlaceholders(withoutIgnore);
  if (/\bINSERT INTO\b/i.test(withPlaceholders) && !/\bON CONFLICT\b/i.test(withPlaceholders)) {
    return `${withPlaceholders} ON CONFLICT DO NOTHING`;
  }
  return withPlaceholders;
}

function rewritePlaceholders(query: string): string {
  let out = "";
  let n = 0;
  let inString = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (query[i + 1] === "'") {
          out += query[i + 1];
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "?") {
      n++;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}