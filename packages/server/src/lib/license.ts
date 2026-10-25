import { readFileSync } from "node:fs";
import type { LicenseState, TrustedKey } from "../core/config";
import type { Repositories } from "../repos";
import { guardedFetch } from "./outbound";

export interface LicensePayload {
  edition: "pro" | "enterprise" | "cloud";
  kid?: string;
  licensee?: string;
  customer?: string;
  serial?: string;
  expires_at?: string;
  limits?: Record<string, unknown>;
}

export interface LicenseVerification {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function decodePayload(part: string): LicensePayload | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(base64UrlToArrayBuffer(part)))) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as LicensePayload) : null;
  } catch {
    return null;
  }
}

async function signatureMatches(pem: string, signature: ArrayBuffer, payloadBytes: ArrayBuffer): Promise<boolean> {
  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, payloadBytes);
}

export async function verifyLicense(key: string, trustedKeys: readonly TrustedKey[]): Promise<LicenseVerification> {
  const [payloadPart, signaturePart, extra] = key.split(".");
  if (!payloadPart || !signaturePart || extra !== undefined) {
    return { valid: false, reason: "malformed" };
  }
  const claimed = decodePayload(payloadPart);
  if (!claimed) {
    return { valid: false, reason: "malformed" };
  }
  const candidates = claimed.kid ? trustedKeys.filter((k) => k.kid === claimed.kid) : trustedKeys;
  if (candidates.length === 0) {
    return { valid: false, reason: "unknown_key" };
  }
  try {
    const payloadBytes = base64UrlToArrayBuffer(payloadPart);
    const signature = base64UrlToArrayBuffer(signaturePart);
    let signatureOk = false;
    for (const candidate of candidates) {
      if (await signatureMatches(candidate.pem, signature, payloadBytes)) {
        signatureOk = true;
        break;
      }
    }
    if (!signatureOk) {
      return { valid: false, reason: "bad_signature" };
    }
    if (claimed.edition !== "pro" && claimed.edition !== "enterprise" && claimed.edition !== "cloud") {
      return { valid: false, reason: "invalid_edition" };
    }
    if (claimed.expires_at && !(Date.parse(claimed.expires_at) > Date.now())) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, payload: claimed };
  } catch {
    return { valid: false, reason: "verify_failed" };
  }
}

function limitsFromPayload(raw: LicensePayload["limits"]): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const limits: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (/^[a-z][a-z0-9_]{0,40}$/.test(name) && typeof value === "number" && Number.isInteger(value) && value >= 0) {
      limits[name] = value;
    }
  }
  return Object.keys(limits).length ? limits : undefined;
}

export interface RevocationVerification {
  valid: boolean;
  reason?: string;
  revoked?: string[];
  issued_at?: string | null;
}

/**
 * Verifies a signed revocation document (`<base64url payload>.<base64url signature>`)
 * against the same trusted keys as licenses. The payload is
 * `{ type: "torrix-license-revocations", issued_at, revoked: string[] }`.
 */
export async function verifyRevocationList(raw: string, trustedKeys: readonly TrustedKey[]): Promise<RevocationVerification> {
  const [payloadPart, signaturePart, extra] = raw.trim().split(".");
  if (!payloadPart || !signaturePart || extra !== undefined) {
    return { valid: false, reason: "malformed" };
  }
  let parsed: { revoked?: unknown; issued_at?: unknown } | null = null;
  try {
    const decoded = new TextDecoder().decode(new Uint8Array(base64UrlToArrayBuffer(payloadPart)));
    parsed = JSON.parse(decoded) as { revoked?: unknown; issued_at?: unknown };
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.revoked)) {
    return { valid: false, reason: "malformed" };
  }
  if (parsed.revoked.length > 100_000) {
    return { valid: false, reason: "too_large" };
  }
  const revoked: string[] = [];
  for (const entry of parsed.revoked) {
    if (typeof entry !== "string" || !entry || entry.length > 120) {
      return { valid: false, reason: "malformed" };
    }
    revoked.push(entry);
  }
  try {
    const payloadBytes = base64UrlToArrayBuffer(payloadPart);
    const signature = base64UrlToArrayBuffer(signaturePart);
    let signatureOk = false;
    for (const candidate of trustedKeys) {
      if (await signatureMatches(candidate.pem, signature, payloadBytes)) {
        signatureOk = true;
        break;
      }
    }
    if (!signatureOk) {
      return { valid: false, reason: "bad_signature" };
    }
  } catch {
    return { valid: false, reason: "verify_failed" };
  }
  return { valid: true, revoked, issued_at: typeof parsed.issued_at === "string" ? parsed.issued_at : null };
}

