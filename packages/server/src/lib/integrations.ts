import * as fs from "node:fs";
import * as path from "node:path";
import type { FastifyRequest } from "fastify";
import type { DbClient } from "../db/client";
import { sqlGet } from "../db/sql";

export type IntegrationId = "claude-code" | "opencode" | "sdk" | "proxy" | "otel";

export interface IntegrationActivity {
  id: IntegrationId;
  lastAt: string | null;
  runs24h: number;
}

// How each client labels the runs it sends, so the console can say whether an
// integration is actually delivering data. Tags are stored as compact JSON.
const MATCHERS: Record<IntegrationId, { where: string; params: string[] }> = {
  "claude-code": { where: "tags LIKE ?", params: ['%"client":"claude-code"%'] },
  opencode: { where: "tags LIKE ?", params: ['%"app":"opencode"%'] },
  sdk: {
    where: "source = 'sdk' AND (tags IS NULL OR (tags NOT LIKE ? AND tags NOT LIKE ?))",
    params: ['%"client":"claude-code"%', '%"app":"opencode"%'],
  },
  proxy: { where: "source = 'proxy'", params: [] },
  otel: { where: "source = 'otel'", params: [] },
};

export const INTEGRATION_IDS = Object.keys(MATCHERS) as IntegrationId[];

export async function integrationActivity(db: DbClient, userId: string, now = Date.now()): Promise<IntegrationActivity[]> {
  const since = new Date(now - 86_400_000).toISOString();
  const out: IntegrationActivity[] = [];
  for (const id of INTEGRATION_IDS) {
    const matcher = MATCHERS[id];
    const row = await sqlGet<{ last_at: string | null; recent: number | string | null }>(
      db.engine,
      `SELECT MAX(created_at) AS last_at, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent
         FROM runs WHERE user_id = ? AND ${matcher.where}`,
      [since, userId, ...matcher.params],
    );
    out.push({ id, lastAt: row?.last_at ?? null, runs24h: Number(row?.recent ?? 0) });
  }
  return out;
}

/** Public base URL as the browser reached this instance (honours reverse-proxy headers). */
export function publicBaseUrl(request: FastifyRequest): string {
  const headers = request.headers as Record<string, string | undefined>;
  const proto = (headers["x-forwarded-proto"] ?? request.protocol ?? "http").split(",")[0].trim();
  const host = (headers["x-forwarded-host"] ?? headers.host ?? "localhost:8088").split(",")[0].trim();
  return `${proto}://${host}`;
}

let localMarketplace: string | null | undefined;

export const PUBLIC_PLUGIN_MARKETPLACE = "TorrixAI/torrix";

/**
 * Where users add the Torrix Claude Code marketplace from: an explicit
 * TORRIX_PLUGIN_MARKETPLACE, else this checkout when it ships the marketplace
 * manifest (source installs), else the public GitHub repository.
 */
export function pluginMarketplace(env: NodeJS.ProcessEnv): string {
  const configured = env.TORRIX_PLUGIN_MARKETPLACE?.trim();
  if (configured) {
    return configured;
  }
  if (localMarketplace === undefined) {
    const root = path.resolve(import.meta.dir, "..", "..", "..", "..");
    localMarketplace = fs.existsSync(path.join(root, ".claude-plugin", "marketplace.json"))
      ? root.split(path.sep).join("/")
      : null;
  }
  return localMarketplace ?? PUBLIC_PLUGIN_MARKETPLACE;
}
