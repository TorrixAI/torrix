// Verifies a Torrix ledger anchor receipt offline.
//
//   bun scripts/verify-anchor.ts anchor.json
//   bun scripts/verify-anchor.ts anchor.json --jwks jwks.json
//   bun scripts/verify-anchor.ts anchor.json --export ledger-export.json
//
// The receipt is signed with the instance evidence key. Without --jwks the
// embedded public key is used for a consistency check; pass the published JWKS
// from /.well-known/jwks.json for independent verification.
import { readFileSync } from "node:fs";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function base64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifySignature(payload: unknown, signature: Record<string, unknown>, jwks?: JsonWebKey[]): Promise<string | null> {
  if (signature.alg !== "ES256" || typeof signature.value !== "string" || typeof signature.kid !== "string") {
    return "invalid_signature_shape";
  }
  const embedded = signature.public_jwk as JsonWebKey | undefined;
  const key = jwks
    ? jwks.find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === signature.kid)
    : embedded;
  if (!key) {
    return "signing_key_not_found";
  }
  try {
    const imported = await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      imported,
      base64Url(signature.value),
      new TextEncoder().encode(canonicalJson(payload)),
    );
    return ok ? null : "bad_signature";
  } catch {
    return "bad_signature";
  }
}

const file = process.argv[2];
if (!file) {
  console.error("usage: verify-anchor.ts <anchor.json> [--jwks jwks.json] [--export ledger-export.json]");
  process.exit(2);
}
const readArg = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

let jwks: JsonWebKey[] | undefined;
const jwksFile = readArg("--jwks");
if (jwksFile) {
  try {
    const parsed = JSON.parse(readFileSync(jwksFile, "utf8")) as { keys?: JsonWebKey[] };
    jwks = parsed.keys;
  } catch (error) {
    console.error(`could not read JWKS: ${(error as Error).message}`);
    process.exit(2);
  }
}

let anchor: Record<string, unknown>;
try {
  anchor = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
} catch (error) {
  console.error(`could not read anchor: ${(error as Error).message}`);
  process.exit(2);
}

const payload = anchor.payload as Record<string, unknown> | undefined;
const signature = anchor.signature as Record<string, unknown> | undefined;
if (anchor.version !== 1 || typeof anchor.issued_at !== "string" || !payload || !signature) {
  console.error(JSON.stringify({ valid: false, reason: "invalid_anchor" }));
  process.exit(1);
}
const head = payload.head as { seq?: unknown; hash?: unknown } | undefined;
if (!head || typeof head.seq !== "number" || typeof head.hash !== "string") {
  console.error(JSON.stringify({ valid: false, reason: "invalid_head" }));
  process.exit(1);
}
const signatureError = await verifySignature({ version: 1, issued_at: anchor.issued_at, payload }, signature, jwks);
if (signatureError) {
  console.error(JSON.stringify({ valid: false, reason: signatureError }));
  process.exit(1);
}

const exportFile = readArg("--export");
if (exportFile) {
  try {
    const exported = JSON.parse(readFileSync(exportFile, "utf8")) as { entries?: Array<{ seq?: number; hash?: string }> };
    const entry = exported.entries?.find((candidate) => candidate.seq === head.seq);
    if (!entry || entry.hash !== head.hash) {
      console.error(JSON.stringify({ valid: false, reason: "head_not_in_export", head }));
      process.exit(1);
    }
  } catch (error) {
    console.error(JSON.stringify({ valid: false, reason: "invalid_export", detail: (error as Error).message }));
    process.exit(1);
  }
}

console.log(JSON.stringify({
  valid: true,
  head: { seq: head.seq, hash: head.hash },
  issued_at: anchor.issued_at,
  witness: payload.witness ?? null,
  independent: Boolean(jwks),
}, null, 2));
