import type { LicenseState, TrustedKey } from "../core/config";
import type { Repositories } from "../repos";

export interface LicensePayload {
  edition: "pro" | "enterprise" | "cloud";
  kid?: string;
  licensee?: string;
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

export function grantFromLicense(license: LicenseState, payload: LicensePayload): void {
  license.apply({
    edition: payload.edition === "pro" ? "pro" : "enterprise",
    licensee: payload.licensee ?? null,
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
      console.log(`license: ${result.payload.edition} edition activated${result.payload.licensee ? ` for ${result.payload.licensee}` : ""}${capped}`);
    } else {
      console.warn(`license: stored key rejected (${result.reason ?? "invalid"})`);
    }
  } catch (err) {
    console.error("license load failed", err);
  }
}
