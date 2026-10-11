import { expect, test } from "bun:test";
import { migrationDirs } from "../src/db/dirs";
import { runMigrations } from "../src/db/migrate";
import { sqlAll } from "../src/db/sql";
import { createTestApp, createTestDb } from "./helpers";

const AGENT_TABLES = [
  "agents",
  "agent_credentials",
  "principals",
  "delegations",
  "authorization_policies",
  "authorization_policy_versions",
  "agent_control_settings",
  "authorization_requests",
  "authorization_decisions",
  "approvals",
  "risk_assessments",
  "mcp_servers",
  "mcp_server_tools",
  "agent_tools",
  "agent_permissions",
];

test("0006 creates the agent control tables and links runs to agents", async () => {
  const ctx = await createTestDb();
  try {
    const rows = await sqlAll<{ name: string }>(
      ctx.db.engine,
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tables = new Set(rows.map((r) => r.name));
    for (const table of AGENT_TABLES) {
      expect(tables.has(table)).toBe(true);
    }
    const columns = await sqlAll<{ name: string }>(ctx.db.engine, "PRAGMA table_info(runs)");
    expect(columns.some((c) => c.name === "agent_id")).toBe(true);
  } finally {
    await ctx.cleanup();
  }
});

test("migrations re-run without error and record 0006", async () => {
  const ctx = await createTestDb();
  try {
    await runMigrations(ctx.db, migrationDirs());
    const applied = await sqlAll<{ name: string }>(
      ctx.db.engine,
      "SELECT name FROM _migrations ORDER BY name",
    );
    const names = applied.map((r) => r.name);
    expect(names).toContain("0006_agent_control.sql");
    expect(names.length).toBe(new Set(names).size);
  } finally {
    await ctx.cleanup();
  }
});

test("GET /health responds from the booted app", async () => {
  const ctx = await createTestApp();
  try {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; name: string; version: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("Torrix");
    expect(body.version).toBe(ctx.config.version);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  } finally {
    await ctx.cleanup();
  }
});
