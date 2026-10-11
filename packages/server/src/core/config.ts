import * as path from "node:path";

import { LicenseState, parseEdition, type Edition, type EditionConfig, type TrustedKey } from "./editions";
import { TRUSTED_LICENSE_KEYS } from "./licenseKeys";

export { EDITION_CONFIG, LicenseState, editionAtLeast, parseEdition } from "./editions";
export type { Edition, EditionConfig, EditionGrant, TrustedKey } from "./editions";

export interface ServerConfig {
  readonly edition: Edition;
  readonly editionConfig: EditionConfig;
  license: LicenseState;
  port: number;
  dbPath: string;
  databaseUrl: string | null;
  docker: boolean;
  isDemo: boolean;
  telemetry: boolean;
  openBrowser: boolean;
  localHost: string | null;
  mediaDir: string;
  updateRepo: string | null;
  attestationIssuer: string;
  version: string;
}

export interface ConfigOptions {
  trustedKeys?: readonly TrustedKey[];
}

export function loadConfig(env: NodeJS.ProcessEnv, options: ConfigOptions = {}): ServerConfig {
  const dbPath = env.DB_PATH ?? "torrix.sqlite";
  const userLimitOverride = Number(env.TORRIX_USER_LIMIT);
  const retentionDays = Number(env.TORRIX_RETENTION_DAYS);
  const license = new LicenseState({
    ceiling: parseEdition(env.TORRIX_EDITION),
    trustedKeys: options.trustedKeys ?? TRUSTED_LICENSE_KEYS,
    userLimitOverride: Number.isFinite(userLimitOverride) && userLimitOverride > 0 ? Math.floor(userLimitOverride) : null,
    retentionDaysOverride: Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : null,
  });
  return {
    get edition() {
      return license.edition();
    },
    get editionConfig() {
      return license.editionConfig();
    },
    license,
    port: toInt(env.PORT, 8088),
    dbPath,
    databaseUrl: env.TORRIX_DATABASE_URL ?? null,
    docker: env.DOCKER_CONTAINER === "true",
    isDemo: env.IS_DEMO === "true" || env.TORRIX_DEMO === "true",
    telemetry: env.TORRIX_TELEMETRY !== "false",
    openBrowser: env.TORRIX_OPEN_BROWSER !== "false",
    localHost: env.TORRIX_LOCAL_HOST ?? null,
    mediaDir: env.TORRIX_MEDIA_DIR ?? path.join(path.dirname(path.resolve(dbPath)), "torrix-media"),
    updateRepo: env.TORRIX_UPDATE_REPO ?? null,
    attestationIssuer: env.TORRIX_ATTESTATION_ISSUER?.trim() || "torrix",
    version: "1.1.1",
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}