const REVOCATION_CONFIG_KEY = "license_revocations";

async function fetchRevocationDocument(url: string): Promise<string> {
  const res = await guardedFetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Opt-in revocation check. `TORRIX_LICENSE_REVOCATIONS` names a signed document
 * (an http(s) URL or a local file). A valid document is cached in
 * `instance_config` and re-applied on every boot, so an already-fetched list
 * keeps working offline. Without the env var nothing is fetched.
 */
export async function refreshLicenseRevocations(
  repos: Repositories,
  license: LicenseState,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const source = env.TORRIX_LICENSE_REVOCATIONS?.trim();
  let raw = await repos.instance.get(REVOCATION_CONFIG_KEY);
  if (source) {
    try {
      const doc = /^https?:\/\//i.test(source) ? await fetchRevocationDocument(source) : readFileSync(source, "utf8");
      const verified = await verifyRevocationList(doc, license.trustedKeys);
      if (verified.valid) {
        const trimmed = doc.trim();
        if (trimmed !== raw) {
          await repos.instance.set(REVOCATION_CONFIG_KEY, trimmed);
        }
        raw = trimmed;
        console.log(`license revocations: ${verified.revoked?.length ?? 0} serial(s), issued ${verified.issued_at ?? "unknown"}`);
      } else {
        console.warn(`license revocations: rejected (${verified.reason ?? "invalid"})`);
      }
    } catch (err) {
      console.warn(`license revocations: refresh failed (${(err as Error).message})`);
    }
  }
  if (!raw) {
    return;
  }
  const cached = await verifyRevocationList(raw, license.trustedKeys);
  if (!cached.valid || !cached.revoked) {
    return;
  }
  const grant = license.activeGrant();
  if (grant?.source === "license" && grant.serial && cached.revoked.includes(grant.serial)) {
    license.revoke("listed on the signed revocation list");
    console.warn(`license: serial ${grant.serial} is revoked; the instance returned to community`);
  }
}

export function grantFromLicense(license: LicenseState, payload: LicensePayload): void {
  license.apply({
    edition: payload.edition === "pro" ? "pro" : "enterprise",
    licensee: payload.licensee ?? null,
    customer: payload.customer ?? null,
    serial: payload.serial ?? null,
    expiresAt: payload.expires_at ?? null,
    source: "license",
    limits: limitsFromPayload(payload.limits),
  });
}

export async function loadStoredLicense(repos: Repositories, license: LicenseState, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    const persisted = await repos.instance.get("license_key");
    const stored = persisted ?? env.TORRIX_LICENSE_KEY ?? null;
    if (!stored) {
      return;
    }
    if (!persisted && env.TORRIX_LICENSE_KEY) {
      await repos.instance.set("license_key", env.TORRIX_LICENSE_KEY);
    }
    const result = await verifyLicense(stored, license.trustedKeys);
    if (result.valid && result.payload) {
      grantFromLicense(license, result.payload);
      const capped = license.edition() !== (result.payload.edition === "pro" ? "pro" : "enterprise") ? ` (capped to ${license.edition()} by TORRIX_EDITION)` : "";
      const serial = result.payload.serial ? `, serial ${result.payload.serial}` : "";
      console.log(`license: ${result.payload.edition} edition activated${result.payload.licensee ? ` for ${result.payload.licensee}` : ""}${serial}${capped}`);
    } else {
      console.warn(`license: stored key rejected (${result.reason ?? "invalid"})`);
    }
  } catch (err) {
    console.error("license load failed", err);
  }
}
