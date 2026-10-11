import type { SqlEngine } from "../db/engine";
import { sqlAll } from "../db/sql";

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|grant|revoke|copy|merge|call|set|begin|commit|rollback|comment|lock|load|into)\b/i;

export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

/**
 * Runs one read-only statement. The console wraps the query in a limiting
 * subquery, so even an unqualified SELECT cannot stream a whole table back.
 */
export async function runReadOnlyQuery(engine: SqlEngine, input: string, maxRows = 500): Promise<QueryResult> {
  const sql = input.trim().replace(/;+\s*$/, "");
  if (!sql) {
    throw new QueryError("empty_query");
  }
  if (sql.includes(";")) {
    throw new QueryError("multiple_statements_not_allowed");
  }
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new QueryError("select_only");
  }
  if (FORBIDDEN.test(sql)) {
    throw new QueryError("forbidden_statement");
  }
  const limit = Math.min(500, Math.max(1, Math.floor(maxRows)));
  const wrapped = `SELECT * FROM (${sql}) AS torrix_query LIMIT ${limit + 1}`;
  const started = Date.now();
  const rows = await sqlAll<Record<string, unknown>>(engine, wrapped);
  const truncated = rows.length > limit;
  const sliced = truncated ? rows.slice(0, limit) : rows;
  return {
    columns: sliced.length ? Object.keys(sliced[0]) : [],
    rows: sliced,
    rowCount: sliced.length,
    truncated,
    elapsedMs: Date.now() - started,
  };
}
