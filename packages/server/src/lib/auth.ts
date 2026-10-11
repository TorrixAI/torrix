import { createHash } from "node:crypto";
import type { DbClient } from "../db/client";
import { sqlGet, sqlRun } from "../db/sql";
import type { AuthResult } from "../core/domain";

export function generateApiKey(): string {
  return "trxk_" + crypto.randomUUID().replaceAll("-", "");
}

export function extractBearer(authorization?: string): string | null {
  if (!authorization) {
    return null;
  }
  const m = /^Bearer\s+(.+)$/i.exec(authorization);
  return m ? m[1].trim() : null;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function keyPrefix(key: string): string {
  return key.slice(0, 8);
}

const AUTH_COOKIE = "torrix_auth";

export function buildAuthCookie(key: string): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(key)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function clearAuthCookie(): string {
  return `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readAuthCookie(headers: unknown): string | null {
  const raw = String((headers as Record<string, unknown>).cookie ?? "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = part.slice(0, eq).trim();
    if (name === AUTH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export interface KeyAuth {
  user: AuthResult["user"];
  keyRecord: AuthResult["keyRecord"];
}

export async function authenticateKey(db: DbClient, apiKey: string): Promise<AuthResult | null> {
  const hash = hashKey(apiKey);
  const keyRecord = await sqlGet<Record<string, string | number | null>>(
    db.engine,
    "SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
    [hash],
  );

  const userId = keyRecord?.user_id ?? null;

  let user: AuthResult["user"] | null = null;
  if (userId) {
    const u = await sqlGet<Record<string, string | number | null>>(db.engine, "SELECT * FROM users WHERE id = ?", [userId]);
    if (u) {
      user = u as unknown as AuthResult["user"];
    }
  }

  if (!user) {
    const legacy = await sqlGet<Record<string, string | number | null>>(db.engine, "SELECT * FROM users WHERE api_key = ?", [hash]);
    if (legacy) {
      user = legacy as unknown as AuthResult["user"];
      return { user, keyRecord: null };
    }
    return null;
  }

  if (keyRecord?.id) {
    await sqlRun(db.engine, "UPDATE api_keys SET last_used_at = ? WHERE id = ?", [new Date().toISOString(), keyRecord.id]);
  }

  return { user, keyRecord: keyRecord as unknown as AuthResult["keyRecord"] };
}

export function getUserLimit(editionConfig: { userLimit: number | null }, envUserLimit?: string): number | null {
  if (envUserLimit) {
    const n = Number(envUserLimit);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return editionConfig.userLimit;
}

export function authorizeKeyScope(
  keyRecord: AuthResult["keyRecord"],
  scopeProject: string,
  requireWrite: boolean,
): { allowed: boolean; reason?: string } {
  if (!keyRecord) {
    return { allowed: true };
  }
  if (requireWrite && keyRecord.permission === "read_only") {
    return { allowed: false, reason: "read_only_key" };
  }
  if (keyRecord.scope === "projects") {
    let allowedProjects: string[] = [];
    if (keyRecord.projects) {
      try {
        allowedProjects = JSON.parse(keyRecord.projects) as string[];
      } catch {
        allowedProjects = [];
      }
    }
    if (!allowedProjects.includes(scopeProject)) {
      return { allowed: false, reason: "project_not_in_scope" };
    }
  }
  return { allowed: true };
}