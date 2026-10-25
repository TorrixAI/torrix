// Verifies a Torrix action-ledger evidence bundle or chain export offline.
//
//   bun packages/enterprise/tools/verify-ledger.ts bundle.json
//   bun packages/enterprise/tools/verify-ledger.ts export.json --jwks jwks.json
//
// Without --jwks the bundle's embedded public key is used for a consistency
// check. For independent evidence, pass the published JWKS from
// /.well-known/jwks.json so the signer cannot be swapped with the bundle.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const GENESIS = "0".repeat(64);

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

function computeEntryHash(seq: number, kind: string, createdAt: string, prevHash: string, payload: string): string {
  return createHash("sha256").update(`${seq}\n${kind}\n${createdAt}\n${prevHash}\n${payload}`).digest("hex");
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

interface Entry {
  id?: unknown;
  seq?: unknown;
  kind?: unknown;
  payload?: unknown;
  prev_hash?: unknown;
  hash?: unknown;
  created_at?: unknown;
}

function checkEntry(entry: Entry): string | null {
  if (typeof entry.seq !== "number" || !Number.isInteger(entry.seq) || entry.seq < 1) {
    return "invalid_seq";
  }
  if (typeof entry.kind !== "string" || !entry.kind) {
    return "invalid_kind";
  }
  if (typeof entry.payload !== "string" || typeof entry.prev_hash !== "string" || typeof entry.hash !== "string") {
    return "invalid_entry";
  }
  if (typeof entry.created_at !== "string") {
    return "invalid_created_at";
  }
  if (computeEntryHash(entry.seq, entry.kind, entry.created_at, entry.prev_hash, entry.payload) !== entry.hash) {
    return "hash_mismatch";
  }
  return null;
}

async function verifySignature(payload: unknown, signature: Record<string, unknown>, jwks?: JsonWebKey[]): Promise<string | null> {
  if (signature.alg !== "ES256" || typeof signature.value !== "string" || typeof signature.kid !== "string") {
    return "invalid_signature_shape";
  }
  const embedded = signature.public_jwk as JsonWebKey | undefined;
  const key = jwks ? jwks.find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === signature.kid) : embedded;
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

async function verifyBundle(doc: Record<string, unknown>, jwks?: JsonWebKey[]): Promise<{ valid: boolean; kind: string; entries: number; reason: string | null }> {
  const entry = doc.entry as Entry | undefined;
  if (doc.version !== 1 || typeof doc.issued_at !== "string" || !entry) {
    return { valid: false, kind: "bundle", entries: 0, reason: "invalid_bundle" };
  }
  const entryError = checkEntry(entry);
  if (entryError) {
    return { valid: false, kind: "bundle", entries: 1, reason: entryError };
  }
  const signature = doc.signature as Record<string, unknown> | undefined;
  if (!signature || typeof signature !== "object") {
    return { valid: false, kind: "bundle", entries: 1, reason: "missing_signature" };
  }
  const signatureError = await verifySignature({ version: 1, issued_at: doc.issued_at, entry }, signature, jwks);
  return { valid: signatureError === null, kind: "bundle", entries: 1, reason: signatureError };
}

async function verifyExport(doc: Record<string, unknown>, jwks?: JsonWebKey[]): Promise<{ valid: boolean; kind: string; entries: number; reason: string | null }> {
  const entries = doc.entries as Entry[] | undefined;
  if (doc.version !== 1 || typeof doc.issued_at !== "string" || !Array.isArray(entries)) {
    return { valid: false, kind: "export", entries: 0, reason: "invalid_export" };
  }
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    if (entry.seq !== i + 1) {
      return { valid: false, kind: "export", entries: entries.length, reason: `sequence_gap_at_${i + 1}` };
    }
    if (entry.prev_hash !== prev) {
      return { valid: false, kind: "export", entries: entries.length, reason: `prev_hash_mismatch_at_${i + 1}` };
    }
    const error = checkEntry(entry);
    if (error) {
      return { valid: false, kind: "export", entries: entries.length, reason: `${error}_at_${i + 1}` };
    }
    prev = entry.hash as string;
  }
  const head = doc.head as { seq?: unknown; hash?: unknown } | null | undefined;
  const last = entries[entries.length - 1];
  if (last && (!head || head.seq !== last.seq || head.hash !== last.hash)) {
    return { valid: false, kind: "export", entries: entries.length, reason: "head_mismatch" };
  }
  if (!last && head) {
    return { valid: false, kind: "export", entries: 0, reason: "head_without_entries" };
  }
  const signature = doc.signature as Record<string, unknown> | undefined;
  if (!signature || typeof signature !== "object") {
    return { valid: false, kind: "export", entries: entries.length, reason: "missing_signature" };
  }
  const signatureError = await verifySignature(
    { version: 1, issued_at: doc.issued_at, entries, head: head ?? null },
    signature,
    jwks,
  );
  return { valid: signatureError === null, kind: "export", entries: entries.length, reason: signatureError };
}

const file = process.argv[2];
if (!file) {
  console.error("usage: verify-ledger.ts <bundle-or-export.json> [--jwks jwks.json]");
  process.exit(2);
}
let jwks: JsonWebKey[] | undefined;
const jwksIndex = process.argv.indexOf("--jwks");
if (jwksIndex >= 0) {
  const jwksFile = process.argv[jwksIndex + 1];
  if (!jwksFile) {
    console.error("--jwks needs a file path");
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(jwksFile, "utf8")) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) {
    console.error("JWKS file has no keys array");
    process.exit(2);
  }
  jwks = parsed.keys as JsonWebKey[];
}

let doc: Record<string, unknown>;
try {
  doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
} catch (err) {
  console.error(`cannot read ${file}: ${(err as Error).message}`);
  process.exit(2);
}

const result = Array.isArray(doc.entries) ? await verifyExport(doc, jwks) : await verifyBundle(doc, jwks);
console.log(JSON.stringify({ ...result, key_source: jwks ? "jwks" : "embedded" }, null, 2));
if (!result.valid) {
  process.exit(1);
}
