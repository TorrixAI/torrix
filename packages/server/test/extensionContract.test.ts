import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/core/config";
import { ExtensionHost } from "../src/core/extensionHost";
import type { TorrixExtension } from "../src/core/extensions";
import { sqlAll } from "../src/db/sql";
import { createTestApp } from "./helpers";

function stubMigrations(): { dirs: { sqlite: string; postgres: string }; cleanup(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "torrix-ext-"));
  for (const dialect of ["sqlite", "postgres"]) {
    fs.mkdirSync(path.join(root, dialect));
    fs.writeFileSync(path.join(root, dialect, "0001_stub.sql"), "CREATE TABLE stub_items (id TEXT PRIMARY KEY);");
  }
  return {
    dirs: { sqlite: path.join(root, "sqlite"), postgres: path.join(root, "postgres") },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function stubExtension(migrations?: { sqlite: string; postgres: string }): TorrixExtension {
  return {
    id: "stub",
    version: "0.0.1",
    minEdition: "pro",
    features: [
      { id: "stub-pro", label: "Stub pro", minEdition: "pro" },
      { id: "stub-enterprise", label: "Stub enterprise", minEdition: "enterprise" },
    ],
    migrations,
    async register(app, ctx) {
      app.get("/api/stub/ping", async () => ({ ok: true, pro: ctx.featureAllowed("stub-pro") }));
      app.get("/api/stub/enterprise", { preHandler: ctx.requireFeature("stub-enterprise") }, async () => ({ ok: true }));
    },
  };
}

test("extension routes follow the live license: 402 unlicensed, open after upgrade, closed after downgrade", async () => {
  const ctx = await createTestApp({}, { extensions: [stubExtension()] });
  try {
    const ping = () => ctx.app.inject({ method: "GET", url: "/api/stub/ping" });
    const ent = () => ctx.app.inject({ method: "GET", url: "/api/stub/enterprise" });

    const locked = await ping();
    expect(locked.statusCode).toBe(402);
    expect(locked.json()).toMatchObject({ error: "license_required", edition: "pro" });

    ctx.config.license.override("pro");
    expect((await ping()).json() as unknown).toEqual({ ok: true, pro: true });
    const entLocked = await ent();
    expect(entLocked.statusCode).toBe(402);
    expect(entLocked.json()).toMatchObject({ feature: "stub-enterprise", edition: "enterprise" });

    ctx.config.license.override("enterprise");
    expect((await ent()).statusCode).toBe(200);

    ctx.config.license.clear();
    expect((await ping()).statusCode).toBe(402);
  } finally {
    await ctx.cleanup();
  }
});

test("core routes are unaffected by an installed but unlicensed extension", async () => {
  const ctx = await createTestApp({}, { extensions: [stubExtension()] });
  try {
    expect((await ctx.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  } finally {
    await ctx.cleanup();
  }
});

test("trace annotations come from licensed extensions only", async () => {
  const ext: TorrixExtension = {
    ...stubExtension(),
    async traceAnnotations(_ctx, input) {
      return [
        {
          id: "ann-1",
          kind: "authorization",
          runId: input.runIds[0] ?? null,
          traceId: input.traceId,
          at: new Date().toISOString(),
          title: "ALLOW readPurchaseOrder",
          status: "allow",
        },
      ];
    },
  };
  const ctx = await createTestApp({}, { extensions: [ext] });
  try {
    const input = { userId: "u1", traceId: "t1", runIds: ["r1"] };
    expect(await ctx.host.traceAnnotations(input)).toEqual([]);
    ctx.config.license.override("pro");
    const annotations = await ctx.host.traceAnnotations(input);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ id: "ann-1", runId: "r1", traceId: "t1", status: "allow" });
  } finally {
    await ctx.cleanup();
  }
});

test("extension migrations run after core and are recorded under the extension namespace", async () => {
  const migrations = stubMigrations();
  const ctx = await createTestApp({}, { extensions: [stubExtension(migrations.dirs)] });
  try {
    const names = (await sqlAll<{ name: string }>(ctx.db.engine, "SELECT name FROM _migrations")).map((r) => r.name);
    expect(names).toContain("stub/0001_stub.sql");
    expect(names).toContain("0001_init.sql");
    expect(await sqlAll(ctx.db.engine, "SELECT id FROM stub_items")).toEqual([]);
  } finally {
    await ctx.cleanup();
    migrations.cleanup();
  }
});

test("periodic tasks only run while their extension and feature are licensed", async () => {
  const config = loadConfig({} as NodeJS.ProcessEnv);
  let runs = 0;
  const ext: TorrixExtension = {
    ...stubExtension(),
    periodic: [{ name: "count", intervalMs: 10, feature: "stub-enterprise", run: async () => void (runs += 1) }],
  };
  const host = new ExtensionHost([ext], config.license);
  const stop = host.startPeriodic({} as never);
  try {
    await Bun.sleep(40);
    expect(runs).toBe(0);
    config.license.override("pro");
    await Bun.sleep(40);
    expect(runs).toBe(0);
    config.license.override("enterprise");
    await Bun.sleep(40);
    expect(runs).toBeGreaterThan(0);
  } finally {
    stop();
  }
});

test("the host rejects reserved, malformed and duplicate ids", () => {
  const license = loadConfig({} as NodeJS.ProcessEnv).license;
  const base = stubExtension();
  expect(() => new ExtensionHost([{ ...base, id: "core" }], license)).toThrow("invalid extension id");
  expect(() => new ExtensionHost([{ ...base, id: "Bad Id" }], license)).toThrow("invalid extension id");
  expect(() => new ExtensionHost([base, { ...base }], license)).toThrow("duplicate extension id");
  expect(() => new ExtensionHost([base, { ...base, id: "other" }], license)).toThrow("duplicate feature id");
});

test("with no extensions the host is inert", async () => {
  const host = new ExtensionHost([], loadConfig({} as NodeJS.ProcessEnv).license);
  expect(host.features()).toEqual([]);
  expect(host.featureAllowed("anything")).toBe(false);
  expect(host.migrationSources().map((s) => s.id)).toEqual(["core"]);
  expect(await host.traceAnnotations({ userId: "u1", traceId: "t1", runIds: [] })).toEqual([]);
});
