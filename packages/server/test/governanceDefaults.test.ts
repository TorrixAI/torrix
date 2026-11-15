import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openDatabase } from "../src/db/client";
import { EMBEDDED_CORE_MIGRATIONS } from "../src/db/embeddedMigrations";
import { runMigrationSources } from "../src/db/migrate";
import { sqlGet, sqlRun } from "../src/db/sql";
import { applyMasking } from "../src/lib/masking";
import { SECRET_TYPES } from "../src/lib/pii";
import { bearer, createTestApp, seedSession } from "./helpers";

const legacyTypes = JSON.stringify(["email", "phone", "card", "ssn", "api_key"]);

test("new users start with credential masking on and personal data off", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    const settings = await ctx.repos.governance.getSettings(session.user.id);
    expect(settings.pii_enabled).toBe(1);
    expect(JSON.parse(settings.pii_types)).toEqual(SECRET_TYPES);
    expect(settings.pii_mask_input).toBe(1);
    expect(settings.pii_mask_output).toBe(1);
    expect(JSON.parse(settings.pii_types)).not.toContain("email");
    expect(JSON.parse(settings.pii_types)).not.toContain("phone");

    await ctx.repos.governance.updateSettings(session.user.id, { human_review_enabled: 1, updated_at: new Date().toISOString() });
    const afterUnrelatedUpdate = await ctx.repos.governance.getSettings(session.user.id);
    expect(afterUnrelatedUpdate.pii_enabled).toBe(1);
    expect(JSON.parse(afterUnrelatedUpdate.pii_types)).toEqual(SECRET_TYPES);

    const secret = `github_pat_${"Q".repeat(30)}`;
    const masked = applyMasking(settings, { request: `token ${secret}`, response: `echo ${secret}` });
    expect(masked.masked).toBe(true);
    expect(masked.request).not.toContain(secret);
    expect(masked.response).not.toContain(secret);
    expect(masked.request).toContain("[redacted]");
    expect(masked.response).toContain("[redacted]");
  } finally {
    await ctx.cleanup();
  }
});

test("ingest masks credentials with the new default without masking personal data", async () => {
  const ctx = await createTestApp();
  try {
    const session = await seedSession(ctx);
    await ctx.repos.projects.create({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      name: "Default",
      created_at: new Date().toISOString(),
    });
    const secret = `github_pat_${"R".repeat(30)}`;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/ingest",
      headers: bearer(session.key),
      payload: {
        records: [{
          id: "credential-default-1",
          model: "gpt-4o-mini",
          request: { body: { messages: [{ role: "user", content: `token ${secret} for jane@corp.example` }] } },
          response: { body: { choices: [{ message: { role: "assistant", content: `echo ${secret}` } }] } },
        }],
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = await ctx.repos.runs.getById("credential-default-1", session.user.id);
    const events = await ctx.repos.events.listByRun("credential-default-1");
    expect(stored?.request_body ?? "").not.toContain(secret);
    expect(events.map((event) => event.message).join("\n")).not.toContain(secret);
    expect(stored?.name ?? "").not.toContain(secret);
    expect(stored?.request_body ?? "").toContain("jane@corp.example");
    expect(stored?.pii_masked).toBe(1);
  } finally {
    await ctx.cleanup();
  }
});

test("migration 0022 snapshots the old defaults for users that already existed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "torrix-legacy-governance-"));
  const db = openDatabase(path.join(dir, "legacy.sqlite"));
  try {
    const withoutDefault = {
      sqlite: Object.fromEntries(Object.entries(EMBEDDED_CORE_MIGRATIONS.sqlite).filter(([name]) => name !== "0022_credential_masking_default.sql")),
      postgres: Object.fromEntries(Object.entries(EMBEDDED_CORE_MIGRATIONS.postgres).filter(([name]) => name !== "0022_credential_masking_default.sql")),
    };
    await runMigrationSources(db, [{
      id: "core",
      dirs: { sqlite: path.join(dir, "missing"), postgres: path.join(dir, "missing") },
      files: withoutDefault,
    }]);
    const userId = crypto.randomUUID();
    await sqlRun(
      db.engine,
      "INSERT INTO users (id, email, password, is_admin, must_change_password, created_at) VALUES (?, ?, ?, 1, 0, ?)",
      [userId, "legacy@example.com", "x", new Date().toISOString()],
    );

    await db.engine.exec(EMBEDDED_CORE_MIGRATIONS.sqlite["0022_credential_masking_default.sql"]);
    const row = await sqlGet<{ pii_enabled: number; pii_types: string; pii_mask_input: number; pii_mask_output: number }>(
      db.engine,
      "SELECT pii_enabled, pii_types, pii_mask_input, pii_mask_output FROM governance_settings WHERE user_id = ?",
      [userId],
    );
    expect(row?.pii_enabled).toBe(0);
    expect(row?.pii_types).toBe(legacyTypes);
    expect(row?.pii_mask_input).toBe(1);
    expect(row?.pii_mask_output).toBe(0);

    await db.engine.exec(EMBEDDED_CORE_MIGRATIONS.sqlite["0022_credential_masking_default.sql"]);
    const again = await sqlGet<{ pii_types: string }>(
      db.engine,
      "SELECT pii_types FROM governance_settings WHERE user_id = ?",
      [userId],
    );
    expect(again?.pii_types).toBe(legacyTypes);
  } finally {
    db.engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
