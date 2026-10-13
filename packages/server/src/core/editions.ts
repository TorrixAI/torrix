export type Edition = "community" | "pro" | "enterprise";

export interface EditionConfig {
  maxRuns: number;
  retentionDays: number;
  maxGoldenRuns: number;
  maxPlaygroundRuns: number;
  maxDatasets: number;
  maxDatasetRows: number;
  fullTextSearch: boolean;
  multiUser: boolean;
  userLimit: number | null;
}

export const EDITION_CONFIG: Record<Edition, EditionConfig> = {
  // Community limits apply to people, not data: paid editions sell control, so
  // volume, retention and search stay unlimited for everyone.
  community: {
    maxRuns: Number.POSITIVE_INFINITY,
    retentionDays: Number.POSITIVE_INFINITY,
    maxGoldenRuns: Number.POSITIVE_INFINITY,
    maxPlaygroundRuns: Number.POSITIVE_INFINITY,
    maxDatasets: Number.POSITIVE_INFINITY,
    maxDatasetRows: Number.POSITIVE_INFINITY,
    fullTextSearch: true,
    multiUser: true,
    userLimit: 5,
  },
  pro: {
    maxRuns: Number.POSITIVE_INFINITY,
    retentionDays: Number.POSITIVE_INFINITY,
    maxGoldenRuns: Number.POSITIVE_INFINITY,
    maxPlaygroundRuns: Number.POSITIVE_INFINITY,
    maxDatasets: Number.POSITIVE_INFINITY,
    maxDatasetRows: Number.POSITIVE_INFINITY,
    fullTextSearch: true,
    multiUser: true,
    userLimit: null,
  },
  enterprise: {
    maxRuns: Number.POSITIVE_INFINITY,
    retentionDays: Number.POSITIVE_INFINITY,
    maxGoldenRuns: Number.POSITIVE_INFINITY,
    maxPlaygroundRuns: Number.POSITIVE_INFINITY,
    maxDatasets: Number.POSITIVE_INFINITY,
    maxDatasetRows: Number.POSITIVE_INFINITY,
    fullTextSearch: true,
    multiUser: true,
    userLimit: null,
  },
};

const EDITION_RANK: Record<Edition, number> = { community: 0, pro: 1, enterprise: 2 };

export function editionAtLeast(edition: Edition, minimum: Edition): boolean {
  return EDITION_RANK[edition] >= EDITION_RANK[minimum];
}

function lowerOf(a: Edition, b: Edition): Edition {
  return EDITION_RANK[a] <= EDITION_RANK[b] ? a : b;
}

export function parseEdition(raw: string | undefined): Edition | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "cloud") {
    return "enterprise";
  }
  return value === "community" || value === "pro" || value === "enterprise" ? value : null;
}

export interface TrustedKey {
  kid: string;
  pem: string;
}

export type GrantSource = "license" | "override";

export interface EditionGrant {
  edition: "pro" | "enterprise";
  licensee: string | null;
  expiresAt: string | null;
  source: GrantSource;
  /** Per-license numeric limits signed into the key, for example `max_agents` for a trial. */
  limits?: Readonly<Record<string, number>>;
}

/**
 * Single owner of the active edition. A signed license (or a programmatic test
 * override) grants an edition; the TORRIX_EDITION env value can only cap it,
 * never raise it. Expiry is evaluated on every read so a lapsed license
 * downgrades without a restart.
 */
export class LicenseState {
  readonly ceiling: Edition | null;
  readonly trustedKeys: readonly TrustedKey[];
  private grant: EditionGrant | null = null;
  private grantExpiresMs = Number.POSITIVE_INFINITY;
  private readonly userLimitOverride: number | null;
  private readonly retentionDaysOverride: number | null;
  private readonly configs = new Map<Edition, EditionConfig>();

  constructor(options: {
    ceiling: Edition | null;
    trustedKeys: readonly TrustedKey[];
    userLimitOverride: number | null;
    retentionDaysOverride?: number | null;
  }) {
    this.ceiling = options.ceiling;
    this.trustedKeys = options.trustedKeys;
    this.userLimitOverride = options.userLimitOverride;
    this.retentionDaysOverride = options.retentionDaysOverride ?? null;
  }

  edition(): Edition {
    const granted = this.activeGrant()?.edition ?? "community";
    return this.ceiling ? lowerOf(granted, this.ceiling) : granted;
  }

  editionConfig(): EditionConfig {
    const edition = this.edition();
    let cfg = this.configs.get(edition);
    if (!cfg) {
      cfg = { ...EDITION_CONFIG[edition] };
      if (this.userLimitOverride !== null && (cfg.userLimit === null || this.userLimitOverride < cfg.userLimit)) {
        cfg.userLimit = this.userLimitOverride;
      }
      if (this.retentionDaysOverride !== null) {
        cfg.retentionDays = this.retentionDaysOverride;
      }
      this.configs.set(edition, cfg);
    }
    return cfg;
  }

  allows(minimum: Edition): boolean {
    return editionAtLeast(this.edition(), minimum);
  }

  activeGrant(): EditionGrant | null {
    if (this.grant && Date.now() >= this.grantExpiresMs) {
      this.grant = null;
      this.grantExpiresMs = Number.POSITIVE_INFINITY;
    }
    return this.grant;
  }

  /** A limit signed into the active license, or undefined when the license carries none. */
  limit(name: string): number | undefined {
    const value = this.activeGrant()?.limits?.[name];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  apply(grant: EditionGrant): void {
    const expires = grant.expiresAt ? Date.parse(grant.expiresAt) : Number.NaN;
    this.grant = grant;
    this.grantExpiresMs = Number.isFinite(expires) ? expires : Number.POSITIVE_INFINITY;
  }

  /** Programmatic grant for tests and embedded hosts; never reachable from env. */
  override(edition: Edition): void {
    if (edition === "community") {
      this.clear();
      return;
    }
    this.apply({ edition, licensee: null, expiresAt: null, source: "override" });
  }

  clear(): void {
    this.grant = null;
    this.grantExpiresMs = Number.POSITIVE_INFINITY;
  }
}
