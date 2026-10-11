/**
 * Downstream verification of Torrix gateway attestations.
 *
 * An MCP server placed behind the Torrix gateway calls `verifyRequest` on every
 * incoming request and rejects anything that throws. Calls that skipped Torrix
 * (no attestation), were replayed, were retargeted at another server, or had their
 * tool arguments changed after authorization all fail.
 */

export const ATTESTATION_HEADER = "x-torrix-attestation";

export interface AttestationClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  mcp_method: string;
  agent_name?: string;
  tool?: string;
  args_sha256?: string;
  request_id?: string;
  decision?: string;
  principal_id?: string | null;
  delegation_id?: string | null;
  trace_id?: string | null;
  run_id?: string | null;
}

export type AttestationErrorCode =
  | "attestation_missing"
  | "attestation_malformed"
  | "attestation_unknown_key"
  | "attestation_bad_signature"
  | "attestation_expired"
  | "attestation_not_yet_valid"
  | "attestation_wrong_issuer"
  | "attestation_wrong_audience"
  | "attestation_replayed"
  | "attestation_method_mismatch"
  | "attestation_tool_mismatch"
  | "attestation_args_mismatch"
  | "attestation_not_allowed";

export class AttestationError extends Error {
  readonly code: AttestationErrorCode;

  constructor(code: AttestationErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AttestationError";
    this.code = code;
  }
}

export interface Jwks {
  keys: Array<JsonWebKey & { kid?: string }>;
}

export interface AttestationVerifierOptions {
  /** Server slug registered in Torrix; tokens for any other server are rejected. */
  audience: string;
  /** `https://torrix.example.com/.well-known/jwks.json`. Required unless `jwks` is given. */
  jwksUrl?: string;
  /** Static key set, for air-gapped deployments or tests. */
  jwks?: Jwks;
  /** Expected `iss`; matches `TORRIX_ATTESTATION_ISSUER` on the server (default `torrix`). */
  issuer?: string;
  clockSkewSeconds?: number;
  /** Reject a `jti` seen before (default true). Use a shared store across replicas via `replayStore`. */
  rejectReplays?: boolean;
  replayStore?: ReplayStore;
  jwksCacheSeconds?: number;
  fetch?: typeof fetch;
}

export interface ReplayStore {
  /** Returns false when the id was already recorded. */
  remember(jti: string, expiresAtSeconds: number): boolean | Promise<boolean>;
}

export interface JsonRpcMessage {
  method?: unknown;
  params?: unknown;
}

export interface AttestationVerifier {
  verify(token: string | null | undefined, message: JsonRpcMessage): Promise<AttestationClaims>;
  verifyRequest(headers: Headers | Record<string, string | string[] | undefined>, body: unknown): Promise<AttestationClaims>;
}

export function memoryReplayStore(): ReplayStore {
  const seen = new Map<string, number>();
  let lastSweep = 0;
  return {
    remember(jti, expiresAt) {
      const now = Math.floor(Date.now() / 1000);
      if (now - lastSweep > 30) {
        lastSweep = now;
        for (const [id, exp] of seen) if (exp < now) seen.delete(id);
      }
      if (seen.has(jti)) return false;
      seen.set(jti, expiresAt);
      return true;
    },
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export async function argsDigest(args: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(args ?? {})));
  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(segment))) as T;
  } catch {
    throw new AttestationError("attestation_malformed");
  }
}

function headerValue(headers: Headers | Record<string, string | string[] | undefined>, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
  const raw = key ? record[key] : undefined;
  return Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
}

export function createAttestationVerifier(options: AttestationVerifierOptions): AttestationVerifier {
  if (!options.jwks && !options.jwksUrl) throw new Error("createAttestationVerifier: jwksUrl or jwks is required");
  const fetchImpl = options.fetch ?? fetch;
  const skew = options.clockSkewSeconds ?? 30;
  const cacheMs = (options.jwksCacheSeconds ?? 300) * 1000;
  const replays = options.rejectReplays === false ? null : options.replayStore ?? memoryReplayStore();
  const keys = new Map<string, CryptoKey>();
  let loadedAt = 0;
  let lastForcedRefresh = 0;

  const loadKeys = async (jwks: Jwks) => {
    keys.clear();
    for (const jwk of jwks.keys) {
      if (!jwk.kid || jwk.kty !== "EC" || jwk.crv !== "P-256") continue;
      const { kid: _kid, alg: _alg, use: _use, key_ops: _ops, ...material } = jwk as JsonWebKey & { kid?: string };
      keys.set(jwk.kid, await crypto.subtle.importKey("jwk", material, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
    }
    loadedAt = Date.now();
  };

  const refresh = async () => {
    if (options.jwks) return loadKeys(options.jwks);
    const res = await fetchImpl(options.jwksUrl as string, { headers: { accept: "application/json" } });
    if (!res.ok) throw new AttestationError("attestation_unknown_key", `jwks fetch failed: ${res.status}`);
    await loadKeys((await res.json()) as Jwks);
  };

  const keyFor = async (kid: string): Promise<CryptoKey> => {
    if (!loadedAt || Date.now() - loadedAt > cacheMs) await refresh();
    let key = keys.get(kid);
    // A rotated key shows up as an unknown kid; refetch at most every 30s.
    if (!key && options.jwksUrl && Date.now() - lastForcedRefresh > 30_000) {
      lastForcedRefresh = Date.now();
      await refresh();
      key = keys.get(kid);
    }
    if (!key) throw new AttestationError("attestation_unknown_key");
    return key;
  };

  const verify = async (token: string | null | undefined, message: JsonRpcMessage): Promise<AttestationClaims> => {
    if (!token) throw new AttestationError("attestation_missing");
    const parts = token.trim().split(".");
    if (parts.length !== 3) throw new AttestationError("attestation_malformed");
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
    if (header.alg !== "ES256" || !header.kid) throw new AttestationError("attestation_malformed");
    const key = await keyFor(header.kid);
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) throw new AttestationError("attestation_bad_signature");

    const claims = decodeJson<AttestationClaims>(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new AttestationError("attestation_expired");
    if (typeof claims.iat === "number" && claims.iat - skew > now) throw new AttestationError("attestation_not_yet_valid");
    if (claims.iss !== (options.issuer ?? "torrix")) throw new AttestationError("attestation_wrong_issuer");
    if (claims.aud !== options.audience) throw new AttestationError("attestation_wrong_audience");

    const method = typeof message.method === "string" ? message.method : "";
    if (claims.mcp_method !== method) throw new AttestationError("attestation_method_mismatch");
    if (method === "tools/call") {
      const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (claims.decision !== "allow") throw new AttestationError("attestation_not_allowed");
      if (claims.tool !== params.name) throw new AttestationError("attestation_tool_mismatch");
      if (claims.args_sha256 !== (await argsDigest(params.arguments ?? {}))) throw new AttestationError("attestation_args_mismatch");
    }
    if (replays && !(await replays.remember(claims.jti, claims.exp + skew))) throw new AttestationError("attestation_replayed");
    return claims;
  };

  return {
    verify,
    verifyRequest(headers, body) {
      if (Array.isArray(body)) return Promise.reject(new AttestationError("attestation_malformed", "batch requests are not attested"));
      return verify(headerValue(headers, ATTESTATION_HEADER), (body ?? {}) as JsonRpcMessage);
    },
  };
}
