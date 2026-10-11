export type Edition = "community" | "pro" | "enterprise";

export interface EditionConfig {
  maxRuns: number;
  retentionDays: number;
  maxGoldenRuns: number;
  maxPlaygroundRuns: number;
  maxDatasets: number;
  maxDatasetRows: number;
  fullTextSearch: boolean;
  onlineEvals: boolean;
  oidcSso: boolean;
  multiUser: boolean;
  userLimit: number | null;
  agentControl: boolean;
  maxAgents: number;
  maxDelegations: number;
  maxAuthzPolicies: number;
  maxMcpServers: number;
  approvals: boolean;
  agentGraph: boolean;
  a2a: boolean;
  identityFederation: boolean;
  authorizationRetentionDays: number;
}

export const EDITION_CONFIG: Record<Edition, EditionConfig> = {
  community: {
    maxRuns: 10_000,
    retentionDays: 7,
    maxGoldenRuns: 50,
    maxPlaygroundRuns: 50,
    maxDatasets: 3,
    maxDatasetRows: 50,
    fullTextSearch: false,
    onlineEvals: false,
    oidcSso: false,
    multiUser: false,
    userLimit: 1,
    agentControl: true,
    maxAgents: 3,
    maxDelegations: 10,
    maxAuthzPolicies: 10,
    maxMcpServers: 3,
    approvals: true,
    agentGraph: false,
    a2a: false,
    identityFederation: false,
    authorizationRetentionDays: 7,
  },
  pro: {
    maxRuns: Number.POSITIVE_INFINITY,
    retentionDays: 30,
    maxGoldenRuns: 100,
    maxPlaygroundRuns: Number.POSITIVE_INFINITY,
    maxDatasets: Number.POSITIVE_INFINITY,
    maxDatasetRows: Number.POSITIVE_INFINITY,
    fullTextSearch: true,
    onlineEvals: true,
    oidcSso: false,
    multiUser: true,
    userLimit: null,
    agentControl: true,
    maxAgents: Number.POSITIVE_INFINITY,
    maxDelegations: Number.POSITIVE_INFINITY,
    maxAuthzPolicies: Number.POSITIVE_INFINITY,
    maxMcpServers: Number.POSITIVE_INFINITY,
    approvals: true,
    agentGraph: true,
    a2a: true,
    identityFederation: false,
    authorizationRetentionDays: 30,
  },
  enterprise: {
    maxRuns: Number.POSITIVE_INFINITY,
    retentionDays: 90,
    maxGoldenRuns: Number.POSITIVE_INFINITY,
    maxPlaygroundRuns: Number.POSITIVE_INFINITY,
    maxDatasets: Number.POSITIVE_INFINITY,
    maxDatasetRows: Number.POSITIVE_INFINITY,
    fullTextSearch: true,
    onlineEvals: true,
    oidcSso: true,
    multiUser: true,
    userLimit: null,
    agentControl: true,
    maxAgents: Number.POSITIVE_INFINITY,
    maxDelegations: Number.POSITIVE_INFINITY,
    maxAuthzPolicies: Number.POSITIVE_INFINITY,
    maxMcpServers: Number.POSITIVE_INFINITY,
    approvals: true,
    agentGraph: true,
    a2a: true,
    identityFederation: true,
    authorizationRetentionDays: 90,
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
  private readonly configs = new Map<Edition, EditionConfig>();

  constructor(options: { ceiling: Edition | null; trustedKeys: readonly TrustedKey[]; userLimitOverride: number | null }) {
    this.ceiling = options.ceiling;
    this.trustedKeys = options.trustedKeys;
    this.userLimitOverride = options.userLimitOverride;
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
      if (this.userLimitOverride !== null) {
        cfg.userLimit = this.userLimitOverride;
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
