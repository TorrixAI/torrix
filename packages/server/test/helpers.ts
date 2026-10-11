import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig, parseEdition, type ServerConfig, type TrustedKey } from "../src/core/config";
import type { User } from "../src/core/domain";
import { openDatabase, type DbClient } from "../src/db/client";
import { coreMigrationSource } from "../src/db/dirs";
import { runMigrationSources, type MigrationSource } from "../src/db/migrate";
import { ExtensionHost } from "../src/core/extensionHost";
import type { TorrixExtension } from "../src/core/extensions";
import { generateApiKey, hashKey, keyPrefix } from "../src/lib/auth";
import { createRepositories, type Repositories } from "../src/repos";

export interface TestDb {
  db: DbClient;
  repos: Repositories;
  dir: string;
  cleanup(): Promise<void>;
}

export async function createTestDb(extensions: readonly TorrixExtension[] = []): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "torrix-test-"));
  const db = openDatabase(path.join(dir, "test.sqlite"));
  const sources: MigrationSource[] = [
    coreMigrationSource(),
    ...extensions.flatMap((ext) => (ext.migrations ? [{ id: ext.id, dirs: ext.migrations }] : [])),
  ];
  await runMigrationSources(db, sources);
  const repos = createRepositories(db);
  return {
    db,
    repos,
    dir,
    async cleanup(): Promise<void> {
      db.engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface TestApp extends TestDb {
  app: FastifyInstance;
  config: ServerConfig;
  host: ExtensionHost;
}

export interface TestAppOptions {
  trustedKeys?: readonly TrustedKey[];
  extensions?: readonly TorrixExtension[];
}

// TORRIX_EDITION only caps the edition in production, so tests that ask for a
// paid edition get it through the programmatic license override instead.
export async function createTestApp(env: NodeJS.ProcessEnv = {}, options: TestAppOptions = {}): Promise<TestApp> {
  const ctx = await createTestDb(options.extensions);
  const config = loadConfig(env, { trustedKeys: options.trustedKeys });
  const requested = parseEdition(env.TORRIX_EDITION);
  if (requested && requested !== "community") {
    config.license.override(requested);
  }
  const host = new ExtensionHost(options.extensions ?? [], config.license);
  const app = await buildApp({ repos: ctx.repos, config, env, host });
  await app.ready();
  return {
    db: ctx.db,
    repos: ctx.repos,
    dir: ctx.dir,
    app,
    config,
    host,
    async cleanup(): Promise<void> {
      await app.close();
      await ctx.cleanup();
    },
  };
}

export interface TestSession {
  user: User;
  key: string;
}

export async function seedSession(ctx: TestDb, email = "admin@test.local"): Promise<TestSession> {
  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    email,
    password: "unused-in-tests",
    api_key: null,
    is_admin: 1,
    must_change_password: 0,
    created_at: now,
  };
  await ctx.repos.users.create(user);
  const key = generateApiKey();
  await ctx.repos.apiKeys.create({
    id: crypto.randomUUID(),
    user_id: user.id,
    name: "test-session",
    key_hash: hashKey(key),
    key_prefix: keyPrefix(key),
    scope: "full",
    projects: null,
    permission: "read_write",
    created_at: now,
    last_used_at: null,
    revoked_at: null,
    budget_usd: null,
    hard_cap_usd: null,
  });
  return { user, key };
}

export function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toPem(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

export async function licenseSigner(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    trusted: { kid, pem: toPem(new Uint8Array(spki)) },
    async sign(payload: Record<string, unknown>): Promise<string> {
      const payloadBytes = new TextEncoder().encode(JSON.stringify({ kid, ...payload }));
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, payloadBytes);
      return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
    },
  };
}
